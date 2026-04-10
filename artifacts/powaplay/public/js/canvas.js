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
  TILE_W: 280,
  TILE_H: 220,
  GAP: 8,
  COLS: 6,
  _virtualRafId: null,
  _lastVirtualCheck: 0,
  _heroEl: null,
  _heroGridIndex: -1,
  _heroGridIndex2: -1,

  _isMobile() {
    return window.innerWidth <= 768;
  },

  _updateTileSize() {
    if (this._isMobile()) {
      const vw = window.innerWidth;
      this.GAP = 6;
      this.COLS = 2;
      this.TILE_W = Math.floor((vw - this.GAP * 3) / 2);
      this.TILE_H = Math.round(this.TILE_W * 0.85);
    } else {
      this.GAP = 8;
      this._updateCols();
    }
  },

  init(viewportEl, containerEl) {
    this.el = viewportEl;
    this.container = containerEl;
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

  _updateCols() {
    if (!this.el) return;
    const w = this.el.clientWidth;
    this.TILE_W = 280;
    this.TILE_H = 220;
    this.COLS = Math.max(2, Math.floor(w / (this.TILE_W + this.GAP)));
    const totalGridW = this.COLS * this.TILE_W + (this.COLS - 1) * this.GAP;
    if (totalGridW < w - 32) {
      this.TILE_W = Math.floor((w - 32 - (this.COLS - 1) * this.GAP) / this.COLS);
      this.TILE_H = Math.round(this.TILE_W * 0.78);
    }
  },

  setProjects(projects) {
    this.projects = projects;
    this.filtered = projects;
    this.render();
  },

  appendProjects(newProjects) {
    this.projects = this.projects.concat(newProjects);
    this.filtered = this.filtered.concat(newProjects);
    const cols = this.COLS;
    const startIndex = this.tiles.length;
    newProjects.forEach((project, i) => {
      const idx = startIndex + i;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = col * (this.TILE_W + this.GAP);
      const y = row * (this.TILE_H + this.GAP);
      this.tiles.push({ x, y, project, index: idx, el: null });
    });
    const rows = Math.ceil(this.filtered.length / cols);
    this.container.style.height = (rows * (this.TILE_H + this.GAP) - this.GAP) + 'px';
    this._updateVirtualTiles();
  },

  prependProjects(newProjects) {
    if (!newProjects || newProjects.length === 0) return;
    const cols = this.COLS;
    const newRows = Math.ceil(newProjects.length / cols);
    const shiftY = newRows * (this.TILE_H + this.GAP);

    this._mountedTiles.forEach((el) => el.remove());
    this._mountedTiles.clear();

    for (const t of this.tiles) {
      t.y += shiftY;
      t.index += newProjects.length;
      t.el = null;
    }

    const newTiles = newProjects.map((project, i) => ({
      x: (i % cols) * (this.TILE_W + this.GAP),
      y: Math.floor(i / cols) * (this.TILE_H + this.GAP),
      project,
      index: i,
      el: null,
    }));

    this.tiles = newTiles.concat(this.tiles);
    this.projects = newProjects.concat(this.projects);
    this.filtered = newProjects.concat(this.filtered);

    const totalRows = Math.ceil(this.filtered.length / cols);
    this.container.style.height = (totalRows * (this.TILE_H + this.GAP) - this.GAP) + 'px';

    if (this._heroEl) {
      const currentTop = parseInt(this._heroEl.style.top) || 0;
      this._heroEl.style.top = (currentTop + shiftY) + 'px';
    }

    if (this._heroGridIndex >= 0) {
      this._heroGridIndex += newProjects.length;
      this._heroGridIndex2 += newProjects.length;
    }

    this.y -= shiftY;
    this._applyTransform();
    this._updateVirtualTiles();
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
    this._updateTileSize();
    const cols = this.COLS;
    const isMobile = this._isMobile();

    this.container.style.left = isMobile ? (this.GAP + 'px') : '16px';
    this.container.style.top = isMobile ? (this.GAP + 'px') : '16px';

    const heroCol = Math.max(0, Math.floor((cols - 2) / 2));
    this._heroGridIndex = cols + heroCol;
    this._heroGridIndex2 = this._heroGridIndex + 1;

    this.filtered.forEach((project, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * (this.TILE_W + this.GAP);
      const y = row * (this.TILE_H + this.GAP);
      this.tiles.push({ x, y, project, index: i, el: null });
    });

    const rows = Math.ceil(this.filtered.length / cols);
    this.container.style.width = (cols * (this.TILE_W + this.GAP) - this.GAP) + 'px';
    this.container.style.height = (rows * (this.TILE_H + this.GAP) - this.GAP) + 'px';

    if (this.filtered.length > this._heroGridIndex2) {
      const hx = heroCol * (this.TILE_W + this.GAP);
      const hy = 1 * (this.TILE_H + this.GAP);
      const heroW = 2 * this.TILE_W + this.GAP;
      this._heroEl = this._createHeroTile(hx, hy, heroW);
      this.container.appendChild(this._heroEl);
    }

    this._updateVirtualTiles();
  },

  _getVisibleBounds() {
    if (!this.el) return { left: 0, top: 0, right: 1280, bottom: 720 };
    const vw = this.el.clientWidth;
    const vh = this.el.clientHeight;
    const buffer = Math.max(vw, vh);

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
    const offsetLeft = parseInt(this.container.style.left) || 0;
    const offsetTop = parseInt(this.container.style.top) || 0;

    const toMount = [];
    const toUnmount = [];
    const visibleSet = new Set();

    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      const tx = t.x + offsetLeft;
      const ty = t.y + offsetTop;
      const inView = tx + tileW > bounds.left && tx < bounds.right &&
                     ty + tileH > bounds.top && ty < bounds.bottom;

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

    for (const idx of toMount) {
      const t = this.tiles[idx];
      if (idx === this._heroGridIndex || idx === this._heroGridIndex2) continue;
      const tile = this._createTile(t.project, t.x, t.y, t.index);
      this.container.appendChild(tile);
      t.el = tile;
      this._mountedTiles.set(idx, tile);
    }
  },

  _createHeroTile(x, y, heroW) {
    const tile = document.createElement('div');
    tile.className = 'tile tile-hero';
    tile.style.left = x + 'px';
    tile.style.top = y + 'px';
    tile.style.width = (heroW || this.TILE_W) + 'px';
    tile.style.height = this.TILE_H + 'px';
    tile.style.zIndex = '10';
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
    tile.style.left = x + 'px';
    tile.style.top = y + 'px';
    tile.style.width = this.TILE_W + 'px';
    tile.style.height = this.TILE_H + 'px';
    tile.style.animationDelay = Math.min(index * 30, 500) + 'ms';

    const initials = (project.title || 'P').slice(0, 2).toUpperCase();
    const hue = (project.id * 47) % 360;

    let thumbHtml;
    if (project.thumbnailUrl) {
      thumbHtml = `<img src="${escapeHtml(project.thumbnailUrl)}" alt="" class="tile-thumb" loading="lazy">`;
    } else {
      thumbHtml = `<div class="tile-placeholder" style="background: linear-gradient(135deg, hsl(${hue}, 40%, 92%), hsl(${hue + 40}, 50%, 85%))"><span>${initials}</span></div>`;
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
    const containerLeft = parseInt(this.container.style.left) || 0;
    const vw = this.el ? this.el.clientWidth : 0;

    if (containerW > 0 && vw > 0) {
      const minX = vw - containerLeft - containerW;
      const maxX = -containerLeft;
      if (minX < maxX) {
        this.x = Math.max(minX, Math.min(maxX, this.x));
      } else {
        this.x = 0;
      }
    }

    this.y = Math.min(0, this.y);

    this.container.style.transform = `translate3d(${this.x}px, ${this.y}px, 0)`;
    this._scheduleVirtualUpdate();
    this._checkEdge();
  },

  _scheduleVirtualUpdate() {
    if (this._virtualRafId) return;
    this._virtualRafId = requestAnimationFrame(() => {
      this._virtualRafId = null;
      this._updateVirtualTiles();
    });
  },

  _checkEdge() {
    const containerH = parseInt(this.container.style.height) || 0;
    const viewportH = this.el.clientHeight;
    const scrolledY = -this.y;

    if (containerH > 0 && scrolledY + viewportH > containerH - 600) {
      if (typeof App !== 'undefined' && App._loadMoreProjects) {
        App._loadMoreProjects();
      }
    }

    if (scrolledY < 600) {
      if (typeof App !== 'undefined' && App._loadMoreProjectsNorth) {
        App._loadMoreProjectsNorth();
      }
    }
  },

  _startInertia() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    const friction = 0.92;
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

  centerOnGrid(animate) {
    if (this.tiles.length === 0) return;
    const containerW = parseInt(this.container.style.width) || 0;
    const containerH = parseInt(this.container.style.height) || 0;
    const vw = this.el.clientWidth;
    const vh = this.el.clientHeight;

    const targetX = (vw - containerW) / 2;
    const targetY = Math.min(0, (vh - containerH) / 2);

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
};
