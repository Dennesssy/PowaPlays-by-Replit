window.Feedback = {
  async showInbox() {
    const container = document.getElementById('feedback-container');
    if (!container) return;

    if (!Auth.user) {
      container.innerHTML = `
        <div class="auth-prompt">
          <div class="auth-prompt-icon">P</div>
          <h2>Sign in to view feedback</h2>
          <p>Log in with your Replit account to see feedback on your projects.</p>
          <button class="btn btn-primary" onclick="window.location.href='/api/login?returnTo=/feedback'">Log In</button>
        </div>
      `;
      return;
    }

    container.innerHTML = '<div class="loading">Loading feedback...</div>';

    try {
      const data = await API.listFeedback();
      const items = data.items || [];

      let html = `
        <div class="feedback-toolbar">
          <div class="feedback-filters">
            <select id="fb-status-filter" class="fb-select">
              <option value="">All Status</option>
              <option value="open">Open</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="in_progress">In Progress</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
            <select id="fb-type-filter" class="fb-select">
              <option value="">All Types</option>
              <option value="bug">Bug</option>
              <option value="feature">Feature</option>
              <option value="suggestion">Suggestion</option>
              <option value="general">General</option>
            </select>
          </div>
          <span class="results-count">${items.length} item${items.length !== 1 ? 's' : ''}</span>
        </div>
        <div id="fb-list" class="feedback-list">
      `;

      if (items.length === 0) {
        html += '<p class="empty-state">No feedback yet. Share your project and watch the feedback roll in.</p>';
      } else {
        items.forEach((item) => {
          html += this._renderFeedbackRow(item);
        });
      }

      html += '</div>';
      container.innerHTML = html;

      container.querySelectorAll('.fb-row').forEach((row) => {
        row.addEventListener('click', () => {
          Router.navigate('/feedback/' + row.dataset.id);
        });
      });

      const statusFilter = document.getElementById('fb-status-filter');
      const typeFilter = document.getElementById('fb-type-filter');
      const refilter = async () => {
        const params = {};
        if (statusFilter.value) params.status = statusFilter.value;
        if (typeFilter.value) params.type = typeFilter.value;
        const filtered = await API.listFeedback(params);
        const list = document.getElementById('fb-list');
        if (filtered.items.length === 0) {
          list.innerHTML = '<p class="empty-state">No matching feedback.</p>';
        } else {
          list.innerHTML = filtered.items.map((i) => this._renderFeedbackRow(i)).join('');
          list.querySelectorAll('.fb-row').forEach((row) => {
            row.addEventListener('click', () => Router.navigate('/feedback/' + row.dataset.id));
          });
        }
      };
      statusFilter.addEventListener('change', refilter);
      typeFilter.addEventListener('change', refilter);
    } catch (err) {
      container.innerHTML = '<p class="error-state">Failed to load feedback.</p>';
    }
  },

  _renderFeedbackRow(item) {
    const statusClass = 'status-' + item.status.replace('_', '-');
    const statusLabel = item.status.replace('_', ' ');
    const typeIcon = { bug: 'B', feature: 'F', suggestion: 'S', general: 'G' }[item.type] || 'G';
    const age = this._timeAgo(item.createdAt);

    return `
      <div class="fb-row" data-id="${item.id}">
        <div class="fb-type-icon fb-type-${item.type}">${typeIcon}</div>
        <div class="fb-row-main">
          <div class="fb-row-title">${item.title}</div>
          <div class="fb-row-meta">
            ${item.projectTitle ? `<span class="fb-project">${item.projectTitle}</span>` : ''}
            <span class="fb-submitter">${item.submitterName || 'Anonymous'}</span>
            <span class="fb-age">${age}</span>
          </div>
        </div>
        <div class="fb-row-right">
          <span class="fb-status ${statusClass}">${statusLabel}</span>
          ${item.responseCount > 0 ? `<span class="fb-responses">${item.responseCount}</span>` : ''}
        </div>
      </div>
    `;
  },

  async showThread(id) {
    const container = document.getElementById('feedback-container');
    container.innerHTML = '<div class="loading">Loading thread...</div>';

    try {
      const data = await API.getFeedback(id);
      const fb = data.feedback;
      const responses = data.responses || [];
      const statusClass = 'status-' + fb.status.replace('_', '-');

      let canRespond = !!Auth.user;
      let canChangeStatus = !!Auth.user;

      let html = `
        <button class="btn btn-ghost btn-sm fb-back" onclick="Router.navigate('/feedback')">&larr; Back</button>
        <div class="fb-thread-header">
          <div class="fb-thread-title-row">
            <h2>${fb.title}</h2>
            <span class="fb-status ${statusClass}">${fb.status.replace('_', ' ')}</span>
          </div>
          <div class="fb-thread-meta">
            <span class="fb-type-badge fb-type-${fb.type}">${fb.type}</span>
            ${fb.projectTitle ? `<span class="fb-project">${fb.projectTitle}</span>` : ''}
            <span>by ${fb.submitterName || 'Anonymous'}</span>
            <span>${this._timeAgo(fb.createdAt)}</span>
            ${fb.assigneeName ? `<span>Assigned: ${fb.assigneeName}</span>` : ''}
          </div>
        </div>
        <div class="fb-thread-body">${this._escapeHtml(fb.body)}</div>
        <div class="fb-responses-list">
      `;

      responses.forEach((r) => {
        const roleClass = r.authorRole === 'internal' || r.authorRole === 'admin' ? 'fb-resp-internal' : '';
        html += `
          <div class="fb-response ${roleClass} ${r.isInternal ? 'fb-resp-private' : ''}">
            <div class="fb-resp-header">
              <span class="fb-resp-author">${r.authorName}</span>
              ${r.authorRole === 'internal' || r.authorRole === 'admin' ? '<span class="fb-badge-internal">INTERNAL</span>' : ''}
              ${r.isInternal ? '<span class="fb-badge-private">PRIVATE NOTE</span>' : ''}
              <span class="fb-resp-time">${this._timeAgo(r.createdAt)}</span>
            </div>
            ${r.newStatus ? `<div class="fb-resp-status">Status changed to <strong>${r.newStatus.replace('_', ' ')}</strong></div>` : ''}
            <div class="fb-resp-body">${this._escapeHtml(r.body)}</div>
          </div>
        `;
      });

      html += '</div>';

      if (canRespond) {
        html += `
          <div class="fb-reply-form">
            <textarea id="fb-reply-body" class="fb-textarea" placeholder="Write a response..." rows="3"></textarea>
            <div class="fb-reply-actions">
              ${canChangeStatus ? `
                <select id="fb-reply-status" class="fb-select">
                  <option value="">No status change</option>
                  <option value="acknowledged">Acknowledge</option>
                  <option value="in_progress">Mark In Progress</option>
                  <option value="resolved">Resolve</option>
                  <option value="closed">Close</option>
                  <option value="wont_fix">Won't Fix</option>
                </select>
                <label class="toggle-label">
                  <input type="checkbox" id="fb-reply-internal">
                  <span>Internal note</span>
                </label>
              ` : ''}
              <button class="btn btn-primary" id="fb-reply-submit">Reply</button>
            </div>
          </div>
        `;
      }

      container.innerHTML = html;

      if (canRespond) {
        document.getElementById('fb-reply-submit').addEventListener('click', async () => {
          const body = document.getElementById('fb-reply-body').value.trim();
          if (!body) return;
          const statusEl = document.getElementById('fb-reply-status');
          const internalEl = document.getElementById('fb-reply-internal');
          const payload = { body };
          if (statusEl && statusEl.value) payload.newStatus = statusEl.value;
          if (internalEl && internalEl.checked) payload.isInternal = true;

          try {
            await API.respondToFeedback(id, payload);
            this.showThread(id);
          } catch (err) {
            console.error('Failed to respond:', err);
          }
        });
      }
    } catch (err) {
      container.innerHTML = '<p class="error-state">Failed to load feedback thread.</p>';
    }
  },

  showSubmitForm(projectId, projectTitle) {
    const overlay = document.getElementById('feedback-submit-overlay');
    overlay.style.display = '';
    document.body.style.overflow = 'hidden';

    const form = document.getElementById('fb-submit-form');
    form.innerHTML = `
      <h2>Submit Feedback</h2>
      ${projectTitle ? `<p class="fb-submit-project">About: ${projectTitle}</p>` : ''}
      <div class="fb-field">
        <label>Type</label>
        <select id="fb-submit-type" class="fb-select">
          <option value="general">General Feedback</option>
          <option value="bug">Bug Report</option>
          <option value="feature">Feature Request</option>
          <option value="suggestion">Suggestion</option>
        </select>
      </div>
      <div class="fb-field">
        <label>Title</label>
        <input type="text" id="fb-submit-title" class="fb-input" placeholder="Brief summary..." required>
      </div>
      <div class="fb-field">
        <label>Details</label>
        <textarea id="fb-submit-body" class="fb-textarea" placeholder="Describe in detail..." rows="5" required></textarea>
      </div>
      ${!Auth.user ? `
        <div class="fb-field">
          <label>Your Name (optional)</label>
          <input type="text" id="fb-submit-name" class="fb-input" placeholder="Your name">
        </div>
        <div class="fb-field">
          <label>Email (optional, for follow-ups)</label>
          <input type="email" id="fb-submit-email" class="fb-input" placeholder="your@email.com">
        </div>
      ` : ''}
      <div class="fb-submit-actions">
        <button class="btn btn-ghost" id="fb-submit-cancel">Cancel</button>
        <button class="btn btn-primary" id="fb-submit-send">Submit</button>
      </div>
      <div id="fb-submit-status"></div>
    `;

    document.getElementById('fb-submit-cancel').addEventListener('click', () => this.hideSubmitForm());

    document.getElementById('fb-submit-send').addEventListener('click', async () => {
      const title = document.getElementById('fb-submit-title').value.trim();
      const body = document.getElementById('fb-submit-body').value.trim();
      const type = document.getElementById('fb-submit-type').value;
      const statusEl = document.getElementById('fb-submit-status');

      if (!title || !body) {
        statusEl.textContent = 'Please fill in the title and details.';
        statusEl.className = 'fb-submit-error';
        return;
      }

      const payload = { type, title, body, projectId: projectId || undefined };
      if (!Auth.user) {
        const nameEl = document.getElementById('fb-submit-name');
        const emailEl = document.getElementById('fb-submit-email');
        if (nameEl && nameEl.value) payload.name = nameEl.value;
        if (emailEl && emailEl.value) payload.email = emailEl.value;
      }

      try {
        statusEl.textContent = 'Submitting...';
        statusEl.className = '';
        await API.submitFeedback(payload);
        statusEl.textContent = 'Submitted successfully. Thank you for your feedback.';
        statusEl.className = 'fb-submit-success';
        setTimeout(() => this.hideSubmitForm(), 1500);
      } catch (err) {
        statusEl.textContent = 'Failed to submit. Please try again.';
        statusEl.className = 'fb-submit-error';
      }
    });
  },

  hideSubmitForm() {
    const overlay = document.getElementById('feedback-submit-overlay');
    overlay.style.display = 'none';
    document.body.style.overflow = '';
  },

  async showAdminOverview(targetContainer) {
    const container = targetContainer || document.getElementById('admin-feedback-container');
    if (!container) return;

    container.innerHTML = '<div class="loading">Loading overview...</div>';

    try {
      const data = await API.get('/api/admin/feedback/overview');
      const gc = data.globalCounts;
      const stats = data.userStats || [];
      const neglected = data.neglectedUsers || [];

      let html = `
        <div class="admin-global-stats">
          <div class="stat-card"><span class="stat-value">${gc.total}</span><span class="stat-label">Total</span></div>
          <div class="stat-card stat-open"><span class="stat-value">${gc.open}</span><span class="stat-label">Open</span></div>
          <div class="stat-card"><span class="stat-value">${gc.acknowledged}</span><span class="stat-label">Acknowledged</span></div>
          <div class="stat-card"><span class="stat-value">${gc.inProgress}</span><span class="stat-label">In Progress</span></div>
          <div class="stat-card stat-resolved"><span class="stat-value">${gc.resolved}</span><span class="stat-label">Resolved</span></div>
        </div>
      `;

      if (neglected.length > 0) {
        html += `
          <div class="admin-alert">
            <h3>Needs Attention</h3>
            <p>${neglected.length} user${neglected.length !== 1 ? 's have' : ' has'} unaddressed feedback:</p>
            <div class="admin-neglected">
        `;
        neglected.forEach((u) => {
          html += `
            <div class="neglected-user" data-owner="${u.ownerId}">
              <span class="neglected-name">${u.displayName || u.username}</span>
              <span class="neglected-count">${u.openCount} open</span>
              <button class="btn btn-ghost btn-sm" onclick="Feedback.viewUserFeedback('${u.ownerId}', '${u.username}')">View</button>
            </div>
          `;
        });
        html += '</div></div>';
      }

      html += '<h3 class="admin-section-title">Per-User Feedback Metrics</h3>';
      html += '<div class="admin-user-table">';
      html += `
        <div class="admin-table-header">
          <span>User</span>
          <span>Total</span>
          <span>Open</span>
          <span>Resolved</span>
          <span>Response Rate</span>
          <span>Avg Response</span>
          <span></span>
        </div>
      `;

      stats.forEach((u) => {
        const rateClass = u.responseRate >= 80 ? 'rate-good' : u.responseRate >= 50 ? 'rate-warn' : 'rate-bad';
        html += `
          <div class="admin-table-row">
            <span class="admin-user-cell">
              ${u.avatar ? `<img src="${u.avatar}" class="admin-user-avatar">` : ''}
              <span>${u.displayName || u.username}</span>
            </span>
            <span>${u.totalFeedback}</span>
            <span class="${u.openFeedback > 0 ? 'text-warn' : ''}">${u.openFeedback}</span>
            <span>${u.resolvedFeedback}</span>
            <span class="${rateClass}">${u.responseRate}%</span>
            <span>${u.avgResponseTimeHours > 0 ? u.avgResponseTimeHours + 'h' : '--'}</span>
            <span><button class="btn btn-ghost btn-sm" onclick="Feedback.viewUserFeedback('${u.ownerId}', '${u.username}')">Details</button></span>
          </div>
        `;
      });

      html += '</div>';
      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = '<p class="error-state">Failed to load admin overview.</p>';
    }
  },

  async viewUserFeedback(ownerId, username) {
    const container = document.getElementById('admin-feedback-container');
    container.innerHTML = '<div class="loading">Loading...</div>';

    try {
      const data = await API.listFeedback({ ownerId });
      const items = data.items || [];

      let html = `
        <button class="btn btn-ghost btn-sm fb-back" onclick="Feedback.showAdminOverview()">&larr; Back to Overview</button>
        <h3>Feedback for @${username}'s projects</h3>
        <div class="feedback-list">
      `;

      if (items.length === 0) {
        html += '<p class="empty-state">No feedback for this user.</p>';
      } else {
        items.forEach((item) => {
          html += this._renderFeedbackRow(item);
        });
      }
      html += '</div>';
      container.innerHTML = html;

      container.querySelectorAll('.fb-row').forEach((row) => {
        row.addEventListener('click', () => {
          Router.navigate('/feedback/' + row.dataset.id);
        });
      });
    } catch {
      container.innerHTML = '<p class="error-state">Failed to load user feedback.</p>';
    }
  },

  _timeAgo(dateStr) {
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = now - then;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    if (days < 30) return days + 'd ago';
    return new Date(dateStr).toLocaleDateString();
  },

  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, '<br>');
  },
};
