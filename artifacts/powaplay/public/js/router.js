window.Router = {
  _routes: [],
  _current: null,

  add(pattern, handler) {
    this._routes.push({ pattern, handler });
  },

  navigate(path, replace = false) {
    if (replace) {
      history.replaceState(null, '', path);
    } else {
      history.pushState(null, '', path);
    }
    this._resolve();
  },

  _resolve() {
    const path = location.pathname;

    document.querySelectorAll('.nav-link').forEach((el) => {
      el.classList.toggle('active', el.getAttribute('href') === path);
    });

    for (const route of this._routes) {
      const match = this._match(route.pattern, path);
      if (match !== null) {
        this._current = path;
        route.handler(match);
        return;
      }
    }
  },

  _match(pattern, path) {
    if (pattern === path) return {};
    const patternParts = pattern.split('/');
    const pathParts = path.split('/');
    if (patternParts.length !== pathParts.length) return null;

    const params = {};
    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i].startsWith(':')) {
        params[patternParts[i].slice(1)] = decodeURIComponent(pathParts[i]);
      } else if (patternParts[i] !== pathParts[i]) {
        return null;
      }
    }
    return params;
  },

  init() {
    document.addEventListener('click', (e) => {
      const link = e.target.closest('[data-link]');
      if (link && link.href) {
        e.preventDefault();
        const url = new URL(link.href);
        this.navigate(url.pathname);
      }
    });

    window.addEventListener('popstate', () => this._resolve());
    this._resolve();
  },
};
