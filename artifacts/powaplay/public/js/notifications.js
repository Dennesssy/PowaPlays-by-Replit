window.Notifications = {
  _items: [],
  _unreadCount: 0,
  _pollInterval: null,

  async init() {
    if (!Auth.user) return;
    await this.fetch();
    this._pollInterval = setInterval(() => this.fetch(), 30000);
    this._render();
  },

  async fetch() {
    if (!Auth.user) return;
    try {
      const data = await API.getNotifications();
      this._items = data.notifications || [];
      this._unreadCount = data.unreadCount || 0;
      this._updateBadge();
    } catch {}
  },

  _updateBadge() {
    const badge = document.getElementById('notif-badge');
    if (badge) {
      badge.textContent = this._unreadCount;
      badge.style.display = this._unreadCount > 0 ? '' : 'none';
    }
  },

  _render() {
    const bell = document.getElementById('notif-bell');
    if (!bell) return;
    bell.style.display = Auth.user ? '' : 'none';
  },

  toggle() {
    const panel = document.getElementById('notif-panel');
    if (panel.style.display === 'none' || !panel.style.display) {
      this._renderPanel();
      panel.style.display = '';
    } else {
      panel.style.display = 'none';
    }
  },

  _renderPanel() {
    const list = document.getElementById('notif-list');
    if (this._items.length === 0) {
      list.innerHTML = '<div class="notif-empty">No notifications</div>';
      return;
    }

    list.innerHTML = this._items.map((n) => {
      const readClass = n.read ? 'notif-read' : 'notif-unread';
      return `
        <div class="notif-item ${readClass}" data-id="${n.id}" data-url="${n.actionUrl || ''}">
          <div class="notif-title">${n.title}</div>
          ${n.body ? `<div class="notif-body">${n.body.slice(0, 100)}</div>` : ''}
          <div class="notif-time">${Feedback._timeAgo(n.createdAt)}</div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.notif-item').forEach((item) => {
      item.addEventListener('click', async () => {
        const id = parseInt(item.dataset.id);
        const url = item.dataset.url;
        await API.markNotificationRead(id);
        item.classList.remove('notif-unread');
        item.classList.add('notif-read');
        this._unreadCount = Math.max(0, this._unreadCount - 1);
        this._updateBadge();
        if (url) {
          document.getElementById('notif-panel').style.display = 'none';
          Router.navigate(url);
        }
      });
    });
  },

  destroy() {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  },
};
