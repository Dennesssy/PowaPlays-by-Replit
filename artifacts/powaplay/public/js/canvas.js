window.Canvas = {
  el: null,
  container: null,
  x: 0,
  y: 0,
  scale: 1,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  lastX: 0,
  lastY: 0,
  velX: 0,
  velY: 0,
  rafId: null,
  projects: [],
  filtered: [],
  tiles: [],
  TILE_W: 320,
  TILE_H: 240,
  GAP: 20,
  COLS: 4,
  _lazyObserver: null,

  _isMobile() {
    return window.innerWidth <= 768;
  },

  _updateTileSize() {
    if (this._isMobile()) {
      const vw = window.innerWidth;
      this.TILE_W = vw - 32;
      this.TILE_H = Math.round(this.TILE_W * 0.72);
      this.GAP = 16;
      this.COLS = 1;
    } else {
      this.TILE_W = 320;
      this.TILE_H = 240;
      this.GAP = 20;
      this._updateCols();
    }
  },

  _initLazyLoading() {
    if (this._lazyObserver) return;
    if (!('IntersectionObserver' in window)) return;
    this._lazyObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const tile = entry.target;
          const lazySrc = tile.dataset.lazySrc;
          if (lazySrc) {
            const img = tile.querySelector('.tile-thumb-lazy');
            if (img) {
              img.src = lazySrc;
              img.onload = () => img.classList.add('loaded');
            }
            delete tile.dataset.lazySrc;
          }
          this._lazyObserver.unobserve(tile);
        }
      });
    }, { rootMargin: '200px' });
  },

  init(viewportEl, containerEl) {
    this.el = viewportEl;
    this.container = containerEl;
    this._bindEvents();
    this._updateTileSize();
    this._initLazyLoading();
    window.addEventListener('resize', () => {
      const wasMobile = this._lastMobileState;
      this._updateTileSize();
      if (wasMobile !== this._isMobile()) {
        this.render();
      }
      this._lastMobileState = this._isMobile();
    });
    this._lastMobileState = this._isMobile();
  },

  _updateCols() {
    if (!this.el) return;
    const w = this.el.clientWidth;
    this.COLS = Math.max(1, Math.floor(w / (this.TILE_W + this.GAP)));
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
      const tile = this._createTile(project, x, y, idx);
      this.container.appendChild(tile);
      this.tiles.push({ el: tile, x, y, project });
    });
    const rows = Math.ceil(this.filtered.length / cols);
    this.container.style.height = (rows * (this.TILE_H + this.GAP) - this.GAP) + 'px';
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
    this.container.innerHTML = '';
    this.tiles = [];
    this._updateTileSize();
    const cols = this.COLS;
    const isMobile = this._isMobile();

    if (isMobile) {
      this.container.style.left = '16px';
      this.container.style.top = '16px';
    } else {
      this.container.style.left = '50px';
      this.container.style.top = '50px';
    }

    this.filtered.forEach((project, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * (this.TILE_W + this.GAP);
      const y = row * (this.TILE_H + this.GAP);

      const tile = this._createTile(project, x, y, i);
      this.container.appendChild(tile);
      this.tiles.push({ el: tile, x, y, project });
    });

    const rows = Math.ceil(this.filtered.length / cols);
    this.container.style.width = (cols * (this.TILE_W + this.GAP) - this.GAP) + 'px';
    this.container.style.height = (rows * (this.TILE_H + this.GAP) - this.GAP) + 'px';
  },

  _createTile(project, x, y, index) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.style.left = x + 'px';
    tile.style.top = y + 'px';
    tile.style.width = this.TILE_W + 'px';
    tile.style.height = this.TILE_H + 'px';
    tile.style.animationDelay = Math.min(index * 40, 600) + 'ms';

    const initials = (project.title || 'P').slice(0, 2).toUpperCase();
    const hue = (project.id * 47) % 360;

    let thumbHtml;
    if (project.thumbnailUrl) {
      if (this._isMobile() && this._lazyObserver) {
        thumbHtml = `<img src="" alt="" class="tile-thumb tile-thumb-lazy" data-src="${escapeHtml(project.thumbnailUrl)}">`;
        tile.dataset.lazySrc = project.thumbnailUrl;
      } else {
        thumbHtml = `<img src="${escapeHtml(project.thumbnailUrl)}" alt="" class="tile-thumb" loading="lazy">`;
      }
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

    if (this._lazyObserver && tile.dataset.lazySrc) {
      this._lazyObserver.observe(tile);
    }

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
        touchId = e.touches[0].identifier;
        this.lastX = e.touches[0].clientX;
        this.lastY = e.touches[0].clientY;
        pointerDown(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });
    this.el.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && e.touches[0].identifier === touchId) {
        pointerMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });
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
    this.container.style.transform = `translate3d(${this.x}px, ${this.y}px, 0)`;
    this._checkEdge();
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
};
