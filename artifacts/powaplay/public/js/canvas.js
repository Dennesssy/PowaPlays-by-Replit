window.Canvas = {
  el: null,
  container: null,
  x: 0,
  y: 0,
  dragging: false,
  lastX: 0,
  lastY: 0,
  velX: 0,
  velY: 0,
  rafId: null,
  projects: [],
  filtered: [],
  tiles: [],
  _mountedTiles: new Map(),
  TILE_W: 220,
  TILE_H: 187,
  GAP: 8,
  COLS: 8,
  _virtualRafId: null,
  _lastVirtualCheck: 0,
  _heroEl: null,
  _heroCenterPx: { x: 0, y: 0 },

  device: {
    isMobile: false,
    isTouch: false,
    dpr: 1,
    hasWebGPU: false,
    pointerType: 'mouse',
  },

  _pointerListenerBound: false,

  _detectDevice() {
    const vw = window.innerWidth;
    this.device.isMobile = vw <= 768;
    this.device.isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    this.device.dpr = window.devicePixelRatio || 1;
    this.device.hasWebGPU = !!navigator.gpu;
    this.device.pointerType = this.device.isTouch ? 'touch' : 'mouse';

    if (window.PointerEvent && !this._pointerListenerBound) {
      this._pointerListenerBound = true;
      window.addEventListener('pointerdown', (e) => {
        this.device.pointerType = e.pointerType;
      }, { passive: true });
    }
  },

  _updateTileSize() {
    this._detectDevice();
    const vw = this.el ? this.el.clientWidth : window.innerWidth;

    if (this.device.isMobile) {
      this.GAP = 6;
      this.TILE_W = 110;
      this.TILE_H = Math.round(this.TILE_W * 1.15);
    } else {
      this.GAP = 8;
      this.TILE_W = 220;
      this.TILE_H = Math.round(this.TILE_W * 0.85);
    }

    const cellW = this.TILE_W + this.GAP;
    const vh = Math.max(this.el ? this.el.clientHeight : window.innerHeight, 1);
    const visibleCols = Math.max(Math.floor(vw / cellW), 1);
    const n = this.filtered.length || 1;
    const aspectRatio = Math.max(0.5, Math.min(vw / vh, 3));
    const targetCols = Math.max(visibleCols * 3, Math.ceil(Math.sqrt(n * aspectRatio)));
    this.COLS = Math.min(Math.max(targetCols, visibleCols + 4), 80);
  },

  init(viewportEl, containerEl) {
    this.el = viewportEl;
    this.container = containerEl;
    this._detectDevice();
    this._applyGPUHints();
    this._bindEvents();
    this._updateTileSize();
    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const oldW = this.TILE_W;
        const oldCols = this.COLS;
        this._updateTileSize();
        if (oldW !== this.TILE_W || oldCols !== this.COLS) {
          this.render();
        } else {
          this._updateVirtualTiles();
        }
      }, 100);
    });
  },

  _applyGPUHints() {
    if (this.container) {
      this.container.style.willChange = 'transform';
      this.container.style.contain = 'layout style';
      this.container.style.backfaceVisibility = 'hidden';
    }
  },

  setProjects(projects) {
    this.projects = projects;
    this.filtered = projects;
    this._cacheProjects(projects);
    this.render();
  },

  async loadCachedProjects() {
    try {
      const cached = await this._getCachedProjects();
      if (cached && cached.length > 0) {
        this.projects = cached;
        this.filtered = cached;
        this.render();
        return cached.length;
      }
    } catch (e) {}
    return 0;
  },

  _openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('powaplay-cache', 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async _cacheProjects(projects) {
    try {
      const db = await this._openDB();
      const tx = db.transaction(['projects', 'meta'], 'readwrite');
      const store = tx.objectStore('projects');
      const metaStore = tx.objectStore('meta');
      store.clear();
      for (const p of projects) {
        store.put(p);
      }
      metaStore.put({ key: 'lastCached', value: Date.now(), count: projects.length });
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
      db.close();
    } catch (e) {}
  },

  async _getCachedProjects() {
    try {
      const db = await this._openDB();
      const tx = db.transaction(['projects', 'meta'], 'readonly');
      const metaStore = tx.objectStore('meta');
      const metaReq = metaStore.get('lastCached');
      const meta = await new Promise((res) => { metaReq.onsuccess = () => res(metaReq.result); metaReq.onerror = () => res(null); });
      if (!meta || (Date.now() - meta.value) > 5 * 60 * 1000) {
        db.close();
        return null;
      }
      const store = tx.objectStore('projects');
      const allReq = store.getAll();
      const result = await new Promise((res, rej) => { allReq.onsuccess = () => res(allReq.result); allReq.onerror = () => rej(allReq.error); });
      db.close();
      return result;
    } catch (e) {
      return null;
    }
  },

  filter(tag, style, search) {
    this.filtered = this.projects.filter((p) => {
      if (tag) {
        const tags = p.tags || [];
        if (!tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return false;
      }
      if (style && (!p.style || p.style.toLowerCase() !== style.toLowerCase())) return false;
      if (search) {
        const s = search.toLowerCase();
        const inTitle = (p.title || '').toLowerCase().includes(s);
        const inDesc = (p.description || '').toLowerCase().includes(s);
        const inTags = (p.tags || []).some((t) => t.toLowerCase().includes(s));
        if (!inTitle && !inDesc && !inTags) return false;
      }
      return true;
    });
    this.render();
    return this.filtered.length;
  },

  render() {
    this._mountedTiles.forEach((el) => el.remove());
    this._mountedTiles.clear();
    this.container.innerHTML = '';
    this._heroEl = null;
    this.tiles = [];
    this._renderGeneration++;
    this._updateTileSize();

    const cols = this.COLS;
    const totalSlots = this.filtered.length + 2;
    const rows = Math.max(cols, Math.ceil(totalSlots / cols));

    const heroCol = Math.max(0, Math.floor((cols - 2) / 2));
    const heroRow = Math.floor(rows / 2);

    const positions = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r === heroRow && (c === heroCol || c === heroCol + 1)) continue;
        positions.push({ col: c, row: r });
      }
    }

    const hcx = heroCol + 0.5;
    const hcy = heroRow;
    const aspect = (this.TILE_H + this.GAP) / (this.TILE_W + this.GAP);
    positions.sort((a, b) => {
      const da = Math.hypot(a.col - hcx, (a.row - hcy) * aspect);
      const db = Math.hypot(b.col - hcx, (b.row - hcy) * aspect);
      if (Math.abs(da - db) < 0.01) return a.row - b.row || a.col - b.col;
      return da - db;
    });

    const used = positions.slice(0, this.filtered.length);
    this.filtered.forEach((project, i) => {
      if (i >= used.length) return;
      const pos = used[i];
      const x = pos.col * (this.TILE_W + this.GAP);
      const y = pos.row * (this.TILE_H + this.GAP);
      this.tiles.push({ x, y, project, index: i, el: null });
    });

    const gridW = cols * (this.TILE_W + this.GAP) - this.GAP;
    const gridH = rows * (this.TILE_H + this.GAP) - this.GAP;
    this.container.style.width = gridW + 'px';
    this.container.style.height = gridH + 'px';
    this.container.style.left = '0px';
    this.container.style.top = '0px';

    const heroX = heroCol * (this.TILE_W + this.GAP);
    const heroY = heroRow * (this.TILE_H + this.GAP);
    const heroW = 2 * this.TILE_W + this.GAP;
    this._heroEl = this._createHeroTile(heroX, heroY, heroW);
    this.container.appendChild(this._heroEl);

    this._heroCenterPx = {
      x: heroX + heroW / 2,
      y: heroY + this.TILE_H / 2,
    };

    this._centerOnHero(false);
    this._updateVirtualTiles();
    this._scheduleIdleRender();
  },

  _centerOnHero(animate) {
    if (!this.el) return;
    const vw = this.el.clientWidth;
    const vh = this.el.clientHeight;
    const targetX = vw / 2 - this._heroCenterPx.x;
    const targetY = vh / 2 - this._heroCenterPx.y;

    if (animate) {
      this.container.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      this.x = targetX;
      this.y = targetY;
      this._applyTransform();
      setTimeout(() => { this.container.style.transition = ''; }, 420);
    } else {
      this.x = targetX;
      this.y = targetY;
      this._applyTransform();
    }
  },

  centerOnGrid(animate) {
    this._centerOnHero(animate);
  },

  _getVisibleBounds() {
    if (!this.el) return { left: 0, top: 0, right: 1280, bottom: 720 };
    const vw = this.el.clientWidth;
    const vh = this.el.clientHeight;
    const buffer = this.device.isMobile
      ? Math.max(vw, vh) * 0.5
      : Math.max(vw, vh) * 0.35;

    return {
      left: -this.x - buffer,
      top: -this.y - buffer,
      right: -this.x + vw + buffer,
      bottom: -this.y + vh + buffer,
    };
  },

  _updateVirtualTiles() {
    const now = performance.now();
    if (now - this._lastVirtualCheck < 16) return;
    this._lastVirtualCheck = now;

    const bounds = this._getVisibleBounds();
    const tileW = this.TILE_W;
    const tileH = this.TILE_H;

    const toMount = [];
    const toUnmount = [];
    const visibleSet = new Set();

    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      const inView = t.x + tileW > bounds.left && t.x < bounds.right &&
                     t.y + tileH > bounds.top && t.y < bounds.bottom;

      if (inView) {
        visibleSet.add(i);
        if (!t.el) {
          toMount.push(i);
        }
      }
    }

    this._mountedTiles.forEach((el, idx) => {
      if (!visibleSet.has(idx)) {
        toUnmount.push(idx);
      }
    });

    for (const idx of toUnmount) {
      const el = this._mountedTiles.get(idx);
      if (el) {
        el.remove();
        this._mountedTiles.delete(idx);
        this.tiles[idx].el = null;
      }
    }

    const mountBatch = toMount.slice(0, 12);
    const mountDeferred = toMount.slice(12);

    for (const idx of mountBatch) {
      const t = this.tiles[idx];
      const tile = this._createTile(t.project, t.x, t.y, t.index);
      this.container.appendChild(tile);
      t.el = tile;
      this._mountedTiles.set(idx, tile);
    }

    if (mountDeferred.length > 0) {
      this._deferMount(mountDeferred);
    }
  },

  _deferMount(indices) {
    if (indices.length === 0) return;
    const batch = indices.slice(0, 8);
    const rest = indices.slice(8);
    const gen = this._renderGeneration;

    requestAnimationFrame(() => {
      if (gen !== this._renderGeneration) return;
      const bounds = this._getVisibleBounds();
      for (const idx of batch) {
        const t = this.tiles[idx];
        if (!t || t.el || this._mountedTiles.has(idx)) continue;
        const inView = t.x + this.TILE_W > bounds.left && t.x < bounds.right &&
                       t.y + this.TILE_H > bounds.top && t.y < bounds.bottom;
        if (!inView) continue;
        const tile = this._createTile(t.project, t.x, t.y, t.index);
        this.container.appendChild(tile);
        t.el = tile;
        this._mountedTiles.set(idx, tile);
      }
      if (rest.length > 0) this._deferMount(rest);
    });
  },

  _renderGeneration: 0,

  _scheduleIdleRender() {
    this._renderGeneration++;
  },

  _createHeroTile(x, y, heroW) {
    const tile = document.createElement('div');
    tile.className = 'tile tile-hero';
    tile.style.cssText = `left:${x}px;top:${y}px;width:${heroW}px;height:${this.TILE_H}px;z-index:10;contain:layout style paint;`;
    tile.innerHTML = `
      <div class="hero-icon">
        <span>P</span>
      </div>
      <div class="hero-body">
        <div class="hero-title">PowaPlay<br>Webappstore</div>
        <div class="hero-sub">powered by Replit ⚡</div>
      </div>
      <button class="hero-cta">Get Started &rarr;</button>
    `;
    tile.addEventListener('click', (e) => {
      if (this._wasDragging) return;
      if (typeof App !== 'undefined' && App.openHeroModal) {
        App.openHeroModal();
      }
    });
    return tile;
  },

  _createTile(project, x, y, index) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.style.cssText = `left:${x}px;top:${y}px;width:${this.TILE_W}px;height:${this.TILE_H}px;contain:layout style paint;content-visibility:auto;`;
    tile.style.animationDelay = Math.min(index * 20, 400) + 'ms';

    const initials = (project.title || 'P').slice(0, 2).toUpperCase();
    const hue = (project.id * 47) % 360;

    const placeholderHtml = `<div class="tile-placeholder" style="background: linear-gradient(135deg, hsl(${hue}, 40%, 92%), hsl(${hue + 40}, 50%, 85%))"><span>${initials}</span></div>`;
    let thumbHtml;
    if (project.thumbnailUrl) {
      thumbHtml = `<img src="${escapeHtml(project.thumbnailUrl)}" alt="" class="tile-thumb" loading="lazy" decoding="async" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">${placeholderHtml.replace('style="', 'style="display:none;')}`;
    } else {
      thumbHtml = placeholderHtml;
    }

    let videoHtml = '';
    if (project.previewVideoUrl) {
      videoHtml = `<video class="tile-video" muted playsinline loop preload="none" src="${escapeHtml(project.previewVideoUrl)}"></video>`;
    }

    const tags = (project.tags || []).slice(0, 2);
    const tagsHtml = tags.map((t) => `<span class="tile-tag">${escapeHtml(t)}</span>`).join('');

    const favCount = project.favoriteCount || 0;

    tile.innerHTML = `
      <div class="tile-media">${thumbHtml}${videoHtml}</div>
      <div class="tile-info">
        <div class="tile-title">${escapeHtml(project.title || 'Untitled')}</div>
        <div class="tile-meta">
          <span class="tile-owner">${escapeHtml(project.ownerDisplayName || project.ownerUsername || 'unknown')}</span>
          <button class="tile-fav-btn" data-pid="${project.id}" title="Favorite">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            <span class="tile-fav-count">${favCount}</span>
          </button>
        </div>
        <div class="tile-tags">${tagsHtml}</div>
      </div>
    `;

    const favBtn = tile.querySelector('.tile-fav-btn');
    favBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (favBtn.disabled) return;
      if (typeof Auth !== 'undefined' && !Auth.user) {
        window.location.href = '/api/login?returnTo=/';
        return;
      }
      favBtn.disabled = true;
      API.addFavorite(project.id).then(() => {
        project.favoriteCount = (project.favoriteCount || 0) + 1;
        favBtn.querySelector('.tile-fav-count').textContent = project.favoriteCount;
        favBtn.classList.add('tile-fav-active');
      }).catch(() => { favBtn.disabled = false; });
    });

    tile.addEventListener('mouseenter', () => {
      const video = tile.querySelector('.tile-video');
      if (video) {
        video.currentTime = 0;
        video.play().catch(() => {});
      }
    });

    tile.addEventListener('mouseleave', () => {
      const video = tile.querySelector('.tile-video');
      if (video) video.pause();
    });

    tile.addEventListener('click', (e) => {
      if (this._wasDragging) return;
      if (typeof App !== 'undefined' && App.openProject) {
        App.openProject(project);
      }
    });

    return tile;
  },

  _wasDragging: false,

  _bindEvents() {
    let startX, startY, startTransX, startTransY, moved;

    const pointerDown = (cx, cy) => {
      this.dragging = true;
      moved = false;
      startX = cx;
      startY = cy;
      startTransX = this.x;
      startTransY = this.y;
      this.velX = 0;
      this.velY = 0;
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      this.el.style.cursor = 'grabbing';
    };

    const pointerMove = (cx, cy) => {
      if (!this.dragging) return;
      const dx = cx - startX;
      const dy = cy - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
      this.x = startTransX + dx;
      this.y = startTransY + dy;
      this.velX = cx - this.lastX;
      this.velY = cy - this.lastY;
      this.lastX = cx;
      this.lastY = cy;
      this._applyTransform();
    };

    const pointerUp = () => {
      this.dragging = false;
      this._wasDragging = moved;
      this.el.style.cursor = 'grab';
      if (moved) this._startInertia();
      setTimeout(() => { this._wasDragging = false; }, 50);
    };

    this.el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      pointerDown(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', (e) => pointerMove(e.clientX, e.clientY));
    window.addEventListener('mouseup', () => pointerUp());

    let touchId = null;
    this.el.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        e.preventDefault();
        touchId = e.touches[0].identifier;
        this.lastX = e.touches[0].clientX;
        this.lastY = e.touches[0].clientY;
        pointerDown(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: false });
    this.el.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && e.touches[0].identifier === touchId) {
        e.preventDefault();
        pointerMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: false });
    this.el.addEventListener('touchend', () => pointerUp());

    this.el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.x -= e.deltaX;
      this.y -= e.deltaY;
      this._applyTransform();
    }, { passive: false });

    this.el.style.cursor = 'grab';
  },

  _applyTransform() {
    const containerW = parseInt(this.container.style.width) || 0;
    const vw = this.el ? this.el.clientWidth : 0;
    const vh = this.el ? this.el.clientHeight : 0;
    const containerH = parseInt(this.container.style.height) || 0;
    const pad = Math.max(vw * 0.15, 60);

    if (containerW > 0 && vw > 0) {
      const minX = vw - containerW - pad;
      const maxX = pad;
      this.x = Math.max(minX, Math.min(maxX, this.x));
    }

    const minY = vh - containerH - pad;
    const maxY = pad;
    this.y = Math.max(minY, Math.min(maxY, this.y));

    this.container.style.transform = `translate3d(${this.x}px, ${this.y}px, 0)`;
    this._scheduleVirtualUpdate();
  },

  _scheduleVirtualUpdate() {
    if (this._virtualRafId) return;
    this._virtualRafId = requestAnimationFrame(() => {
      this._virtualRafId = null;
      this._updateVirtualTiles();
    });
  },

  _startInertia() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    const friction = this.device.isTouch ? 0.95 : 0.92;
    const step = () => {
      this.velX *= friction;
      this.velY *= friction;
      if (Math.abs(this.velX) < 0.5 && Math.abs(this.velY) < 0.5) return;
      this.x += this.velX;
      this.y += this.velY;
      this._applyTransform();
      this.rafId = requestAnimationFrame(step);
    };
    this.rafId = requestAnimationFrame(step);
  },
};
