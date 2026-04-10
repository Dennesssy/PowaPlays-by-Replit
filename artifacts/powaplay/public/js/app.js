window.App = {
  currentTag: null,
  currentStyle: null,
  currentSearch: '',
  currentSort: 'popular',
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
    this._setupHeroModal();

    Auth.onChange(() => {
      this._updateNavForAuth();
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

  _updateNavForAuth() {
    const isLoggedIn = !!Auth.user;
    const isAdmin = isLoggedIn && (Auth.user.role === 'internal' || Auth.user.role === 'admin');
    const isMaster = isLoggedIn && Auth.user.role === 'internal';

    document.querySelectorAll('.nav-authed').forEach(el => el.style.display = isLoggedIn ? '' : 'none');
    document.querySelectorAll('.nav-admin').forEach(el => el.style.display = isAdmin ? '' : 'none');
    document.querySelectorAll('.nav-visitor').forEach(el => el.style.display = isLoggedIn ? 'none' : '');
    document.querySelectorAll('.nav-authed-only').forEach(el => el.style.display = isLoggedIn ? '' : 'none');

    const profileBtn = document.getElementById('mobile-nav-profile');
    const lightningBtn = document.getElementById('mobile-nav-lightning');
    const projectsBtn = document.getElementById('mobile-projects-btn');
    const feedbackBtn = document.getElementById('mobile-feedback-btn');
    const loginPill = document.getElementById('mobile-login-pill');
    const adminBtn = document.getElementById('mobile-nav-admin');
    const loginBtn = document.getElementById('mobile-login-btn');

    if (profileBtn) profileBtn.style.display = isLoggedIn ? '' : 'none';
    if (lightningBtn) lightningBtn.style.display = isLoggedIn ? 'none' : '';
    if (projectsBtn) projectsBtn.style.display = isLoggedIn ? '' : 'none';
    if (feedbackBtn) feedbackBtn.style.display = isLoggedIn ? 'none' : '';
    if (loginPill) loginPill.style.display = isLoggedIn ? 'none' : '';
    if (adminBtn) adminBtn.style.display = isAdmin ? '' : 'none';
    if (loginBtn) {
      if (isLoggedIn) {
        loginBtn.querySelector('#mobile-login-text').textContent = Auth.user.firstName || 'Projects';
      } else {
        loginBtn.querySelector('#mobile-login-text').textContent = 'Log In';
      }
    }

    if (isLoggedIn && !Auth.user.onboardingCompleted) {
      this._showOnboardingModal();
    }
  },

  _showOnboardingModal() {
    const modal = document.getElementById('onboarding-modal');
    if (!modal) return;
    modal.style.display = '';

    const closeBtn = document.getElementById('onboarding-close');
    const doneBtn = document.getElementById('onboarding-done-btn');
    const backdrop = document.getElementById('onboarding-backdrop');

    const dismiss = () => {
      modal.style.display = 'none';
      API.completeOnboarding().catch(() => {});
      if (Auth.user) Auth.user.onboardingCompleted = true;
    };

    if (closeBtn) closeBtn.onclick = dismiss;
    if (doneBtn) doneBtn.onclick = dismiss;
    if (backdrop) backdrop.onclick = dismiss;
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
  _discoverNorthPage: 0,
  _discoverNorthAllLoaded: true,
  _discoverNorthLoading: false,

  async _showDiscover() {
    this._showPage('discover');

    const urlParams = new URLSearchParams(location.search);
    this.currentTag = urlParams.get('tag') || null;
    this.currentStyle = urlParams.get('style') || null;
    this.currentSearch = urlParams.get('q') || '';

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = this.currentSearch || '';

    this._syncFilterPanelState();

    this._discoverAllLoaded = false;
    this._discoverNorthLoading = false;
    try {
      const baseParams = {};
      if (this.currentTag) baseParams.tag = this.currentTag;
      if (this.currentStyle) baseParams.style = this.currentStyle;
      if (this.currentSearch) baseParams.search = this.currentSearch;
      if (this.currentSort && this.currentSort !== 'popular') baseParams.sort = this.currentSort;

      const explicitPage = parseInt(urlParams.get('page')) || 0;

      let startPage;
      if (explicitPage >= 1) {
        startPage = explicitPage;
      } else {
        const probe = await API.getProjects({ ...baseParams, page: 1, limit: 1 });
        const total = probe.total || 0;
        const totalPages = Math.ceil(total / 500);
        startPage = totalPages > 1 ? 2 : 1;
      }

      const data = await API.getProjects({ ...baseParams, page: startPage, limit: 500 });
      this._discoverTotal = data.total || 0;
      this._updateResultsCount(this._discoverTotal);

      this._discoverPage = startPage;
      this._discoverNorthPage = startPage - 1;
      this._discoverNorthAllLoaded = startPage <= 1;

      const projects = data.projects || [];
      Canvas.setProjects(projects);
      this._discoverAllLoaded = (startPage * 500) >= this._discoverTotal;
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
      const params = { page: this._discoverPage, limit: 500 };
      if (this.currentTag) params.tag = this.currentTag;
      if (this.currentStyle) params.style = this.currentStyle;
      if (this.currentSearch) params.search = this.currentSearch;
      if (this.currentSort && this.currentSort !== 'popular') params.sort = this.currentSort;

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

  async _loadMoreProjectsNorth() {
    if (this._discoverNorthLoading || this._discoverNorthAllLoaded) return;
    if (this._discoverNorthPage <= 0) {
      this._discoverNorthAllLoaded = true;
      return;
    }
    this._discoverNorthLoading = true;
    try {
      const params = { page: this._discoverNorthPage, limit: 500 };
      if (this.currentTag) params.tag = this.currentTag;
      if (this.currentStyle) params.style = this.currentStyle;
      if (this.currentSearch) params.search = this.currentSearch;
      if (this.currentSort && this.currentSort !== 'popular') params.sort = this.currentSort;

      const data = await API.getProjects(params);
      const newProjects = data.projects || [];
      if (newProjects.length === 0) {
        this._discoverNorthAllLoaded = true;
      } else {
        Canvas.prependProjects(newProjects);
        this._discoverNorthPage--;
        if (this._discoverNorthPage <= 0) {
          this._discoverNorthAllLoaded = true;
        }
      }
    } catch (err) {
      console.error('Failed to load projects northward:', err);
    }
    this._discoverNorthLoading = false;
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

  _dashCurrentTab: 'projects',

  async _showDashboard() {
    this._showPage('dashboard');
    const gate = document.getElementById('dashboard-auth-gate');
    const content = document.getElementById('dashboard-content');

    if (!Auth.user) {
      if (!Auth._loading) {
        window.location.href = '/api/login?returnTo=/dashboard';
      } else {
        gate.style.display = '';
        content.style.display = 'none';
      }
      return;
    }

    gate.style.display = 'none';
    content.style.display = '';

    const isAdmin = Auth.user.role === 'internal' || Auth.user.role === 'admin';
    const isMaster = Auth.user.role === 'internal';

    document.querySelectorAll('.dash-tab-admin').forEach(el => el.style.display = isAdmin ? '' : 'none');
    document.querySelectorAll('.dash-tab-master').forEach(el => el.style.display = isMaster ? '' : 'none');

    this._setupDashboardTabs();
    this._switchDashTab('projects');
  },

  _setupDashboardTabs() {
    const tabs = document.querySelectorAll('#dashboard-tabs .dash-tab');
    tabs.forEach(tab => {
      tab.onclick = () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this._switchDashTab(tab.dataset.dtab);
      };
    });
  },

  _switchDashTab(tab) {
    this._dashCurrentTab = tab;
    document.querySelectorAll('.dash-panel').forEach(p => p.style.display = 'none');
    const panel = document.getElementById('dash-panel-' + tab);
    if (panel) panel.style.display = '';

    if (tab === 'projects') this._loadDashProjects();
    else if (tab === 'import') this._loadImportRepls();
    else if (tab === 'analytics') this._loadMyAnalytics();
    else if (tab === 'platform') this._loadPlatformAnalytics();
    else if (tab === 'users') this._loadUserManagement();
    else if (tab === 'system') this._loadSystemDashboard();
  },

  async _loadDashProjects() {
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
        list.innerHTML = '<p class="empty-state">No projects yet. Import from Replit to get started!</p>';
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

  async _loadImportRepls() {
    const container = document.getElementById('import-repl-list');
    container.innerHTML = '<div class="loading">Fetching your public Repls from Replit...</div>';

    try {
      const data = await API.getMyRepls();
      const repls = data.repls || [];

      if (repls.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <p>No public Repls found for @${escapeHtml(data.username || Auth.user.username || '')}.</p>
            <p>Make sure you have public Repls on <a href="https://replit.com/@${escapeHtml(data.username || '')}" target="_blank" rel="noopener">your Replit profile</a>.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = `<p class="import-header">Found ${repls.length} public Repl${repls.length !== 1 ? 's' : ''} for @${escapeHtml(data.username || '')}</p>`;
      repls.forEach((r) => {
        const row = document.createElement('div');
        row.className = 'import-row' + (r.imported ? ' imported' : '');
        row.innerHTML = `
          <div class="import-icon">${r.iconUrl ? `<img src="${escapeHtml(r.iconUrl)}" alt="">` : `<div class="import-icon-placeholder">${escapeHtml((r.title || 'R')[0])}</div>`}</div>
          <div class="import-info">
            <div class="import-title">${escapeHtml(r.title)}</div>
            <div class="import-desc">${r.description ? escapeHtml(r.description).slice(0, 100) : '<span class="text-muted">No description</span>'}</div>
          </div>
          <div class="import-action">
            ${r.imported
              ? '<a href="/dashboard" class="import-status-done">Manage &rarr;</a>'
              : `<button class="btn btn-sm btn-primary import-btn">Import</button>`
            }
          </div>
        `;

        if (!r.imported) {
          const btn = row.querySelector('.import-btn');
          btn.addEventListener('click', async () => {
            btn.textContent = 'Importing...';
            btn.disabled = true;
            try {
              await API.importRepl({
                replId: r.id,
                slug: r.slug,
              });
              btn.outerHTML = '<a href="/dashboard" class="import-status-done">Manage &rarr;</a>';
              row.classList.add('imported');
            } catch (err) {
              btn.textContent = 'Failed';
              setTimeout(() => { btn.textContent = 'Import'; btn.disabled = false; }, 2000);
            }
          });
        }

        container.appendChild(row);
      });
    } catch (err) {
      container.innerHTML = '<p class="error-state">Failed to fetch Repls. Please try again.</p>';
    }
  },

  async _loadMyAnalytics() {
    const container = document.getElementById('analytics-content');
    container.innerHTML = '<div class="loading">Loading analytics...</div>';

    try {
      const data = await API.getMyProjectAnalytics();
      const summary = data.summary || {};
      const projects = data.projects || [];

      const trends = data.trends || { views: [], favorites: [] };

      container.innerHTML = `
        <div class="dashboard-stats">
          <div class="stat-card"><span class="stat-value">${summary.totalProjects || 0}</span><span class="stat-label">Projects</span></div>
          <div class="stat-card"><span class="stat-value">${summary.visibleCount || 0}</span><span class="stat-label">Visible</span></div>
          <div class="stat-card"><span class="stat-value">${summary.totalFavorites || 0}</span><span class="stat-label">Favorites</span></div>
          <div class="stat-card"><span class="stat-value">${summary.totalViews || 0}</span><span class="stat-label">Views</span></div>
        </div>
        ${trends.views.length > 0 || trends.favorites.length > 0 ? `
          <div class="trends-section">
            <h4 class="trends-title">Last 30 Days</h4>
            <div class="trends-grid">
              <div class="trend-chart">
                <div class="trend-chart-label">Views</div>
                <div class="trend-bars" id="trend-views-bars"></div>
              </div>
              <div class="trend-chart">
                <div class="trend-chart-label">Favorites</div>
                <div class="trend-bars" id="trend-favs-bars"></div>
              </div>
            </div>
          </div>
        ` : ''}
        <div class="analytics-project-list" id="analytics-project-list"></div>
      `;

      if (trends.views.length > 0) {
        this._renderTrendBars('trend-views-bars', trends.views);
      }
      if (trends.favorites.length > 0) {
        this._renderTrendBars('trend-favs-bars', trends.favorites);
      }

      const listEl = document.getElementById('analytics-project-list');
      if (projects.length === 0) {
        listEl.innerHTML = '<p class="empty-state">No project analytics yet.</p>';
        return;
      }

      listEl.innerHTML = projects.map(p => `
        <div class="analytics-row">
          <div class="analytics-row-title">${escapeHtml(p.title)}</div>
          <div class="analytics-row-metrics">
            <span class="analytics-metric"><strong>${p.views}</strong> views</span>
            <span class="analytics-metric"><strong>${p.favoriteCount}</strong> favs</span>
            <span class="analytics-metric"><strong>${p.feedbackCount}</strong> feedback</span>
          </div>
        </div>
      `).join('');
    } catch (err) {
      container.innerHTML = '<p class="error-state">Failed to load analytics.</p>';
    }
  },

  async _loadPlatformAnalytics() {
    const container = document.getElementById('platform-analytics-content');
    container.innerHTML = '<div class="loading">Loading platform analytics...</div>';

    try {
      const [data, analytics, growth] = await Promise.all([
        API.get('/api/admin/dashboard?period=7d'),
        API.get('/api/admin/analytics?period=7d').catch(() => ({})),
        API.get('/api/admin/users/growth?days=30').catch(() => ({})),
      ]);
      const apm = data.apm || {};
      const topProjects = analytics.topProjects || [];
      const fb = analytics.feedbackCounts || {};
      const growthRows = growth.growth || [];

      const maxGrowth = Math.max(1, ...growthRows.map(r => r.count));
      const growthBars = growthRows.length > 0
        ? growthRows.map(r => {
          const pct = Math.round((r.count / maxGrowth) * 100);
          const label = new Date(r.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          return `<div class="growth-bar-wrap" title="${label}: ${r.count} new users"><div class="growth-bar" style="height:${pct}%"></div><span class="growth-bar-val">${r.count}</span></div>`;
        }).join('')
        : '<p class="empty-state">No user registration data yet.</p>';

      const feedbackTotal = (fb.open || 0) + (fb.acknowledged || 0) + (fb.in_progress || 0) + (fb.resolved || 0) + (fb.closed || 0) || 1;
      const fbBreakdown = ['open', 'in_progress', 'resolved', 'closed'].map(s => {
        const count = fb[s] || 0;
        const pct = Math.round((count / feedbackTotal) * 100);
        return `<div class="fb-status-row"><span class="fb-status-label">${s.replace('_', ' ')}</span><div class="fb-status-bar-bg"><div class="fb-status-bar" style="width:${pct}%"></div></div><span class="fb-status-count">${count}</span></div>`;
      }).join('');

      container.innerHTML = `
        <div class="admin-grid">
          ${this._metricCard('Total Projects', data.projects.total, data.projects.synced + ' synced')}
          ${this._metricCard('Total Users', data.users.total, data.users.admins + ' admins')}
          ${this._metricCard('Feedback', data.feedback.total, data.feedback.open + ' open')}
          ${this._metricCard('Errors (7d)', data.errors.recent, data.errors.unresolved + ' unresolved')}
          ${this._metricCard('Active Alerts', data.alerts.active, data.alerts.critical + ' critical')}
          ${this._metricCard('Requests', apm.requestCount || 0, apm.errorRate + '% error rate')}
          ${this._metricCard('Avg Latency', (apm.avgLatencyMs || 0) + 'ms', 'P95: ' + (apm.p95Ms || 0) + 'ms')}
          ${this._metricCard('Memory', (apm.memoryMb || 0) + 'MB', 'RSS: ' + (apm.rssMemoryMb || 0) + 'MB')}
        </div>
        <h3>User Growth (30 days)</h3>
        <div class="growth-chart">${growthBars}</div>
        <h3>Top Projects (7d)</h3>
        ${topProjects.length === 0
          ? '<p class="empty-state">No project view data yet.</p>'
          : `<div class="top-projects-list">${topProjects.map((p, i) => `
            <div class="analytics-row">
              <span class="analytics-rank">#${i + 1}</span>
              <div class="analytics-row-title">${escapeHtml(p.title || 'Untitled')}</div>
              <div class="analytics-row-metrics">
                <span class="analytics-metric"><strong>${p.views}</strong> views</span>
              </div>
            </div>`).join('')}</div>`}
        <h3>Feedback Breakdown</h3>
        <div class="fb-breakdown">${fbBreakdown}</div>
      `;
    } catch (err) {
      container.innerHTML = '<p class="error-state">Failed to load platform analytics.</p>';
    }
  },

  async _loadUserManagement() {
    const container = document.getElementById('users-management-content');
    container.innerHTML = '<div class="loading">Loading users...</div>';

    try {
      const data = await API.getAdminUsers({ limit: 50 });
      const users = data.users || [];

      container.innerHTML = `
        <div class="user-mgmt-header">
          <h3>${data.total} users total</h3>
          <div id="view-as-user-section" class="view-as-section">
            <label>View analytics as user:</label>
            <select id="view-as-user-select" class="view-as-select">
              <option value="">Select a user...</option>
              ${users.map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.displayName || u.username || u.email || u.id)}</option>`).join('')}
            </select>
            <div id="view-as-analytics" style="margin-top:12px"></div>
          </div>
        </div>
        <div class="user-list" id="user-list"></div>
      `;

      const viewAsSelect = document.getElementById('view-as-user-select');
      viewAsSelect.addEventListener('change', async () => {
        const userId = viewAsSelect.value;
        const analyticsEl = document.getElementById('view-as-analytics');
        if (!userId) { analyticsEl.innerHTML = ''; return; }
        analyticsEl.innerHTML = '<div class="loading">Loading user analytics...</div>';
        try {
          const uData = await API.getUserAnalytics(userId);
          const s = uData.summary || {};
          analyticsEl.innerHTML = `
            <div class="dashboard-stats">
              <div class="stat-card"><span class="stat-value">${s.totalProjects || 0}</span><span class="stat-label">Projects</span></div>
              <div class="stat-card"><span class="stat-value">${s.totalViews || 0}</span><span class="stat-label">Views</span></div>
              <div class="stat-card"><span class="stat-value">${s.totalFavorites || 0}</span><span class="stat-label">Favorites</span></div>
              <div class="stat-card"><span class="stat-value">${s.totalFeedback || 0}</span><span class="stat-label">Feedback</span></div>
            </div>
            ${(uData.projects || []).map(p => `
              <div class="analytics-row">
                <div class="analytics-row-title">${escapeHtml(p.title)}</div>
                <div class="analytics-row-metrics">
                  <span class="analytics-metric"><strong>${p.views}</strong> views</span>
                  <span class="analytics-metric"><strong>${p.favoriteCount}</strong> favs</span>
                  <span class="analytics-metric"><strong>${p.feedbackCount}</strong> feedback</span>
                </div>
              </div>
            `).join('')}
          `;
        } catch (err) {
          analyticsEl.innerHTML = '<p class="error-state">Failed to load user analytics.</p>';
        }
      });

      const listEl = document.getElementById('user-list');
      listEl.innerHTML = users.map(u => `
        <div class="user-row">
          <div class="user-row-info">
            ${u.profileImageUrl ? `<img src="${escapeHtml(u.profileImageUrl)}" alt="" class="user-row-avatar">` : `<div class="user-row-avatar-ph">${escapeHtml((u.displayName || u.username || 'U')[0].toUpperCase())}</div>`}
            <div>
              <div class="user-row-name">${escapeHtml(u.displayName || u.username || 'Unknown')}</div>
              <div class="user-row-email">${escapeHtml(u.email || '')}</div>
            </div>
          </div>
          <div class="user-row-role">
            <select class="role-select" data-uid="${escapeHtml(u.id)}">
              <option value="user" ${u.role === 'user' ? 'selected' : ''}>User</option>
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
              <option value="internal" ${u.role === 'internal' ? 'selected' : ''}>Master</option>
            </select>
          </div>
        </div>
      `).join('');

      listEl.querySelectorAll('.role-select').forEach(sel => {
        sel.dataset.original = sel.value;
        sel.addEventListener('change', async () => {
          const prev = sel.dataset.original;
          try {
            await API.updateUserRole(sel.dataset.uid, sel.value);
            sel.dataset.original = sel.value;
          } catch (err) {
            sel.value = prev;
          }
        });
      });
    } catch (err) {
      container.innerHTML = '<p class="error-state">Failed to load users.</p>';
    }
  },

  async _loadSystemDashboard() {
    const container = document.getElementById('system-dashboard-content');
    container.innerHTML = '<div class="loading">Loading system data...</div>';

    try {
      const [live, health, alerts, audit, errors] = await Promise.all([
        API.get('/api/admin/apm/live'),
        API.get('/api/admin/sync/health'),
        API.get('/api/admin/alerts?limit=20'),
        API.get('/api/admin/audit?limit=20'),
        API.get('/api/admin/errors/fingerprints?limit=15').catch(() => ({ errors: [] })),
      ]);

      const healthClass = 'health-' + (health.health || 'unknown');
      const errorList = errors.errors || [];

      const errFingerprints = errorList.length === 0
        ? '<p class="empty-state">No errors recorded.</p>'
        : `<div class="error-fingerprint-list">${errorList.map(e => `
          <div class="error-fp-row">
            <span class="error-fp-level error-level-${escapeHtml(e.level || 'error')}">${escapeHtml(e.level || 'error')}</span>
            <span class="error-fp-msg" title="${escapeHtml(e.message || '')}">${escapeHtml((e.message || '').slice(0, 80))}${(e.message || '').length > 80 ? '…' : ''}</span>
            <span class="error-fp-count" title="occurrences">${e.occurrences}×</span>
            <button class="btn btn-ghost btn-xs error-fp-resolve" data-fp="${escapeHtml(e.fingerprint || '')}" ${e.resolvedAt ? 'disabled' : ''}>${e.resolvedAt ? 'Resolved' : 'Resolve'}</button>
          </div>`).join('')}</div>`;

      const sysConfig = `
        <div class="sys-config-grid">
          <div class="sys-config-row"><span class="sys-config-key">Environment</span><span class="sys-config-val">${escapeHtml(typeof process !== 'undefined' ? 'production' : 'development')}</span></div>
          <div class="sys-config-row"><span class="sys-config-key">Sync Interval</span><span class="sys-config-val">1 hour</span></div>
          <div class="sys-config-row"><span class="sys-config-key">Cache TTL</span><span class="sys-config-val">5 minutes</span></div>
          <div class="sys-config-row"><span class="sys-config-key">Rate Limit</span><span class="sys-config-val">100 req/min per IP</span></div>
          <div class="sys-config-row"><span class="sys-config-key">Body Limit</span><span class="sys-config-val">1 MB</span></div>
          <div class="sys-config-row"><span class="sys-config-key">Session</span><span class="sys-config-val">HTTP-only cookie</span></div>
        </div>`;

      container.innerHTML = `
        <h3>APM Live</h3>
        <div class="admin-grid">
          ${this._metricCard('Requests', live.requestCount, 'since flush')}
          ${this._metricCard('Error Rate', live.errorRate + '%', live.errorCount + ' errors')}
          ${this._metricCard('Avg Latency', live.avgLatencyMs + 'ms', '')}
          ${this._metricCard('P50', live.p50Ms + 'ms', '')}
          ${this._metricCard('P95', live.p95Ms + 'ms', '')}
          ${this._metricCard('P99', live.p99Ms + 'ms', '')}
          ${this._metricCard('Heap', live.memoryMb + 'MB', '')}
          ${this._metricCard('RSS', live.rssMemoryMb + 'MB', '')}
        </div>
        <h3>Sync Health: <span class="admin-health-indicator ${healthClass}">${escapeHtml(health.health || 'unknown')}</span></h3>
        ${health.latestRun ? `<p>Last run: ${escapeHtml(health.latestRun.status)} - ${health.latestRun.recordsFetched} fetched, ${health.latestRun.recordsInserted} new</p>` : '<p>No sync runs yet.</p>'}
        <h3>Error Fingerprinting (${errorList.length} unique)</h3>
        ${errFingerprints}
        <h3>Active Alerts (${(alerts.alerts || []).length})</h3>
        <div class="system-alerts-list">
          ${(alerts.alerts || []).length === 0 ? '<p class="empty-state">No active alerts.</p>' :
            (alerts.alerts || []).map(a => `
              <div class="admin-alert-row">
                <span class="alert-severity alert-${escapeHtml(a.severity)}">${escapeHtml(a.severity)}</span>
                <span style="flex:1;font-weight:600">${escapeHtml(a.title)}</span>
                <span style="color:var(--text-muted);font-size:12px">${escapeHtml(a.category)}</span>
              </div>
            `).join('')}
        </div>
        <h3>Recent Audit Log</h3>
        <div class="system-audit-list">
          ${(audit.entries || []).length === 0 ? '<p class="empty-state">No audit entries.</p>' :
            (audit.entries || []).map(e => `
              <div class="admin-audit-row">
                <span class="audit-action">${escapeHtml(e.action)}</span>
                <span>${escapeHtml(e.resource)}${e.resourceId ? ' #' + escapeHtml(e.resourceId) : ''}</span>
                <span style="color:var(--text-muted)">${escapeHtml(e.actorRole || 'anon')}</span>
              </div>
            `).join('')}
        </div>
        <h3>System Configuration</h3>
        ${sysConfig}
      `;

      container.querySelectorAll('.error-fp-resolve').forEach(btn => {
        btn.addEventListener('click', async () => {
          const fp = btn.dataset.fp;
          if (!fp || btn.disabled) return;
          btn.disabled = true;
          try {
            await API.post(`/api/admin/errors/${encodeURIComponent(fp)}/resolve`, {});
            btn.textContent = 'Resolved';
          } catch {
            btn.disabled = false;
          }
        });
      });
    } catch (err) {
      container.innerHTML = '<p class="error-state">Failed to load system data.</p>';
    }
  },

  _renderTrendBars(containerId, dataPoints) {
    const el = document.getElementById(containerId);
    if (!el || !dataPoints.length) return;
    const max = Math.max(...dataPoints.map(d => d.count), 1);
    el.innerHTML = dataPoints.map(d => {
      const pct = Math.max(2, (d.count / max) * 100);
      const label = d.date.slice(5);
      return `<div class="trend-bar-wrapper" title="${d.date}: ${d.count}">
        <div class="trend-bar" style="height:${pct}%"></div>
        <span class="trend-bar-label">${label}</span>
      </div>`;
    }).join('');
  },

  _metricCard(label, value, sub) {
    return `<div class="admin-metric-card"><div class="admin-metric-label">${escapeHtml(String(label))}</div><div class="admin-metric-value">${escapeHtml(String(value))}</div>${sub ? `<div class="admin-metric-sub">${escapeHtml(String(sub))}</div>` : ''}</div>`;
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

    document.querySelectorAll('.filter-sort-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.currentSort = btn.dataset.sort || 'popular';
        this._syncFilterPanelState();
        this._applyFilters();
      });
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
        label.textContent = hasFilters ? (this.currentTag || this.currentStyle || this.currentSearch || 'Filtered') : 'Filter';
      }
    }

    if (clearBtn) clearBtn.style.display = hasFilters ? '' : 'none';
    if (countEl) {
      const parts = [];
      if (this.currentTag) parts.push(this.currentTag);
      if (this.currentStyle) parts.push(this.currentStyle);
      if (this.currentSearch) parts.push(`"${this.currentSearch}"`);
      countEl.textContent = hasFilters ? `Filtering by: ${parts.join(', ')}` : '';
    }

    document.querySelectorAll('.filter-sort-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.sort === this.currentSort);
    });

    const filterCount = (this.currentTag ? 1 : 0) + (this.currentStyle ? 1 : 0) + (this.currentSearch ? 1 : 0);
    const badge = document.getElementById('mobile-filter-badge');
    if (badge) {
      if (filterCount > 0) {
        badge.textContent = filterCount;
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
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

  openHeroModal() {
    const modal = document.getElementById('hero-modal');
    if (modal) modal.style.display = '';
  },

  closeHeroModal() {
    const modal = document.getElementById('hero-modal');
    if (modal) modal.style.display = 'none';
  },

  _setupHeroModal() {
    const backdrop = document.getElementById('hero-modal-backdrop');
    const closeBtn = document.getElementById('hero-modal-close');
    if (backdrop) backdrop.addEventListener('click', () => this.closeHeroModal());
    if (closeBtn) closeBtn.addEventListener('click', () => this.closeHeroModal());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeHeroModal();
    });
  },

  async _applyFilters() {
    if (location.pathname === '/' || location.pathname === '') {
      const urlParams = new URLSearchParams();
      if (this.currentTag) urlParams.set('tag', this.currentTag);
      if (this.currentStyle) urlParams.set('style', this.currentStyle);
      if (this.currentSearch) urlParams.set('q', this.currentSearch);
      if (this.currentSort && this.currentSort !== 'popular') urlParams.set('sort', this.currentSort);
      const qs = urlParams.toString();
      const newUrl = '/' + (qs ? '?' + qs : '');
      history.replaceState(null, '', newUrl);
    }

    this._syncFilterPanelState();

    const baseParams = { limit: 500 };
    if (this.currentTag) baseParams.tag = this.currentTag;
    if (this.currentStyle) baseParams.style = this.currentStyle;
    if (this.currentSearch) baseParams.search = this.currentSearch;
    if (this.currentSort && this.currentSort !== 'popular') baseParams.sort = this.currentSort;

    try {
      const probe = await API.getProjects({ ...baseParams, page: 1, limit: 1 });
      const total = probe.total || 0;
      const totalPages = Math.ceil(total / 500);
      const startPage = totalPages > 1 ? 2 : 1;

      const data = await API.getProjects({ ...baseParams, page: startPage, limit: 500 });
      Canvas.setProjects(data.projects || []);
      this._discoverTotal = data.total || 0;
      this._discoverPage = startPage;
      this._discoverNorthPage = startPage - 1;
      this._discoverNorthAllLoaded = startPage <= 1;
      this._updateResultsCount(this._discoverTotal);
      this._discoverAllLoaded = (startPage * 500) >= this._discoverTotal;
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

    iframe.src = '';
    iframe.style.display = '';
    fallback.style.display = 'none';

    const showFallback = () => {
      iframe.style.display = 'none';
      fallback.style.display = '';
      const fallbackLink = document.getElementById('fallback-visit');
      if (fallbackLink && isValidUrl) fallbackLink.href = liveUrl;
    };

    if (!isValidUrl) {
      showFallback();
    } else {
      clearTimeout(this._iframeLoadTimer);
      this._iframeLoadTimer = setTimeout(showFallback, 8000);

      iframe.onload = () => {
        clearTimeout(this._iframeLoadTimer);
      };

      iframe.onerror = () => {
        clearTimeout(this._iframeLoadTimer);
        showFallback();
      };

      iframe.src = liveUrl;
    }

    API.trackEvent({ event: 'project_view', projectId: project.id, sessionId: this._sessionId });

    const tags = (project.tags || []).map((t) => `<span class="tile-tag">${escapeHtml(t)}</span>`).join('');

    const safeTitle = escapeHtml(project.title);
    const safeDisplayName = escapeHtml(project.ownerDisplayName || project.ownerUsername);
    const safeOwner = escapeHtml(project.ownerUsername);
    const safeDesc = escapeHtml(project.description || '');
    const safeLiveUrl = escapeHtml(liveUrl || '');

    const descParagraphs = safeDesc ? safeDesc.split(/\n+/).filter(Boolean).map((p) => `<p>${p}</p>`).join('') : '';

    const createdDate = project.createdAt ? new Date(project.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

    const timeAgo = project.createdAt ? this._timeAgo(new Date(project.createdAt)) : '';

    meta.innerHTML = `
      <h2 class="overlay-title">${safeTitle}</h2>
      <button class="btn btn-primary overlay-visit-btn" style="border-radius:999px;padding:10px 28px;font-size:15px;font-weight:700;margin-bottom:16px;">Visit</button>
      <div class="overlay-fav-count">${project.favoriteCount || 0} favorites</div>
      ${timeAgo ? `<div class="overlay-date">${timeAgo}</div>` : ''}
      ${descParagraphs ? `<div class="overlay-desc">${descParagraphs}</div>` : ''}
      <div class="overlay-tags">${tags}</div>
      <div class="overlay-actions">
        <button class="btn btn-ghost overlay-fav-btn" data-id="${project.id}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          Favorite
        </button>
        <button class="btn btn-ghost overlay-feedback-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Feedback
        </button>
        <button class="btn btn-ghost overlay-share-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Share
        </button>
      </div>
    `;

    meta.querySelector('.overlay-visit-btn').addEventListener('click', () => {
      if (isValidUrl) window.open(liveUrl, '_blank', 'noopener,noreferrer');
    });
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
      clearTimeout(App._iframeLoadTimer);
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

  _timeAgo(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    const intervals = [
      { label: 'y', seconds: 31536000 },
      { label: 'mo', seconds: 2592000 },
      { label: 'w', seconds: 604800 },
      { label: 'd', seconds: 86400 },
      { label: 'h', seconds: 3600 },
      { label: 'm', seconds: 60 },
    ];
    for (const i of intervals) {
      const count = Math.floor(seconds / i.seconds);
      if (count >= 1) return count + i.label + ' ago';
    }
    return 'just now';
  },

  _setupMobile() {
    const indexBtn = document.getElementById('mobile-index-btn');
    const feedbackBtn = document.getElementById('mobile-feedback-btn');
    const projectsBtn = document.getElementById('mobile-projects-btn');
    const refreshBtn = document.getElementById('mobile-nav-refresh');
    const loginBtn = document.getElementById('mobile-login-btn');
    const loginPill = document.getElementById('mobile-login-pill');
    const profileBtn = document.getElementById('mobile-nav-profile');
    const adminBtn = document.getElementById('mobile-nav-admin');

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

    if (projectsBtn) {
      projectsBtn.addEventListener('click', () => {
        Router.navigate('/dashboard');
        this._updateMobilePill('projects');
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

    if (loginPill) {
      loginPill.addEventListener('click', () => {
        window.location.href = '/api/login?returnTo=/';
      });
    }

    if (profileBtn) {
      profileBtn.addEventListener('click', () => {
        if (Auth.user && Auth.user.username) {
          Router.navigate('/u/' + Auth.user.username);
        } else {
          Router.navigate('/dashboard');
        }
      });
    }

    if (adminBtn) {
      adminBtn.addEventListener('click', () => {
        Router.navigate('/admin');
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
      projects: document.getElementById('mobile-projects-btn'),
    };
    Object.values(pills).forEach((p) => p && p.classList.remove('mobile-pill-active'));
    if (pills[active]) pills[active].classList.add('mobile-pill-active');
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
