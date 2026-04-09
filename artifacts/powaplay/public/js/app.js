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
    document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
    const page = document.getElementById('page-' + id);
    if (page) page.classList.add('active');

    const filterBar = document.getElementById('filter-bar');
    filterBar.style.display = id === 'discover' ? '' : 'none';

    this._trackPageView(location.pathname);
  },

  async _showDiscover() {
    this._showPage('discover');
    try {
      const data = await API.getProjects();
      Canvas.setProjects(data.projects || []);
      this._updateResultsCount(data.projects.length);
    } catch (err) {
      console.error('Failed to load projects:', err);
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
    Feedback.showAdminOverview();
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

      header.innerHTML = `
        <div class="profile-card">
          ${profile.avatarUrl ? `<img src="${profile.avatarUrl}" alt="" class="profile-avatar">` : `<div class="profile-avatar-placeholder">${(profile.displayName || username)[0].toUpperCase()}</div>`}
          <div class="profile-info">
            <h1 class="profile-name">${profile.displayName || username}</h1>
            <p class="profile-username">@${profile.username}</p>
            ${profile.bio ? `<p class="profile-bio">${profile.bio}</p>` : ''}
            <p class="profile-count">${profile.projectCount} public project${profile.projectCount !== 1 ? 's' : ''}</p>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="navigator.clipboard.writeText(location.href)">Share</button>
        </div>
      `;

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

        const tags = (p.tags || []).map((t) => `<span class="tile-tag">${t}</span>`).join('');
        row.innerHTML = `
          <div class="row-thumb">
            ${p.thumbnailUrl ? `<img src="${p.thumbnailUrl}" alt="">` : `<div class="row-thumb-placeholder" style="background: linear-gradient(135deg, hsl(${(p.id * 47) % 360}, 60%, 15%), hsl(${(p.id * 47 + 40) % 360}, 70%, 25%))">${(p.title || 'P')[0]}</div>`}
          </div>
          <div class="row-info">
            <div class="row-title">${p.title}</div>
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

  _applyFilters() {
    const count = Canvas.filter(this.currentTag, this.currentStyle, this.currentSearch);
    this._updateResultsCount(count);

    const clearBtn = document.getElementById('clear-filters');
    clearBtn.style.display = (this.currentTag || this.currentStyle || this.currentSearch) ? '' : 'none';
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

    iframe.src = project.url;
    iframe.style.display = '';
    fallback.style.display = 'none';

    iframe.onerror = () => {
      iframe.style.display = 'none';
      fallback.style.display = '';
      document.getElementById('fallback-visit').href = project.url;
    };

    API.trackEvent({ event: 'project_view', projectId: project.id, sessionId: this._sessionId });

    const tags = (project.tags || []).map((t) => `<span class="tile-tag">${t}</span>`).join('');

    meta.innerHTML = `
      <h2 class="overlay-title">${project.title}</h2>
      <a href="/u/${project.ownerUsername}" class="overlay-owner" data-link>
        ${project.ownerAvatarUrl ? `<img src="${project.ownerAvatarUrl}" alt="" class="overlay-avatar">` : ''}
        <span>@${project.ownerUsername}</span>
      </a>
      ${project.description ? `<p class="overlay-desc">${project.description}</p>` : ''}
      <div class="overlay-tags">${tags}</div>
      <div class="overlay-actions">
        <button class="btn btn-primary" onclick="window.open('${project.url}', '_blank')">Visit</button>
        <button class="btn btn-ghost overlay-fav-btn" data-id="${project.id}">
          ${project.favoriteCount || 0} Favorites
        </button>
        <button class="btn btn-ghost" onclick="Feedback.showSubmitForm(${project.id}, '${(project.title || '').replace(/'/g, "\\'")}')">Send Feedback</button>
        <button class="btn btn-ghost" onclick="navigator.clipboard.writeText(location.origin + '/u/${project.ownerUsername}')">Share</button>
      </div>
    `;

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
};

document.addEventListener('DOMContentLoaded', () => App.init());
