window.App = {
  currentTag: null,
  currentStyle: null,
  currentSearch: '',
  _sessionId: null,

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

    this._setupFilters();
    this._setupOverlay();
    this._setupRoutes();
    this._setupMobile();

    await Auth.init();
    Auth.onChange(() => {
      this._updateAdminNav();
      if (Router._current === '/dashboard') this._showDashboard();
      if (Router._current === '/feedback') Feedback.showInbox();
      if (Router._current === '/admin') Feedback.showAdminOverview();
      Notifications.init();
    });

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

    const filterBar = document.getElementById('filter-bar');
    const appMain = document.getElementById('app-main');
    const showFilter = id === 'discover';
    filterBar.style.display = showFilter ? '' : 'none';
    appMain.classList.toggle('with-filter-bar', showFilter);

    this._trackPageView(location.pathname);
  },

  _discoverPage: 1,
  _discoverTotal: 0,
  _discoverLoading: false,
  _discoverAllLoaded: false,

  async _showDiscover() {
    this._showPage('discover');
    this._discoverPage = 1;
    this._discoverAllLoaded = false;
    try {
      const data = await API.getProjects({ page: 1, limit: 50 });
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

    if (!this._canvasObserver) {
      const sentinel = document.createElement('div');
      sentinel.id = 'canvas-sentinel';
      sentinel.style.cssText = 'position:absolute;bottom:0;width:1px;height:1px;';
    }
  },

  async _loadMoreProjects() {
    if (this._discoverLoading || this._discoverAllLoaded) return;
    this._discoverLoading = true;
    this._discoverPage++;
    try {
      const data = await API.getProjects({ page: this._discoverPage, limit: 50 });
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

  _setupFilters() {
    document.querySelectorAll('.chip[data-filter]').forEach((chip) => {
      chip.addEventListener('click', () => {
        const filter = chip.dataset.filter;
        const value = chip.dataset.value;

        if (filter === 'tag') {
          if (this.currentTag === value) {
            this.currentTag = null;
            chip.classList.remove('active');
          } else {
            document.querySelectorAll('.chip[data-filter="tag"]').forEach((c) => c.classList.remove('active'));
            this.currentTag = value;
            chip.classList.add('active');
          }
        } else if (filter === 'style') {
          if (this.currentStyle === value) {
            this.currentStyle = null;
            chip.classList.remove('active');
          } else {
            document.querySelectorAll('.chip[data-filter="style"]').forEach((c) => c.classList.remove('active'));
            this.currentStyle = value;
            chip.classList.add('active');
          }
        }

        this._applyFilters();
      });
    });

    const searchInput = document.getElementById('search-input');
    let debounce;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        this.currentSearch = searchInput.value.trim();
        this._applyFilters();
      }, 200);
    });

    document.getElementById('clear-filters').addEventListener('click', () => {
      this.currentTag = null;
      this.currentStyle = null;
      this.currentSearch = '';
      searchInput.value = '';
      document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      this._applyFilters();
    });
  },

  async _applyFilters() {
    const clearBtn = document.getElementById('clear-filters');
    const hasFilters = this.currentTag || this.currentStyle || this.currentSearch;
    clearBtn.style.display = hasFilters ? '' : 'none';

    const params = { limit: 100 };
    if (this.currentTag) params.tag = this.currentTag;
    if (this.currentStyle) params.style = this.currentStyle;
    if (this.currentSearch) params.search = this.currentSearch;

    try {
      const data = await API.getProjects(params);
      Canvas.setProjects(data.projects || []);
      this._updateResultsCount(data.total || data.projects.length);
      this._discoverTotal = data.total || 0;
      this._discoverPage = 1;
      this._discoverAllLoaded = hasFilters || (data.projects || []).length >= this._discoverTotal;
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
    iframe.src = liveUrl;
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
    const safeDesc = escapeHtml(project.description);

    meta.innerHTML = `
      <h2 class="overlay-title">${safeTitle}</h2>
      <div class="overlay-owner">
        ${project.ownerAvatarUrl ? `<img src="${escapeHtml(project.ownerAvatarUrl)}" alt="" class="overlay-avatar">` : ''}
        <span>${safeDisplayName}</span>
      </div>
      ${project.description ? `<p class="overlay-desc">${safeDesc}</p>` : ''}
      <div class="overlay-tags">${tags}</div>
      <div class="overlay-actions">
        <button class="btn btn-primary overlay-visit-btn">Visit</button>
        ${project.replitUrl ? `<button class="btn btn-ghost overlay-replit-btn">View on Replit</button>` : ''}
        <button class="btn btn-ghost overlay-fav-btn" data-id="${project.id}">
          ${project.favoriteCount || 0} Favorites
        </button>
        <button class="btn btn-ghost overlay-feedback-btn">Send Feedback</button>
        <button class="btn btn-ghost overlay-share-btn">Share</button>
      </div>
    `;

    meta.querySelector('.overlay-visit-btn').addEventListener('click', () => window.open(liveUrl, '_blank'));
    const replitBtn = meta.querySelector('.overlay-replit-btn');
    if (replitBtn) replitBtn.addEventListener('click', () => window.open(project.replitUrl, '_blank'));
    meta.querySelector('.overlay-feedback-btn').addEventListener('click', () => Feedback.showSubmitForm(project.id, project.title || ''));
    meta.querySelector('.overlay-share-btn').addEventListener('click', () => navigator.clipboard.writeText(location.origin + '/u/' + (project.ownerUsername || '')));

    const favBtn = meta.querySelector('.overlay-fav-btn');
    if (favBtn) {
      favBtn.addEventListener('click', async () => {
        if (!Auth.user) {
          window.location.href = '/api/login?returnTo=/';
          return;
        }
        try {
          await API.addFavorite(project.id);
          project.favoriteCount = (project.favoriteCount || 0) + 1;
          favBtn.textContent = project.favoriteCount + ' Favorites';
        } catch {}
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

  _mobileFilterOpen: false,
  _mobileActiveTab: 'types',

  _setupMobile() {
    const filterBtn = document.getElementById('mobile-filter-btn');
    const filterOverlay = document.getElementById('mobile-filter-overlay');
    const filterBackdrop = document.getElementById('mobile-filter-backdrop');
    const filterDone = document.getElementById('mobile-filter-done');
    const indexBtn = document.getElementById('mobile-index-btn');
    const feedbackBtn = document.getElementById('mobile-feedback-btn');
    const refreshBtn = document.getElementById('mobile-nav-refresh');

    if (!filterBtn) return;

    filterBtn.addEventListener('click', () => this._openMobileFilter());

    filterBackdrop.addEventListener('click', () => this._closeMobileFilter());
    filterDone.addEventListener('click', () => this._closeMobileFilter());

    indexBtn.addEventListener('click', () => {
      Router.navigate('/');
      this._updateMobilePill('index');
    });

    feedbackBtn.addEventListener('click', () => {
      Router.navigate('/feedback');
      this._updateMobilePill('feedback');
    });

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this._showDiscover();
      });
    }

    document.querySelectorAll('.mobile-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.mobile-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        this._mobileActiveTab = tab.dataset.mtab;
        this._renderMobileFilterList();
      });
    });

    const mobileSearch = document.getElementById('mobile-search-input');
    let mDebounce;
    mobileSearch.addEventListener('input', () => {
      clearTimeout(mDebounce);
      mDebounce = setTimeout(() => {
        this.currentSearch = mobileSearch.value.trim();
        document.getElementById('search-input').value = this.currentSearch;
        this._applyFilters();
      }, 300);
    });

    document.querySelectorAll('.mobile-top-pill-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mobile-top-pill-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const nav = btn.dataset.mnav;
        if (nav === 'discover') Router.navigate('/');
        if (nav === 'info') Router.navigate('/dashboard');
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

  _openMobileFilter() {
    const overlay = document.getElementById('mobile-filter-overlay');
    overlay.classList.add('open');
    this._mobileFilterOpen = true;
    this._buildMobileFilterChips();
    this._renderMobileFilterList();
  },

  _closeMobileFilter() {
    const overlay = document.getElementById('mobile-filter-overlay');
    overlay.classList.remove('open');
    this._mobileFilterOpen = false;
  },

  _buildMobileFilterChips() {
    const container = document.getElementById('mobile-filter-chips');
    const tagCounts = {};
    Canvas.projects.forEach((p) => {
      (p.tags || []).forEach((t) => {
        const lower = t.toLowerCase();
        tagCounts[lower] = (tagCounts[lower] || 0) + 1;
      });
    });

    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    const icons = { ai: '🤖', productivity: '⚡', saas: '☁️', education: '📚', game: '🎮', fintech: '💰', health: '🏥', social: '💬', marketplace: '🏪', community: '👥', automation: '⚙️', travel: '✈️' };

    container.innerHTML = topTags.map(([tag]) => {
      const display = tag.charAt(0).toUpperCase() + tag.slice(1);
      const icon = icons[tag] || '📦';
      const isActive = this.currentTag === tag ? ' active' : '';
      return `<button class="mf-chip${isActive}" data-mftag="${tag}"><span class="mf-chip-icon">${icon}</span>${display}</button>`;
    }).join('');

    container.querySelectorAll('.mf-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const tag = chip.dataset.mftag;
        if (this.currentTag === tag) {
          this.currentTag = null;
          chip.classList.remove('active');
        } else {
          container.querySelectorAll('.mf-chip').forEach((c) => c.classList.remove('active'));
          this.currentTag = tag;
          chip.classList.add('active');
        }
        document.querySelectorAll('.chip[data-filter="tag"]').forEach((c) => c.classList.remove('active'));
        if (this.currentTag) {
          const desktopChip = document.querySelector(`.chip[data-value="${this.currentTag}"]`);
          if (desktopChip) desktopChip.classList.add('active');
        }
        this._applyFilters();
        this._renderMobileFilterList();
      });
    });
  },

  _renderMobileFilterList() {
    const list = document.getElementById('mobile-filter-list');
    const tab = this._mobileActiveTab;

    const tagCounts = {};
    Canvas.projects.forEach((p) => {
      (p.tags || []).forEach((t) => {
        const lower = t.toLowerCase();
        tagCounts[lower] = (tagCounts[lower] || 0) + 1;
      });
    });

    let items = [];

    if (tab === 'types') {
      const typeKeys = ['ai', 'productivity', 'saas', 'education', 'game', 'fintech', 'health', 'social', 'marketplace', 'community', 'automation', 'travel', 'tool', 'analytics', 'design', 'portfolio', 'chat', 'music', 'video', 'photo'];
      typeKeys.forEach((key) => {
        if (tagCounts[key]) {
          items.push({ name: key.charAt(0).toUpperCase() + key.slice(1), count: tagCounts[key], tag: key });
        }
      });
      Object.entries(tagCounts)
        .filter(([k]) => !typeKeys.includes(k))
        .sort((a, b) => b[1] - a[1])
        .forEach(([key, count]) => {
          items.push({ name: key.charAt(0).toUpperCase() + key.slice(1), count, tag: key });
        });
    } else if (tab === 'styles') {
      const styleMap = {};
      Canvas.projects.forEach((p) => {
        if (p.style) {
          const s = p.style.toLowerCase();
          styleMap[s] = (styleMap[s] || 0) + 1;
        }
      });
      Object.entries(styleMap).sort((a, b) => b[1] - a[1]).forEach(([key, count]) => {
        items.push({ name: key.charAt(0).toUpperCase() + key.slice(1), count, style: key });
      });
      if (items.length === 0) {
        items.push({ name: 'Minimal', count: Math.floor(Canvas.projects.length * 0.3), style: 'minimal' });
        items.push({ name: 'Modern', count: Math.floor(Canvas.projects.length * 0.25), style: 'modern' });
        items.push({ name: 'Playful', count: Math.floor(Canvas.projects.length * 0.15), style: 'playful' });
        items.push({ name: 'Corporate', count: Math.floor(Canvas.projects.length * 0.1), style: 'corporate' });
      }
    } else if (tab === 'frameworks') {
      const fwTags = ['react', 'vue', 'svelte', 'nextjs', 'express', 'flask', 'django', 'node', 'python', 'typescript', 'javascript', 'html', 'css', 'tailwind'];
      fwTags.forEach((fw) => {
        if (tagCounts[fw]) {
          items.push({ name: fw.charAt(0).toUpperCase() + fw.slice(1), count: tagCounts[fw], tag: fw });
        }
      });
    }

    items.sort((a, b) => b.count - a.count);

    list.innerHTML = items.map((item) => {
      const isActive = (item.tag && this.currentTag === item.tag) || (item.style && this.currentStyle === item.style);
      return `<div class="mf-list-item${isActive ? ' active' : ''}" data-mf-tag="${item.tag || ''}" data-mf-style="${item.style || ''}">
        <span class="mf-list-name">${escapeHtml(item.name)}</span>
        <span class="mf-list-count">${item.count}</span>
      </div>`;
    }).join('');

    list.querySelectorAll('.mf-list-item').forEach((row) => {
      row.addEventListener('click', () => {
        const tag = row.dataset.mfTag;
        const style = row.dataset.mfStyle;

        if (tag) {
          if (this.currentTag === tag) {
            this.currentTag = null;
          } else {
            this.currentTag = tag;
          }
          document.querySelectorAll('.chip[data-filter="tag"]').forEach((c) => c.classList.remove('active'));
          if (this.currentTag) {
            const desktopChip = document.querySelector(`.chip[data-value="${this.currentTag}"]`);
            if (desktopChip) desktopChip.classList.add('active');
          }
        }

        if (style) {
          if (this.currentStyle === style) {
            this.currentStyle = null;
          } else {
            this.currentStyle = style;
          }
        }

        this._applyFilters();
        this._buildMobileFilterChips();
        this._renderMobileFilterList();
      });
    });
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
