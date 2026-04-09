window.API = {
  async get(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async patch(url, body) {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async del(url) {
    const res = await fetch(url, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  getProjects(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.get('/api/projects' + (qs ? '?' + qs : ''));
  },

  getProject(id) {
    return this.get('/api/projects/' + id);
  },

  getUserProfile(username) {
    return this.get('/api/users/' + username + '/profile');
  },

  getUserProjects(username) {
    return this.get('/api/users/' + username + '/projects');
  },

  getMe() {
    return this.get('/api/auth/user');
  },

  getMyProjects() {
    return this.get('/api/me/projects');
  },

  updateProject(id, data) {
    return this.patch('/api/me/projects/' + id, data);
  },

  addFavorite(projectId) {
    return this.post('/api/favorites/' + projectId);
  },

  removeFavorite(projectId) {
    return this.del('/api/favorites/' + projectId);
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
    return this.get('/api/feedback/' + id);
  },

  respondToFeedback(id, data) {
    return this.post('/api/feedback/' + id + '/respond', data);
  },

  updateFeedbackStatus(id, data) {
    return this.patch('/api/feedback/' + id + '/status', data);
  },

  trackEvent(data) {
    return this.post('/api/analytics/events', data).catch(() => {});
  },

  reportError(data) {
    return this.post('/api/analytics/errors', data).catch(() => {});
  },

  getAnalyticsDashboard(period = '7d') {
    return this.get('/api/admin/analytics?period=' + period);
  },

  getNotifications() {
    return this.get('/api/me/notifications');
  },

  markNotificationRead(id) {
    return this.post('/api/me/notifications/' + id + '/read');
  },
};
