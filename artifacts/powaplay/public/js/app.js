window.App = {
  currentTag: null,
  currentStyle: null,
  currentSearch: '',
  _sessionId: null,
  _tagData: [],

  async init() {
    this._sessionId = this._generateSessionId();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    this._setupInstallPrompt();
    this._setupErrorTracking();

    Canvas.init(
      document.getElementById('canvas-viewport'),
      document.getElementById('canvas-container')
    );

    this._setupOverlay();
    this._setupRoutes();
    this._setupMobile();

    Auth.onChange(() => {
      this._updateAdminNav();
      this._updateMobileLoginBtn();
      if (Router._current === '/dashboard') this._showDashboard();
      if (Router._current === '/feedback') Feedback.showInbox();
      if (Router._current === '/admin') Feedback.showAdminOverview();
      Notifications.init();
    });
    await Auth.init();

    this._loadTagsAndBuildFilters();

    Router.init();
  },

  _generateSessionId() {
    let sid = sessionStorage.getItem('pp_sid');
    if (!sid) {
      sid = 'sess_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem('pp_sid', sid);
    }
    return sid;
  },

  _updateAdminNav() {
    const adminLink = document.querySelector('.nav-admin');
    if (adminLink && Auth.user && (Auth.user.role === 'internal' || Auth.user.role === 'admin')) {
      adminLink.style.display = '';
    }
  },

  _updateMobileLoginBtn() {
    const textEl = document.getElementById('mobile-login-text');
    if (!textEl) return;
    if (Auth.user) {
      textEl.textContent = Auth.user.firstName || 'Projects';
    } else {
      textEl.textContent = 'Log In';
    }
  },

  async _loadTagsAndBuildFilters() {
    try {
      const data = await API.getTags();
      this._tagData = data.tags || [];
    } catch {
      this._tagData = [
        { value: 'ai', count: 290 },
        { value: 'productivity', count: 103 },
        { value: 'saas', count: 72 },
        { value: 'education', count: 71 },
        { value: 'community', count: 59 },
        { value: 'fintech', count: 44 },
        { value: 'game', count: 39 },
        { value: 'social', count: 37 },
        { value: 'marketplace', count: 36 },
        { value: 'automation', count: 34 },
        { value: 'health', count: 33 },
        { value: 'travel', count: 31 },
      ];
    }

    this._buildFilterPanel();
    this._setupFilterOverlay();
  },

  _buildFilterPanel() {
    const chipsContainer = document.getElementById('filter-panel-chips');
    const listContainer = document.getElementById('filter-panel-list');
    if (!chipsContainer || !listContainer) return;

    chipsContainer.innerHTML = '';
    const topChips = this._tagData.slice(0, 6);
    topChips.forEach((t) => {
      const btn = document.createElement('button');
      btn.className = 'fp-chip';
      btn.dataset.tag = t.value;
      btn.innerHTML = `<span class="fp-chip-icon">◉</span> ${t.value.charAt(0).toUpperCase() + t.value.slice(1)}`;
      if (this.currentTag === t.value) btn.classList.add('active');
      chipsContainer.appendChild(btn);
    });

    this._renderFilterList('types');
  },

  _renderFilterList(tab) {
    const listContainer = document.getElementById('filter-panel-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    let items = [];
    const isStyleTab = tab === 'styles';

    if (tab === 'types') {
      items = this._tagData.slice(0, 20).map(t => ({ ...t, isTag: true }));
    } else if (tab === 'styles') {
      const styleNames = ['minimal', 'dark', 'colorful', 'glassmorphism', 'retro', 'modern', 'bold', 'clean', 'gradient', 'neon'];
      items = this._tagData.filter(t => styleNames.includes(t.value)).map(t => ({ ...t, isStyle: true }));
    } else if (tab === 'platforms') {
      const platNames = ['mobile app', 'web app', 'desktop', 'pwa', 'chrome extension', 'api', 'cli', 'discord bot', 'slack bot'];
      items = this._tagData.filter(t => platNames.includes(t.value)).map(t => ({ ...t, isTag: true }));
    }

    if (items.length === 0) {
      listContainer.innerHTML = '<div style="padding:20px 4px;color:rgba(255,255,255,0.4);font-size:14px;">No items in this category yet</div>';
      return;
    }

    items.forEach((t) => {
      const row = document.createElement('div');
      const isActive = t.isStyle ? this.currentStyle === t.value : this.currentTag === t.value;
      row.className = 'fp-list-item' + (isActive ? ' active' : '');
      if (t.isStyle) {
        row.dataset.style = t.value;
      } else {
        row.dataset.tag = t.value;
      }
      row.innerHTML = `<span class="fp-list-name">${t.value.charAt(0).toUpperCase() + t.value.slice(1)}</span><span class="fp-list-count">${t.count}</span>`;
      listContainer.appendChild(row);
    });
  },

  _trackPageView(path) {
    API.trackEvent({
      event: 'page_view',
      path: path,
      sessionId: this._sessionId,
      referrer: document.referrer,
    });
  },

  _setupErrorTracking() {
    window.addEventListener('error', (e) => {
      API.reportError({
        message: e.message,
        stack: e.error?.stack || '',
        path: location.pathname,
      });
    });

    window.addEventListener('unhandledrejection', (e) => {
      API.reportError({
        message: 'Unhandled rejection: ' + (e.reason?.message || String(e.reason)),
        stack: e.reason?.stack || '',
        path: location.pathname,
      });
    });
  },

  _setupRoutes() {
    Router.add('/', () => this._showDiscover());
    Router.add('/dashboard', () => this._showDashboard());
    Router.add('/feedback', () => this._showFeedback());
    Router.add('/feedback/:id', (params) => this._showFeedbackThread(params.id));
    Router.add('/admin', () => this._showAdmin());
    Router.add('/about', () => this._showAbout());
    Router.add('/u/:username', (params) => this._showProfile(params.username));
  },

  _showPage(id) {
    const current = document.querySelector('.page.active');
    const next = document.getElementById('page-' + id);
    if (!next || current === next) return;

    if (current) {
      current.classList.remove('active');
      current.classList.add('page-exit');
      current.addEventListener('animationend', function handler() {
        current.classList.remove('page-exit');
        current.removeEventListener('animationend', handler);
      }, { once: true });
    }

    next.classList.add('active');

    this._trackPageView(location.pathname);
  },

  _discoverPage: 1,
  _discoverTotal: 0,
  _discoverLoading: false,
  _discoverAllLoaded: false,

  async _showDiscover() {
    this._showPage('discover');

    const urlParams = new URLSearchParams(location.search);
    this.currentTag = urlParams.get('tag') || null;
    this.currentStyle = urlParams.get('style') || null;
    this.currentSearch = urlParams.get('q') || '';

    const searchInput = document.getElementById('search-input');
    if (searchInput && this.currentSearch) searchInput.value = this.currentSearch;

    this._syncFilterPanelState();

    this._discoverPage = 1;
    this._discoverAllLoaded = false;
    try {
      const params = { page: 1, limit: 50 };
      if (this.currentTag) params.tag = this.currentTag;
      if (this.currentStyle) params.style = this.currentStyle;
      if (this.currentSearch) params.search = this.currentSearch;

      const data = await API.getProjects(params);
      Canvas.setProjects(data.projects || []);
      this._discoverTotal = data.total || 0;
      this._updateResultsCount(this._discoverTotal);
      if ((data.projects || []).length < 50 || (data.projects || []).length >= this._discoverTotal) {
        this._discoverAllLoaded = true;
      }
      this._setupInfiniteScroll();
    } catch (err) {
      console.error('Failed to load projects:', err);
    }
  },

  _setupInfiniteScroll() {
    const viewport = document.getElementById('canvas-viewport');
    if (!viewport) return;
    if (viewport._scrollHandler) {
      viewport.removeEventListener('scroll', viewport._scrollHandler);
    }
    viewport._scrollHandler = () => this._checkLoadMore();
    viewport.addEventListener('scroll', viewport._scrollHandler);
  },

  async _loadMoreProjects() {
    if (this._discoverLoading || this._discoverAllLoaded) return;
    this._discoverLoading = true;
    this._discoverPage++;
    try {
      const params = { page: this._discoverPage, limit: 50 };
      if (this.currentTag) params.tag = this.currentTag;
      if (this.currentStyle) params.style = this.currentStyle;
      if (this.currentSearch) params.search = this.currentSearch;

      const data = await API.getProjects(params);
      const newProjects = data.projects || [];
      if (newProjects.length === 0) {
        this._discoverAllLoaded = true;
      } else {
        Canvas.appendProjects(newProjects);
      }
      if (Canvas.projects.length >= this._discoverTotal) {
        this._discoverAllLoaded = true;
      }
    } catch (err) {
      console.error('Failed to load more projects:', err);
      this._discoverPage--;
    }
    this._discoverLoading = false;
  },

  _checkLoadMore() {
    if (this._discoverAllLoaded || this._discoverLoading) return;
    const container = Canvas.container;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    if (containerRect.bottom < viewportHeight + 600) {
      this._loadMoreProjects();
    }
  },

  _showFeedback() {
    this._showPage('feedback');
    Feedback.showInbox();
  },

  _showFeedbackThread(id) {
    this._showPage('feedback-thread');
    const view = document.getElementById('feedback-thread-view');
    view.innerHTML = '<div id="feedback-container"></div>';
    Feedback.showThread(parseInt(id));
  },

  _showAdmin() {
    if (!Auth.user || (Auth.user.role !== 'internal' && Auth.user.role !== 'admin')) {
      Router.navigate('/');
      return;
    }
    this._showPage('admin');
    AdminDashboard.load();
  },

  _showAbout() {
    this._showPage('about');
    const countEl = document.getElementById('about-project-count');
    if (countEl && this._discoverTotal) {
      countEl.textContent = this._discoverTotal.toLocaleString() + '+';
    }
  },

  async _showProfile(username) {
    this._showPage('profile');
    const header = document.getElementById('profile-header');
    const grid = document.getElementById('profile-grid');

    header.innerHTML = '<div class="loading">Loading profile...</div>';
    grid.innerHTML = '';

    try {
      const [profile, projectsData] = await Promise.all([
        API.getUserProfile(username),
        API.getUserProjects(username),
      ]);

      const safeName = escapeHtml(profile.displayName || username);
      const safeUname = escapeHtml(profile.username);
      const safeBio = escapeHtml(profile.bio);
      header.innerHTML = `
        <div class="profile-card">
          ${profile.avatarUrl ? `<img src="${escapeHtml(profile.avatarUrl)}" alt="" class="profile-avatar">` : `<div class="profile-avatar-placeholder">${safeName[0].toUpperCase()}</div>`}
          <div class="profile-info">
            <h1 class="profile-name">${safeName}</h1>
            <p class="profile-username">@${safeUname}</p>
            ${profile.bio ? `<p class="profile-bio">${safeBio}</p>` : ''}
            <p class="profile-count">${profile.projectCount} public project${profile.projectCount !== 1 ? 's' : ''}</p>
          </div>
          <button class="btn btn-ghost btn-sm profile-share-btn">Share</button>
        </div>
      `;
      header.querySelector('.profile-share-btn').addEventListener('click', () => navigator.clipboard.writeText(location.href));

      const projects = projectsData.projects || [];
      if (projects.length === 0) {
        grid.innerHTML = '<p class="empty-state">No public projects yet.</p>';
        return;
      }

      grid.innerHTML = '';
      projects.forEach((p, i) => {
        const tile = Canvas._createTile(p, 0, 0, i);
        tile.style.position = 'relative';
        tile.style.left = 'auto';
        tile.style.top = 'auto';
        grid.appendChild(tile);
      });
    } catch {
      header.innerHTML = '<p class="error-state">User not found.</p>';
    }
  },

  async _showDashboard() {
    this._showPage('dashboard');
    const gate = document.getElementById('dashboard-auth-gate');
    const content = document.getElementById('dashboard-content');

    if (!Auth.user) {
      gate.style.display = '';
      content.style.display = 'none';
      return;
    }

    gate.style.display = 'none';
    content.style.display = '';

    const list = document.getElementById('dashboard-list');
    const stats = document.getElementById('dashboard-stats');
    list.innerHTML = '<div class="loading">Loading projects...</div>';

    try {
      const data = await API.getMyProjects();
      const projects = data.projects || [];

      const visible = projects.filter((p) => !p.isHidden).length;
      const totalFavs = projects.reduce((s, p) => s + (p.favoriteCount || 0), 0);
      stats.innerHTML = `
        <div class="stat-card"><span class="stat-value">${projects.length}</span><span class="stat-label">Total</span></div>
        <div class="stat-card"><span class="stat-value">${visible}</span><span class="stat-label">Visible</span></div>
        <div class="stat-card"><span class="stat-value">${totalFavs}</span><span class="stat-label">Favorites</span></div>
      `;

      if (projects.length === 0) {
        list.innerHTML = '<p class="empty-state">No projects yet. Create something on Replit and it will appear here.</p>';
        return;
      }

      list.innerHTML = '';
      projects.forEach((p) => {
        const row = document.createElement('div');
        row.className = 'dashboard-row' + (p.isHidden ? ' hidden-project' : '');

        const tags = (p.tags || []).map((t) => `<span class="tile-tag">${escapeHtml(t)}</span>`).join('');
        row.innerHTML = `
          <div class="row-thumb">
            ${p.thumbnailUrl ? `<img src="${escapeHtml(p.thumbnailUrl)}" alt="">` : `<div class="row-thumb-placeholder" style="background: linear-gradient(135deg, hsl(${(p.id * 47) % 360}, 40%, 92%), hsl(${(p.id * 47 + 40) % 360}, 50%, 85%))">${escapeHtml((p.title || 'P')[0])}</div>`}
          </div>
          <div class="row-info">
            <div class="row-title">${escapeHtml(p.title)}</div>
            <div class="row-tags">${tags}</div>
          </div>
          <div class="row-stats">
            <span class="row-favs">${p.favoriteCount || 0} favs</span>
          </div>
          <div class="row-actions">
            <label class="toggle-label">
              <input type="checkbox" class="toggle-hidden" data-id="${p.id}" ${p.isHidden ? '' : 'checked'}>
              <span class="toggle-text">${p.isHidden ? 'Hidden' : 'Visible'}</span>
            </label>
          </div>
        `;

        const toggle = row.querySelector('.toggle-hidden');
        toggle.addEventListener('change', async () => {
          const isHidden = !toggle.checked;
          try {
            await API.updateProject(p.id, { isHidden });
            row.classList.toggle('hidden-project', isHidden);
            row.querySelector('.toggle-text').textContent = isHidden ? 'Hidden' : 'Visible';
          } catch (err) {
            toggle.checked = !toggle.checked;
          }
        });

        list.appendChild(row);
      });
    } catch (err) {
      list.innerHTML = '<p class="error-state">Failed to load projects.</p>';
    }
  },

  _setupFilterOverlay() {
    const overlay = document.getElementById('filter-overlay');
    const backdrop = document.getElementById('filter-overlay-backdrop');
    const triggerBtn = document.getElementById('filter-trigger-btn');
    const mobileFilterBtn = document.getElementById('mobile-filter-btn');
    const doneBtn = document.getElementById('filter-done-btn');
    const clearBtn = document.getElementById('filter-clear-btn');
    const searchInput = document.getElementById('search-input');

    const openFilter = () => {
      overlay.classList.add('open');
      this._syncFilterPanelState();
      setTimeout(() => searchInput.focus(), 100);
    };

    const closeFilter = () => {
      overlay.classList.remove('open');
    };

    if (triggerBtn) triggerBtn.addEventListener('click', openFilter);
    if (mobileFilterBtn) mobileFilterBtn.addEventListener('click', openFilter);
    if (backdrop) backdrop.addEventListener('click', closeFilter);
    if (doneBtn) doneBtn.addEventListener('click', closeFilter);

    document.querySelectorAll('.filter-tab[data-ftab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this._renderFilterList(tab.dataset.ftab);
        this._syncFilterPanelState();
      });
    });

    document.getElementById('filter-panel-chips').addEventListener('click', (e) => {
      const chip = e.target.closest('.fp-chip');
      if (!chip) return;
      const tag = chip.dataset.tag;
      if (this.currentTag === tag) {
        this.currentTag = null;
      } else {
        this.currentTag = tag;
      }
      this._syncFilterPanelState();
      this._applyFilters();
    });

    document.getElementById('filter-panel-list').addEventListener('click', (e) => {
      const item = e.target.closest('.fp-list-item');
      if (!item) return;
      const tag = item.dataset.tag;
      const style = item.dataset.style;
      if (style) {
        if (this.currentStyle === style) {
          this.currentStyle = null;
        } else {
          this.currentStyle = style;
        }
      } else if (tag) {
        if (this.currentTag === tag) {
          this.currentTag = null;
        } else {
          this.currentTag = tag;
        }
      }
      this._syncFilterPanelState();
      this._applyFilters();
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.currentTag = null;
        this.currentStyle = null;
        this.currentSearch = '';
        searchInput.value = '';
        this._syncFilterPanelState();
        this._applyFilters();
      });
    }

    let debounce;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        this.currentSearch = searchInput.value.trim();
        this._applyFilters();
      }, 200);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('open')) {
        closeFilter();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        openFilter();
      }
    });
  },

  _syncFilterPanelState() {
    const hasFilters = this.currentTag || this.currentStyle || this.currentSearch;
    const triggerBtn = document.getElementById('filter-trigger-btn');
    const clearBtn = document.getElementById('filter-clear-btn');
    const countEl = document.getElementById('filter-active-count');

    if (triggerBtn) {
      triggerBtn.classList.toggle('has-filter', !!hasFilters);
      const label = triggerBtn.querySelector('span');
      if (label) {
        label.textContent = hasFilters ? (this.currentTag || this.currentSearch || 'Filtered') : 'Filter';
      }
    }

    if (clearBtn) clearBtn.style.display = hasFilters ? '' : 'none';
    if (countEl) {
      const activeLabel = this.currentTag || this.currentStyle || this.currentSearch || '';
      countEl.textContent = hasFilters ? `Filtering by: ${activeLabel}` : '';
    }

    document.querySelectorAll('.fp-chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.tag === this.currentTag);
    });
    document.querySelectorAll('.fp-list-item').forEach((item) => {
      const matchTag = item.dataset.tag && item.dataset.tag === this.currentTag;
      const matchStyle = item.dataset.style && item.dataset.style === this.currentStyle;
      item.classList.toggle('active', matchTag || matchStyle);
    });
  },

  async _applyFilters() {
    if (location.pathname === '/' || location.pathname === '') {
      const urlParams = new URLSearchParams();
      if (this.currentTag) urlParams.set('tag', this.currentTag);
      if (this.currentStyle) urlParams.set('style', this.currentStyle);
      if (this.currentSearch) urlParams.set('q', this.currentSearch);
      const qs = urlParams.toString();
      const newUrl = '/' + (qs ? '?' + qs : '');
      history.replaceState(null, '', newUrl);
    }

    this._syncFilterPanelState();

    const params = { page: 1, limit: 50 };
    if (this.currentTag) params.tag = this.currentTag;
    if (this.currentStyle) params.style = this.currentStyle;
    if (this.currentSearch) params.search = this.currentSearch;

    try {
      const data = await API.getProjects(params);
      Canvas.setProjects(data.projects || []);
      this._discoverTotal = data.total || 0;
      this._discoverPage = 1;
      this._updateResultsCount(this._discoverTotal);
      this._discoverAllLoaded = (data.projects || []).length >= this._discoverTotal;
    } catch (err) {
      console.error('Failed to filter projects:', err);
    }
  },

  _updateResultsCount(count) {
    document.getElementById('results-count').textContent = count + ' project' + (count !== 1 ? 's' : '');
  },

  openProject(project) {
    const overlay = document.getElementById('project-overlay');
    const iframe = document.getElementById('overlay-iframe');
    const fallback = document.getElementById('overlay-iframe-fallback');
    const meta = document.getElementById('overlay-meta');

    overlay.style.display = '';
    document.body.style.overflow = 'hidden';

    const liveUrl = project.demoUrl || project.url;
    const isValidUrl = /^https?:\/\//i.test(liveUrl || '');
    iframe.src = isValidUrl ? liveUrl : '';
    iframe.style.display = '';
    fallback.style.display = 'none';

    iframe.onerror = () => {
      iframe.style.display = 'none';
      fallback.style.display = '';
      document.getElementById('fallback-visit').href = liveUrl;
    };

    API.trackEvent({ event: 'project_view', projectId: project.id, sessionId: this._sessionId });

    const tags = (project.tags || []).map((t) => `<span class="tile-tag">${escapeHtml(t)}</span>`).join('');

    const safeTitle = escapeHtml(project.title);
    const safeDisplayName = escapeHtml(project.ownerDisplayName || project.ownerUsername);
    const safeOwner = escapeHtml(project.ownerUsername);
    const safeDesc = escapeHtml(project.description || '');
    const safeLiveUrl = escapeHtml(liveUrl || '');

    const descParagraphs = safeDesc ? safeDesc.split(/\n+/).filter(Boolean).map((p) => `<p>${p}</p>`).join('') : '';

    const createdDate = project.createdAt ? new Date(project.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

    meta.innerHTML = `
      <h2 class="overlay-title">${safeTitle}</h2>
      <a class="overlay-owner" href="/u/${safeOwner}" data-link>
        ${project.ownerAvatarUrl ? `<img src="${escapeHtml(project.ownerAvatarUrl)}" alt="" class="overlay-avatar">` : `<div class="overlay-avatar-placeholder">${(safeDisplayName[0] || 'U').toUpperCase()}</div>`}
        <span>${safeDisplayName}</span>
      </a>
      ${createdDate ? `<div class="overlay-date">${createdDate}</div>` : ''}
      ${descParagraphs ? `<div class="overlay-desc">${descParagraphs}</div>` : ''}
      <div class="overlay-tags">${tags}</div>
      ${safeLiveUrl ? `<div class="overlay-url"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg><span>${safeLiveUrl.replace(/^https?:\/\//, '').slice(0, 40)}</span></div>` : ''}
      <div class="overlay-actions">
        <button class="btn btn-primary overlay-visit-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          Visit App
        </button>
        <button class="btn btn-ghost overlay-fav-btn" data-id="${project.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          ${project.favoriteCount || 0} Favorites
        </button>
        ${project.replitUrl ? `<button class="btn btn-ghost overlay-replit-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          View on Replit
        </button>` : ''}
        <button class="btn btn-ghost overlay-feedback-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Send Feedback
        </button>
        <button class="btn btn-ghost overlay-share-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Share
        </button>
      </div>
    `;

    meta.querySelector('.overlay-visit-btn').addEventListener('click', () => window.open(liveUrl, '_blank'));
    const replitBtn = meta.querySelector('.overlay-replit-btn');
    if (replitBtn) replitBtn.addEventListener('click', () => window.open(project.replitUrl, '_blank'));
    meta.querySelector('.overlay-feedback-btn').addEventListener('click', () => Feedback.showSubmitForm(project.id, project.title || ''));
    meta.querySelector('.overlay-share-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(location.origin + '/u/' + (project.ownerUsername || ''));
      const btn = meta.querySelector('.overlay-share-btn');
      const orig = btn.innerHTML;
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
      setTimeout(() => { btn.innerHTML = orig; }, 1500);
    });

    const favBtn = meta.querySelector('.overlay-fav-btn');
    if (favBtn) {
      favBtn.addEventListener('click', async () => {
        if (favBtn.disabled) return;
        if (!Auth.user) {
          window.location.href = '/api/login?returnTo=/';
          return;
        }
        favBtn.disabled = true;
        try {
          await API.addFavorite(project.id);
          project.favoriteCount = (project.favoriteCount || 0) + 1;
          favBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg> ${project.favoriteCount} Favorites`;
        } catch { favBtn.disabled = false; }
      });
    }

    const ownerLink = meta.querySelector('.overlay-owner');
    if (ownerLink) {
      ownerLink.addEventListener('click', (e) => {
        e.preventDefault();
        overlay.style.display = 'none';
        document.body.style.overflow = '';
        iframe.src = '';
        Router.navigate('/u/' + (project.ownerUsername || ''));
      });
    }
  },

  _setupOverlay() {
    const overlay = document.getElementById('project-overlay');
    const close = () => {
      overlay.style.display = 'none';
      document.body.style.overflow = '';
      document.getElementById('overlay-iframe').src = '';
    };

    document.getElementById('overlay-close').addEventListener('click', close);
    document.getElementById('overlay-backdrop').addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (overlay.style.display !== 'none') close();
        const fbOverlay = document.getElementById('feedback-submit-overlay');
        if (fbOverlay.style.display !== 'none') Feedback.hideSubmitForm();
        if (this._mobileFilterOpen) this._closeMobileFilter();
      }
    });
  },

  _deferredPrompt: null,

  _setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this._deferredPrompt = e;
      const btn = document.getElementById('install-btn');
      btn.style.display = '';
      btn.addEventListener('click', async () => {
        if (this._deferredPrompt) {
          this._deferredPrompt.prompt();
          await this._deferredPrompt.userChoice;
          this._deferredPrompt = null;
          btn.style.display = 'none';
        }
      });
    });
  },

  _setupMobile() {
    const indexBtn = document.getElementById('mobile-index-btn');
    const feedbackBtn = document.getElementById('mobile-feedback-btn');
    const refreshBtn = document.getElementById('mobile-nav-refresh');
    const loginBtn = document.getElementById('mobile-login-btn');

    if (indexBtn) {
      indexBtn.addEventListener('click', () => {
        Router.navigate('/');
        this._updateMobilePill('index');
      });
    }

    if (feedbackBtn) {
      feedbackBtn.addEventListener('click', () => {
        Router.navigate('/feedback');
        this._updateMobilePill('feedback');
      });
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this._showDiscover();
      });
    }

    if (loginBtn) {
      loginBtn.addEventListener('click', () => {
        if (Auth.user) {
          Router.navigate('/dashboard');
        } else {
          window.location.href = '/api/login?returnTo=/dashboard';
        }
      });
    }

    document.querySelectorAll('.mobile-top-pill-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mobile-top-pill-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const nav = btn.dataset.mnav;
        if (nav === 'discover') Router.navigate('/');
        if (nav === 'about') Router.navigate('/about');
      });
    });
  },

  _updateMobilePill(active) {
    const pills = {
      index: document.getElementById('mobile-index-btn'),
      filter: document.getElementById('mobile-filter-btn'),
      feedback: document.getElementById('mobile-feedback-btn'),
    };
    Object.values(pills).forEach((p) => p && p.classList.remove('mobile-pill-active'));
    if (pills[active]) pills[active].classList.add('mobile-pill-active');
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
