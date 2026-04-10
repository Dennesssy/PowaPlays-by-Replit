window.AdminDashboard = {
  _currentTab: 'overview',
  _data: null,

  init() {
    var tabs = document.querySelectorAll('#admin-tabs .admin-tab');
    var self = this;
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        tabs.forEach(function(t) { t.classList.remove('active'); });
        tab.classList.add('active');
        self._switchTab(tab.dataset.tab);
      });
    });
  },

  _switchTab(tab) {
    this._currentTab = tab;
    document.querySelectorAll('.admin-panel').forEach(function(p) { p.style.display = 'none'; });
    var panel = document.getElementById('admin-panel-' + tab);
    if (panel) panel.style.display = '';
    this['_load_' + tab]();
  },

  async load() {
    this.init();
    this._load_overview();
  },

  async _load_overview() {
    var panel = document.getElementById('admin-panel-overview');
    panel.innerHTML = '<div class="loading">Loading dashboard...</div>';

    try {
      var data = await API.get('/api/admin/dashboard?period=7d');
      this._data = data;

      var apm = data.apm || {};
      var uptime = this._formatUptime(apm.uptimeSeconds || 0);

      panel.innerHTML = '' +
        '<div class="admin-grid">' +
          this._metricCard('Projects', data.projects.total, data.projects.synced + ' synced') +
          this._metricCard('Users', data.users.total, data.users.admins + ' admins') +
          this._metricCard('Requests', apm.requestCount || 0, apm.errorRate + '% error rate') +
          this._metricCard('Latency (avg)', (apm.avgLatencyMs || 0) + 'ms', 'P95: ' + (apm.p95Ms || 0) + 'ms') +
          this._metricCard('Memory', (apm.memoryMb || 0) + 'MB', 'RSS: ' + (apm.rssMemoryMb || 0) + 'MB') +
          this._metricCard('Uptime', uptime, '') +
          this._metricCard('Active Alerts', data.alerts.active, data.alerts.critical + ' critical') +
          this._metricCard('Errors (7d)', data.errors.recent, data.errors.unresolved + ' unresolved') +
        '</div>' +
        '<div class="admin-2col">' +
          '<div class="admin-chart-card">' +
            '<div class="admin-chart-title">Project Distribution</div>' +
            '<div id="chart-projects"></div>' +
          '</div>' +
          '<div class="admin-chart-card">' +
            '<div class="admin-chart-title">Feedback Status</div>' +
            '<div id="chart-feedback"></div>' +
          '</div>' +
        '</div>' +
        '<div class="admin-chart-card">' +
          '<div class="admin-chart-title">System Composition</div>' +
          '<div id="chart-composition"></div>' +
        '</div>';

      this._renderBarChart('chart-projects', [
        { label: 'Total', value: data.projects.total, color: '#111' },
        { label: 'Public', value: data.projects.public, color: '#3182ce' },
        { label: 'Synced', value: data.projects.synced, color: '#38a169' },
        { label: 'w/ Thumb', value: data.projects.withThumbnail, color: '#805ad5' },
      ]);

      this._renderBarChart('chart-feedback', [
        { label: 'Open', value: data.feedback.open, color: '#d69e2e' },
        { label: 'In Progress', value: data.feedback.inProgress, color: '#805ad5' },
        { label: 'Resolved', value: data.feedback.resolved, color: '#38a169' },
        { label: 'Total', value: data.feedback.total, color: '#111' },
      ]);

      this._renderDonutChart('chart-composition', [
        { label: 'Regular Users', value: data.users.regular, color: '#3182ce' },
        { label: 'Admins', value: data.users.admins, color: '#805ad5' },
        { label: 'System', value: data.users.system, color: '#999' },
      ]);

    } catch (err) {
      panel.innerHTML = '<div class="error-state">Failed to load dashboard data.</div>';
    }
  },

  async _load_sync() {
    var panel = document.getElementById('admin-panel-sync');
    panel.innerHTML = '<div class="loading">Loading sync data...</div>';

    try {
      var [health, runs] = await Promise.all([
        API.get('/api/admin/sync/health'),
        API.get('/api/admin/sync/runs?limit=15'),
      ]);

      var healthClass = 'health-' + (health.health || 'unknown');
      var latest = health.latestRun;
      var stats24 = health.last24h || {};

      panel.innerHTML = '' +
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">' +
          '<span class="admin-health-indicator ' + healthClass + '">' + escapeHtml(health.health || 'unknown') + '</span>' +
          '<button class="btn btn-sm btn-ghost" id="trigger-sync-btn">Trigger Sync</button>' +
        '</div>' +
        (latest ? (
          '<div class="admin-grid" style="margin-bottom:20px">' +
            this._metricCard('Last Run', this._timeAgo(latest.startedAt), latest.status) +
            this._metricCard('Records', latest.recordsFetched, latest.recordsInserted + ' new, ' + latest.recordsUpdated + ' updated') +
            this._metricCard('Errors', latest.recordsErrored, '') +
            this._metricCard('Duration', (latest.durationMs ? (latest.durationMs / 1000).toFixed(1) + 's' : '-'), '') +
          '</div>'
        ) : '') +
        '<div class="admin-chart-card">' +
          '<div class="admin-chart-title">Last 24h: ' + (stats24.runs || 0) + ' runs, ' + (stats24.totalInserted || 0) + ' inserted, ' + (stats24.totalErrored || 0) + ' errors</div>' +
          '<div id="chart-sync-runs"></div>' +
        '</div>' +
        '<div class="admin-chart-card">' +
          '<div class="admin-chart-title">Recent Sync Runs</div>' +
          '<div id="sync-runs-list"></div>' +
        '</div>';

      var triggerBtn = document.getElementById('trigger-sync-btn');
      triggerBtn.addEventListener('click', async function() {
        triggerBtn.textContent = 'Syncing...';
        triggerBtn.disabled = true;
        try {
          await API.post('/api/admin/sync/trigger');
          AdminDashboard._load_sync();
        } catch (err) {
          triggerBtn.textContent = 'Failed';
        }
      });

      var runsList = document.getElementById('sync-runs-list');
      var allRuns = runs.runs || [];
      if (allRuns.length === 0) {
        runsList.innerHTML = '<div class="empty-state">No sync runs yet.</div>';
      } else {
        var runDurations = allRuns.filter(function(r) { return r.durationMs; }).reverse().map(function(r) {
          return { label: AdminDashboard._timeAgo(r.startedAt), value: r.durationMs / 1000, color: r.status === 'completed' ? '#38a169' : r.status === 'failed' ? '#e53e3e' : '#3182ce' };
        });
        if (runDurations.length > 0) {
          this._renderBarChart('chart-sync-runs', runDurations);
        }

        runsList.innerHTML = allRuns.map(function(r) {
          var statusClass = 'sync-' + (r.status || 'unknown');
          return '<div class="admin-sync-row">' +
            '<span class="sync-status-badge ' + statusClass + '">' + escapeHtml(r.status) + '</span>' +
            '<span style="flex:1">' + escapeHtml(r.recordsFetched || 0) + ' fetched, ' + (r.recordsInserted || 0) + ' new, ' + (r.recordsErrored || 0) + ' errors</span>' +
            '<span style="color:var(--text-muted);font-size:12px">' + (r.durationMs ? (r.durationMs / 1000).toFixed(1) + 's' : '-') + '</span>' +
            '<span style="color:var(--text-muted);font-size:11px">' + AdminDashboard._timeAgo(r.startedAt) + '</span>' +
          '</div>';
        }).join('');
      }

    } catch (err) {
      panel.innerHTML = '<div class="error-state">Failed to load sync data.</div>';
    }
  },

  async _load_apm() {
    var panel = document.getElementById('admin-panel-apm');
    panel.innerHTML = '<div class="loading">Loading APM data...</div>';

    try {
      var live = await API.get('/api/admin/apm/live');

      panel.innerHTML = '' +
        '<div class="admin-grid">' +
          this._metricCard('Requests', live.requestCount, 'since last flush') +
          this._metricCard('Error Rate', live.errorRate + '%', live.errorCount + ' errors') +
          this._metricCard('Avg Latency', live.avgLatencyMs + 'ms', '') +
          this._metricCard('P50', live.p50Ms + 'ms', '') +
          this._metricCard('P95', live.p95Ms + 'ms', '') +
          this._metricCard('P99', live.p99Ms + 'ms', '') +
          this._metricCard('Heap Memory', live.memoryMb + 'MB', '') +
          this._metricCard('RSS Memory', live.rssMemoryMb + 'MB', '') +
        '</div>' +
        '<div class="admin-2col">' +
          '<div class="admin-chart-card">' +
            '<div class="admin-chart-title">Status Code Distribution</div>' +
            '<div id="chart-status-codes"></div>' +
          '</div>' +
          '<div class="admin-chart-card">' +
            '<div class="admin-chart-title">Top Endpoints</div>' +
            '<div id="chart-top-paths"></div>' +
          '</div>' +
        '</div>';

      var statusEntries = Object.entries(live.statusCodes || {}).map(function(e) {
        var code = e[0];
        var color = code[0] === '2' ? '#38a169' : code[0] === '3' ? '#3182ce' : code[0] === '4' ? '#d69e2e' : '#e53e3e';
        return { label: code, value: e[1], color: color };
      });
      this._renderBarChart('chart-status-codes', statusEntries);

      var topPaths = (live.topPaths || []).slice(0, 10).map(function(p) {
        return { label: p.path, value: p.count, color: '#111' };
      });
      this._renderHorizontalBarChart('chart-top-paths', topPaths);

    } catch (err) {
      panel.innerHTML = '<div class="error-state">Failed to load APM data.</div>';
    }
  },

  async _load_alerts() {
    var panel = document.getElementById('admin-panel-alerts');
    panel.innerHTML = '<div class="loading">Loading alerts...</div>';

    try {
      var data = await API.get('/api/admin/alerts?limit=30');
      var alerts = data.alerts || [];

      if (alerts.length === 0) {
        panel.innerHTML = '<div class="empty-state">No active alerts.</div>';
        return;
      }

      panel.innerHTML = alerts.map(function(a) {
        var sevClass = 'alert-' + (a.severity || 'info');
        return '<div class="admin-alert-row">' +
          '<span class="alert-severity ' + sevClass + '">' + escapeHtml(a.severity) + '</span>' +
          '<span style="font-weight:600;flex:1">' + escapeHtml(a.title) + '</span>' +
          '<span style="color:var(--text-muted);font-size:12px">' + escapeHtml(a.category) + '</span>' +
          '<span style="color:var(--text-muted);font-size:11px">' + AdminDashboard._timeAgo(a.createdAt) + '</span>' +
          '<button class="btn btn-sm btn-ghost resolve-alert-btn" data-id="' + a.id + '">Resolve</button>' +
        '</div>';
      }).join('');

      panel.querySelectorAll('.resolve-alert-btn').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          try {
            await API.post('/api/admin/alerts/' + btn.dataset.id + '/resolve');
            btn.textContent = 'Done';
            btn.disabled = true;
            btn.closest('.admin-alert-row').style.opacity = '0.4';
          } catch (err) {
            btn.textContent = 'Error';
          }
        });
      });

    } catch (err) {
      panel.innerHTML = '<div class="error-state">Failed to load alerts.</div>';
    }
  },

  async _load_audit() {
    var panel = document.getElementById('admin-panel-audit');
    panel.innerHTML = '<div class="loading">Loading audit log...</div>';

    try {
      var data = await API.get('/api/admin/audit?limit=50');
      var entries = data.entries || [];

      if (entries.length === 0) {
        panel.innerHTML = '<div class="empty-state">No audit entries.</div>';
        return;
      }

      panel.innerHTML = '<div class="admin-chart-card"><div class="admin-chart-title">Recent Activity</div>' +
        entries.map(function(e) {
          return '<div class="admin-audit-row">' +
            '<span class="audit-action">' + escapeHtml(e.action) + '</span>' +
            '<span>' + escapeHtml(e.resource) + (e.resourceId ? ' #' + escapeHtml(e.resourceId) : '') + '</span>' +
            '<span style="color:var(--text-muted)">' + escapeHtml(e.actorRole || 'anon') + '</span>' +
            '<span class="audit-time">' + AdminDashboard._timeAgo(e.createdAt) + '</span>' +
          '</div>';
        }).join('') +
      '</div>';

    } catch (err) {
      panel.innerHTML = '<div class="error-state">Failed to load audit log.</div>';
    }
  },

  async _load_feedback() {
    var panel = document.getElementById('admin-panel-feedback');
    Feedback.showAdminOverview(panel);
  },

  _metricCard(label, value, sub) {
    return '<div class="admin-metric-card">' +
      '<div class="admin-metric-label">' + escapeHtml(label) + '</div>' +
      '<div class="admin-metric-value">' + escapeHtml(String(value)) + '</div>' +
      (sub ? '<div class="admin-metric-sub">' + escapeHtml(String(sub)) + '</div>' : '') +
    '</div>';
  },

  _renderBarChart(containerId, items) {
    var el = document.getElementById(containerId);
    if (!el || items.length === 0) return;

    var max = Math.max.apply(null, items.map(function(i) { return i.value; }));
    if (max === 0) max = 1;

    var barW = Math.max(20, Math.min(60, Math.floor(600 / items.length) - 8));
    var chartW = items.length * (barW + 8);
    var chartH = 140;
    var labelH = 36;
    var svgH = chartH + labelH;

    var bars = items.map(function(item, i) {
      var h = Math.max(2, (item.value / max) * (chartH - 20));
      var x = i * (barW + 8) + 4;
      var y = chartH - h;
      var labelTrunc = item.label.length > 8 ? item.label.slice(0, 7) + '..' : item.label;

      return '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + h + '" rx="4" fill="' + (item.color || '#111') + '" opacity="0.85">' +
        '<animate attributeName="height" from="0" to="' + h + '" dur="0.4s" fill="freeze"/>' +
        '<animate attributeName="y" from="' + chartH + '" to="' + y + '" dur="0.4s" fill="freeze"/>' +
      '</rect>' +
      '<text x="' + (x + barW / 2) + '" y="' + (y - 4) + '" text-anchor="middle" font-size="10" font-weight="600" fill="#111">' + item.value + '</text>' +
      '<text x="' + (x + barW / 2) + '" y="' + (chartH + 14) + '" text-anchor="middle" font-size="9" fill="#999">' + escapeHtml(labelTrunc) + '</text>';
    }).join('');

    el.innerHTML = '<svg class="admin-chart-svg" viewBox="0 0 ' + Math.max(chartW, 200) + ' ' + svgH + '" preserveAspectRatio="xMidYMid meet">' +
      '<line x1="0" y1="' + chartH + '" x2="' + chartW + '" y2="' + chartH + '" stroke="rgba(0,0,0,0.08)" stroke-width="1"/>' +
      bars +
    '</svg>';
  },

  _renderHorizontalBarChart(containerId, items) {
    var el = document.getElementById(containerId);
    if (!el || items.length === 0) return;

    var max = Math.max.apply(null, items.map(function(i) { return i.value; }));
    if (max === 0) max = 1;

    var rowH = 24;
    var svgH = items.length * rowH + 4;
    var labelW = 140;
    var chartW = 500;

    var bars = items.map(function(item, i) {
      var y = i * rowH + 2;
      var w = Math.max(2, (item.value / max) * (chartW - labelW - 50));
      var labelTrunc = item.label.length > 22 ? item.label.slice(0, 20) + '..' : item.label;

      return '<text x="0" y="' + (y + 15) + '" font-size="10" fill="#666" font-family="\'JetBrains Mono\', monospace">' + escapeHtml(labelTrunc) + '</text>' +
        '<rect x="' + labelW + '" y="' + (y + 3) + '" width="' + w + '" height="' + (rowH - 8) + '" rx="4" fill="' + (item.color || '#111') + '" opacity="0.7">' +
          '<animate attributeName="width" from="0" to="' + w + '" dur="0.35s" fill="freeze"/>' +
        '</rect>' +
        '<text x="' + (labelW + w + 6) + '" y="' + (y + 15) + '" font-size="10" font-weight="600" fill="#111">' + item.value + '</text>';
    }).join('');

    el.innerHTML = '<svg class="admin-chart-svg" viewBox="0 0 ' + chartW + ' ' + svgH + '" preserveAspectRatio="xMidYMid meet">' + bars + '</svg>';
  },

  _renderDonutChart(containerId, items) {
    var el = document.getElementById(containerId);
    if (!el) return;

    var total = items.reduce(function(s, i) { return s + i.value; }, 0);
    if (total === 0) { el.innerHTML = '<div class="empty-state">No data</div>'; return; }

    var size = 160;
    var cx = size / 2;
    var cy = size / 2;
    var r = 60;
    var strokeW = 18;
    var circumference = 2 * Math.PI * r;
    var offset = 0;

    var arcs = items.map(function(item) {
      var pct = item.value / total;
      var dash = pct * circumference;
      var gap = circumference - dash;
      var arc = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + item.color + '" stroke-width="' + strokeW + '" ' +
        'stroke-dasharray="' + dash + ' ' + gap + '" stroke-dashoffset="-' + offset + '" opacity="0.8" stroke-linecap="round">' +
        '<animate attributeName="stroke-dasharray" from="0 ' + circumference + '" to="' + dash + ' ' + gap + '" dur="0.6s" fill="freeze"/>' +
      '</circle>';
      offset += dash;
      return arc;
    }).join('');

    var legend = items.map(function(item) {
      return '<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;font-size:12px">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + item.color + ';display:inline-block"></span>' +
        escapeHtml(item.label) + ' (' + item.value + ')' +
      '</span>';
    }).join('');

    el.innerHTML = '<div style="display:flex;align-items:center;gap:24px">' +
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="rgba(0,0,0,0.04)" stroke-width="' + strokeW + '"/>' +
        arcs +
        '<text x="' + cx + '" y="' + (cy + 4) + '" text-anchor="middle" font-size="20" font-weight="700" fill="#111">' + total + '</text>' +
      '</svg>' +
      '<div>' + legend + '</div>' +
    '</div>';
  },

  _renderLineChart(containerId, points, color) {
    var el = document.getElementById(containerId);
    if (!el || points.length === 0) return;

    var chartW = 500;
    var chartH = 120;
    var max = Math.max.apply(null, points.map(function(p) { return p.value; }));
    if (max === 0) max = 1;

    var pathPoints = points.map(function(p, i) {
      var x = (i / Math.max(1, points.length - 1)) * chartW;
      var y = chartH - (p.value / max) * (chartH - 10);
      return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');

    var areaPath = pathPoints + ' L' + chartW + ',' + chartH + ' L0,' + chartH + ' Z';

    el.innerHTML = '<svg class="admin-chart-svg" viewBox="0 0 ' + chartW + ' ' + (chartH + 20) + '" preserveAspectRatio="xMidYMid meet">' +
      '<defs><linearGradient id="area-grad-' + containerId + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + color + '" stop-opacity="0.15"/><stop offset="100%" stop-color="' + color + '" stop-opacity="0.01"/></linearGradient></defs>' +
      '<path d="' + areaPath + '" fill="url(#area-grad-' + containerId + ')"/>' +
      '<path d="' + pathPoints + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round"/>' +
    '</svg>';
  },

  _timeAgo(iso) {
    if (!iso) return '-';
    var ms = Date.now() - new Date(iso).getTime();
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + 's ago';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    var d = Math.floor(h / 24);
    return d + 'd ago';
  },

  _formatUptime(seconds) {
    var h = Math.floor(seconds / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
  },
};
