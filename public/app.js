// ---- API Helper ----
const api = {
  get: (url) => fetch(`/api${url}`).then(r => r.json()),
  post: (url, body) => fetch(`/api${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
  put: (url, body) => fetch(`/api${url}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
  del: (url) => fetch(`/api${url}`, { method: 'DELETE' }).then(r => r.json()),
};

// ---- Toast ----
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span> ${msg}`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ---- State ----
let currentPage = 'dashboard';
let status = {};
let stats = {};

// ---- Navigation ----
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => navigateTo(item.dataset.page));
});

function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page));
  render();
}

// ---- Time Formatting ----
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function initial(name) {
  return (name || '?').charAt(0).toUpperCase();
}

// ---- Render Engine ----
async function render() {
  status = await api.get('/status');
  updateSidebar();

  const titles = { dashboard: 'Dashboard', drafts: 'Draft Queue', emails: 'Email History', rules: 'Auto-Reply Rules', settings: 'Settings' };
  document.getElementById('page-title').textContent = titles[currentPage] || 'Dashboard';

  if (!status.authenticated && currentPage !== 'settings') {
    renderConnect();
    return;
  }

  const renderers = { dashboard: renderDashboard, drafts: renderDrafts, emails: renderEmails, rules: renderRules, settings: renderSettings };
  (renderers[currentPage] || renderDashboard)();
}

function updateSidebar() {
  const dot = document.getElementById('status-dot');
  const emailEl = document.getElementById('sidebar-email');
  dot.className = `status-dot ${status.authenticated ? (status.isRunning ? 'online' : 'offline') : 'offline'}`;
  emailEl.textContent = status.email || 'Not connected';
}

// ---- Connect Page ----
function renderConnect() {
  const topbar = document.getElementById('topbar-actions');
  topbar.innerHTML = '';
  document.getElementById('content').innerHTML = `
    <div class="connect-card">
      <div class="icon">📧</div>
      <h2>Connect Your Gmail</h2>
      <p>Link your Gmail account to get started. The agent will monitor your inbox and generate smart replies using Gemini AI.</p>
      <a href="/auth/google" class="btn btn-primary" style="text-decoration:none;font-size:15px;padding:13px 32px;">
        🔗 Connect Gmail Account
      </a>
    </div>`;
}

// ---- Dashboard ----
async function renderDashboard() {
  stats = await api.get('/stats');
  const topbar = document.getElementById('topbar-actions');
  topbar.innerHTML = status.isRunning
    ? `<button class="btn btn-danger btn-sm" onclick="toggleMonitor()">⏹ Stop Monitor</button>`
    : `<button class="btn btn-primary btn-sm" onclick="toggleMonitor()">▶️ Start Monitor</button>`;

  const drafts = await api.get('/drafts?status=pending');
  const recentDrafts = drafts.slice(0, 5);
  const badge = document.getElementById('draft-badge');
  badge.style.display = stats.pendingDrafts > 0 ? 'inline' : 'none';
  badge.textContent = stats.pendingDrafts;

  document.getElementById('content').innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon blue">📬</div>
        <div><div class="stat-value">${stats.totalEmails}</div><div class="stat-label">Total Emails</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon amber">📝</div>
        <div><div class="stat-value">${stats.pendingDrafts}</div><div class="stat-label">Pending Drafts</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green">✅</div>
        <div><div class="stat-value">${stats.sentReplies}</div><div class="stat-label">Sent Replies</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon cyan">⚡</div>
        <div><div class="stat-value">${stats.autoReplied}</div><div class="stat-label">Auto-Replied</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon rose">📋</div>
        <div><div class="stat-value">${stats.activeRules}</div><div class="stat-label">Active Rules</div></div>
      </div>
    </div>

    <div class="section-header">
      <h3>📝 Pending Drafts</h3>
      ${stats.pendingDrafts > 0 ? `<button class="btn btn-ghost btn-sm" onclick="navigateTo('drafts')">View All →</button>` : ''}
    </div>
    ${recentDrafts.length > 0 ? `<div class="list-container">${recentDrafts.map(d => draftRow(d)).join('')}</div>` :
      `<div class="empty-state"><div class="icon">🎉</div><h3>All clear!</h3><p>No pending drafts. ${status.isRunning ? 'The monitor is watching your inbox.' : 'Start the monitor to begin.'}</p></div>`}
  `;
}

// ---- Drafts ----
async function renderDrafts() {
  const topbar = document.getElementById('topbar-actions');
  topbar.innerHTML = `<select class="form-select" id="draft-filter" onchange="renderDrafts()" style="padding:7px 12px;font-size:12px;">
    <option value="pending">Pending</option><option value="sent">Sent</option><option value="rejected">Rejected</option><option value="all">All</option>
  </select>`;

  const filter = document.getElementById('draft-filter')?.value || 'pending';
  const drafts = await api.get(`/drafts?status=${filter}`);
  const badge = document.getElementById('draft-badge');
  const pendingCount = (await api.get('/drafts?status=pending')).length;
  badge.style.display = pendingCount > 0 ? 'inline' : 'none';
  badge.textContent = pendingCount;

  document.getElementById('content').innerHTML = drafts.length > 0
    ? `<div class="list-container">${drafts.map(d => draftRow(d)).join('')}</div>`
    : `<div class="empty-state"><div class="icon">📭</div><h3>No ${filter} drafts</h3><p>Drafts will appear here when the monitor processes new emails.</p></div>`;
}

function draftRow(d) {
  const statusColors = { pending: 'amber', sent: 'green', rejected: 'rose', approved: 'green' };
  return `<div class="email-row" onclick="openDraft(${d.id})">
    <div class="email-avatar">${initial(d.from_name)}</div>
    <div class="email-info">
      <div class="email-from">${d.from_name || d.from_email}</div>
      <div class="email-subject">${d.subject || '(no subject)'}</div>
      <div class="email-snippet">${d.snippet || ''}</div>
    </div>
    <div class="email-meta">
      <div class="email-date">${timeAgo(d.received_at)}</div>
      <span class="email-category cat-${d.category || 'other'}">${d.category || 'other'}</span>
      <div style="margin-top:4px"><span class="rule-tag ${statusColors[d.status] === 'green' ? 'auto' : statusColors[d.status] === 'amber' ? 'draft' : 'ignore'}">${d.status}</span></div>
    </div>
  </div>`;
}

async function openDraft(id) {
  const drafts = await api.get('/drafts?status=all');
  const d = drafts.find(x => x.id === id);
  if (!d) return;

  document.getElementById('modal-content').innerHTML = `
    <div class="modal-header">
      <h3>Review Draft Reply</h3>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="original-email">
      <div class="meta"><strong>From:</strong> ${d.from_name} &lt;${d.from_email}&gt;</div>
      <div class="meta"><strong>Subject:</strong> ${d.subject}</div>
      <div class="meta"><strong>Received:</strong> ${new Date(d.received_at).toLocaleString()}</div>
      <div class="body">${d.body_text || d.snippet || ''}</div>
    </div>
    <label class="form-label">AI-Generated Reply</label>
    <textarea class="reply-editor" id="reply-text">${d.reply_text}</textarea>
    ${d.status === 'pending' ? `
    <div class="modal-actions">
      <button class="btn btn-danger btn-sm" onclick="rejectDraft(${d.id})">✕ Reject</button>
      <button class="btn btn-ghost btn-sm" onclick="saveDraft(${d.id})">💾 Save Edit</button>
      <button class="btn btn-success btn-sm" onclick="approveDraft(${d.id})">✓ Approve & Send</button>
    </div>` : `<div class="modal-actions"><span class="rule-tag ${d.status === 'sent' ? 'auto' : 'ignore'}">${d.status}</span></div>`}
  `;
  document.getElementById('modal-overlay').classList.add('active');
}

async function approveDraft(id) {
  try {
    await api.post(`/drafts/${id}/approve`);
    toast('Reply sent successfully!', 'success');
    closeModal(); render();
  } catch { toast('Failed to send reply', 'error'); }
}

async function rejectDraft(id) {
  await api.post(`/drafts/${id}/reject`);
  toast('Draft rejected', 'info');
  closeModal(); render();
}

async function saveDraft(id) {
  const text = document.getElementById('reply-text').value;
  await api.put(`/drafts/${id}`, { reply_text: text });
  toast('Draft saved', 'success');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
}
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});

// ---- Emails ----
async function renderEmails() {
  const topbar = document.getElementById('topbar-actions');
  topbar.innerHTML = '';
  const { emails, total } = await api.get('/emails?limit=50');

  document.getElementById('content').innerHTML = emails.length > 0
    ? `<p style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">${total} emails processed</p>
       <div class="list-container">${emails.map(e => `
        <div class="email-row">
          <div class="email-avatar">${initial(e.from_name)}</div>
          <div class="email-info">
            <div class="email-from">${e.from_name || e.from_email}</div>
            <div class="email-subject">${e.subject || '(no subject)'}</div>
            <div class="email-snippet">${e.snippet || ''}</div>
          </div>
          <div class="email-meta">
            <div class="email-date">${timeAgo(e.received_at)}</div>
            <span class="email-category cat-${e.category || 'other'}">${e.category || 'other'}</span>
          </div>
        </div>`).join('')}</div>`
    : `<div class="empty-state"><div class="icon">📬</div><h3>No emails yet</h3><p>Processed emails will appear here once the monitor starts.</p></div>`;
}

// ---- Rules ----
async function renderRules() {
  const topbar = document.getElementById('topbar-actions');
  topbar.innerHTML = `<button class="btn btn-primary btn-sm" onclick="openAddRule()">+ Add Rule</button>`;
  const rules = await api.get('/rules');

  document.getElementById('content').innerHTML = rules.length > 0
    ? `<div class="rules-grid">${rules.map(r => `
        <div class="rule-card">
          <div class="rule-icon">${r.type === 'sender' ? '👤' : r.type === 'subject' ? '📋' : '📄'}</div>
          <div class="rule-info">
            <div class="rule-name">${r.name}</div>
            <div class="rule-detail">${r.type}: contains "${r.pattern}"${r.custom_instructions ? ` • ${r.custom_instructions.substring(0, 50)}` : ''}</div>
          </div>
          <span class="rule-tag ${r.action === 'auto_reply' ? 'auto' : r.action === 'draft' ? 'draft' : 'ignore'}">${r.action.replace('_', ' ')}</span>
          <button class="btn btn-danger btn-sm" onclick="deleteRule(${r.id})" style="margin-left:8px">✕</button>
        </div>`).join('')}</div>`
    : `<div class="empty-state"><div class="icon">⚡</div><h3>No rules yet</h3><p>Add rules to auto-reply to support emails or route specific senders.</p></div>`;
}

function openAddRule() {
  document.getElementById('modal-content').innerHTML = `
    <div class="modal-header">
      <h3>Add Auto-Reply Rule</h3>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="add-rule-form">
      <div class="form-group"><label class="form-label">Rule Name</label>
        <input class="form-input" id="rule-name" placeholder="e.g. Support Emails"></div>
      <div class="form-group"><label class="form-label">Match Type</label>
        <select class="form-select" id="rule-type"><option value="sender">Sender Email</option><option value="subject">Subject Line</option><option value="body">Body Content</option></select></div>
      <div class="form-group"><label class="form-label">Contains Pattern</label>
        <input class="form-input" id="rule-pattern" placeholder="e.g. support@ or help needed"></div>
      <div class="form-group"><label class="form-label">Action</label>
        <select class="form-select" id="rule-action"><option value="auto_reply">Auto Reply</option><option value="draft">Draft for Review</option><option value="ignore">Ignore</option></select></div>
      <div class="form-group"><label class="form-label">Custom AI Instructions (optional)</label>
        <input class="form-input" id="rule-instructions" placeholder="e.g. Be extra helpful, include FAQ link"></div>
      <div class="modal-actions"><button class="btn btn-primary" onclick="saveRule()">Save Rule</button></div>
    </div>`;
  document.getElementById('modal-overlay').classList.add('active');
}

async function saveRule() {
  const rule = {
    name: document.getElementById('rule-name').value,
    type: document.getElementById('rule-type').value,
    pattern: document.getElementById('rule-pattern').value,
    action: document.getElementById('rule-action').value,
    custom_instructions: document.getElementById('rule-instructions').value,
  };
  if (!rule.name || !rule.pattern) return toast('Name and pattern are required', 'error');
  await api.post('/rules', rule);
  toast('Rule created!', 'success');
  closeModal(); renderRules();
}

async function deleteRule(id) {
  await api.del(`/rules/${id}`);
  toast('Rule deleted', 'info');
  renderRules();
}

// ---- Settings ----
async function renderSettings() {
  const topbar = document.getElementById('topbar-actions');
  topbar.innerHTML = '';
  const settings = await api.get('/settings');

  document.getElementById('content').innerHTML = `
    <div class="card" style="max-width:680px;">
      <h3 style="font-size:15px;font-weight:600;margin-bottom:20px;">Profile & Reply Settings</h3>
      <div class="settings-grid">
        <div class="form-group"><label class="form-label">Your Name</label>
          <input class="form-input" id="s-user_name" value="${settings.user_name || ''}"></div>
        <div class="form-group"><label class="form-label">Email</label>
          <input class="form-input" id="s-user_email" value="${settings.user_email || ''}" disabled></div>
        <div class="form-group"><label class="form-label">Role / Title</label>
          <input class="form-input" id="s-user_role" value="${settings.user_role || ''}"></div>
        <div class="form-group"><label class="form-label">Company</label>
          <input class="form-input" id="s-user_company" value="${settings.user_company || ''}"></div>
        <div class="form-group"><label class="form-label">Reply Tone</label>
          <select class="form-select" id="s-reply_tone">
            ${['professional', 'friendly', 'casual', 'formal'].map(t => `<option value="${t}" ${settings.reply_tone === t ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join('')}
          </select></div>
        <div class="form-group"><label class="form-label">Signature</label>
          <input class="form-input" id="s-reply_signature" value="${settings.reply_signature || ''}"></div>
        <div class="form-group"><label class="form-label">Poll Interval (ms)</label>
          <input class="form-input" id="s-poll_interval" type="number" value="${settings.poll_interval || 60000}"></div>
        <div class="form-group full"><label class="form-label">Custom AI Instructions</label>
          <input class="form-input" id="s-custom_instructions" value="${settings.custom_instructions || ''}" placeholder="e.g. Always mention our 24h support policy"></div>
      </div>
      <div style="margin-top:20px;display:flex;gap:10px;">
        <button class="btn btn-primary" onclick="saveSettings()">💾 Save Settings</button>
        ${status.authenticated ? `<button class="btn btn-danger" onclick="disconnectGmail()">🔌 Disconnect Gmail</button>` :
          `<a href="/auth/google" class="btn btn-success" style="text-decoration:none">🔗 Connect Gmail</a>`}
      </div>
    </div>`;
}

async function saveSettings() {
  const fields = ['user_name', 'user_role', 'user_company', 'reply_tone', 'reply_signature', 'poll_interval', 'custom_instructions'];
  const data = {};
  fields.forEach(f => { data[f] = document.getElementById(`s-${f}`).value; });
  await api.put('/settings', data);
  toast('Settings saved!', 'success');
}

async function disconnectGmail() {
  await fetch('/auth/logout', { method: 'POST' });
  toast('Gmail disconnected', 'info');
  render();
}

// ---- Monitor Toggle ----
async function toggleMonitor() {
  try {
    if (status.isRunning) {
      await api.post('/monitor/stop');
      toast('Monitor stopped', 'info');
    } else {
      await api.post('/monitor/start');
      toast('Monitor started! Watching your inbox...', 'success');
    }
    render();
  } catch (e) { toast(e.message || 'Error toggling monitor', 'error'); }
}

// ---- Init ----
// Check for URL params from OAuth callback
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('connected')) {
  toast(`Connected as ${urlParams.get('connected')}`, 'success');
  history.replaceState({}, '', '/');
}
if (urlParams.get('error')) {
  toast(urlParams.get('error'), 'error');
  history.replaceState({}, '', '/');
}

render();
// Auto-refresh every 30s
setInterval(() => { if (currentPage === 'dashboard' || currentPage === 'drafts') render(); }, 30000);
