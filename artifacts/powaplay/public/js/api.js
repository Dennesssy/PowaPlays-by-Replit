window.escapeHtml = function(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

window.API = {
  async _parseError(res) {
    try {
      const data = await res.json();
      return data.error || `HTTP ${res.status}`;
    } catch {
      return `HTTP ${res.status}`;
    }
  },

  async get(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      const msg = await this._parseError(res);
      throw new Error(msg);
    }
    return res.json();
  },

  async post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const msg = await this._parseError(res);
      throw new Error(msg);
    }
    return res.json();
  },

  async patch(url, body) {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const msg = await this._parseError(res);
      throw new Error(msg);
    }
    return res.json();
  },

  async del(url) {
    const res = await fetch(url, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) {
      const msg = await this._parseError(res);
      throw new Error(msg);
    }
    return res.json();
  },

  getProjects(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get('/api/projects' + (qs ? '?' + qs : ''));
  },

  getTags() {
    return this.get('/api/projects/tags');
  },

  getProject(id) {
    return this.get('/api/projects/' + encodeURIComponent(id));
  },

  getUserProfile(username) {
    return this.get('/api/users/' + encodeURIComponent(username) + '/profile');
  },

  getUserProjects(username) {
    return this.get('/api/users/' + encodeURIComponent(username) + '/projects');
  },

  getMe() {
    return this.get('/api/auth/user');
  },

  getMyProjects() {
    return this.get('/api/me/projects');
  },

  updateProject(id, data) {
    return this.patch('/api/me/projects/' + encodeURIComponent(id), data);
  },

  addFavorite(projectId) {
    return this.post('/api/favorites/' + encodeURIComponent(projectId));
  },

  removeFavorite(projectId) {
    return this.del('/api/favorites/' + encodeURIComponent(projectId));
  },

  getMyFavorites() {
    return this.get('/api/me/favorites');
  },

  submitFeedback(data) {
    return this.post('/api/feedback', data);
  },

  listFeedback(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get('/api/feedback' + (qs ? '?' + qs : ''));
  },

  getFeedback(id) {
    return this.get('/api/feedback/' + encodeURIComponent(id));
  },

  respondToFeedback(id, data) {
    return this.post('/api/feedback/' + encodeURIComponent(id) + '/respond', data);
  },

  updateFeedbackStatus(id, data) {
    return this.patch('/api/feedback/' + encodeURIComponent(id) + '/status', data);
  },

  trackEvent(data) {
    return this.post('/api/analytics/events', data).catch(() => {});
  },

  reportError(data) {
    return this.post('/api/analytics/errors', data).catch(() => {});
  },

  getAnalyticsDashboard(period = '7d') {
    return this.get('/api/admin/analytics?period=' + encodeURIComponent(period));
  },

  getNotifications() {
    return this.get('/api/me/notifications');
  },

  markNotificationRead(id) {
    return this.post('/api/me/notifications/' + encodeURIComponent(id) + '/read');
  },

  markAllNotificationsRead() {
    return this.post('/api/me/notifications/read-all');
  },

  getMyRepls() {
    return this.get('/api/me/repls');
  },

  importRepl(data) {
    return this.post('/api/me/repls/import', data);
  },

  getMyProjectAnalytics() {
    return this.get('/api/me/projects/analytics');
  },

  getUserAnalytics(userId) {
    return this.get('/api/admin/users/' + encodeURIComponent(userId) + '/analytics');
  },

  getAdminUsers(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get('/api/admin/users' + (qs ? '?' + qs : ''));
  },

  updateUserRole(userId, role) {
    return this.patch('/api/admin/users/' + encodeURIComponent(userId) + '/role', { role });
  },

  completeOnboarding() {
    return this.post('/api/me/onboarding/complete');
  },
};
