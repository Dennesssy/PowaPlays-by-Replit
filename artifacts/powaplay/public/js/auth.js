window.Auth = {
  user: null,
  _loading: true,
  _listeners: [],

  onChange(fn) {
    this._listeners.push(fn);
  },

  _notify() {
    this._listeners.forEach((fn) => fn(this.user, this._loading));
  },

  async init() {
    try {
      const data = await API.getMe();
      this.user = data.user || null;
    } catch {
      this.user = null;
    }
    this._loading = false;
    this._notify();
    this._renderAuthArea();
  },

  isInternal() {
    return this.user && (this.user.role === 'internal' || this.user.role === 'admin');
  },

  _renderAuthArea() {
    const area = document.getElementById('auth-area');
    if (!area) return;

    if (this._loading) {
      area.innerHTML = '<span class="auth-loading">...</span>';
      return;
    }

    if (this.user) {
      const name = escapeHtml(this.user.firstName || this.user.email || 'User');
      const avatar = this.user.profileImageUrl ? escapeHtml(this.user.profileImageUrl) : null;
      area.innerHTML = `
        <div class="user-menu">
          ${avatar ? `<img src="${avatar}" alt="" class="user-avatar">` : `<div class="user-avatar-placeholder">${name[0].toUpperCase()}</div>`}
          <span class="user-name">${name}</span>
          <a href="/api/logout" class="btn btn-ghost btn-sm">Log out</a>
        </div>
      `;
    } else {
      area.innerHTML = `<a href="/api/login?returnTo=/" class="btn btn-primary btn-sm">Log In</a>`;
    }
  },
};
