const $ = (id) => document.getElementById(id);
const app = {
  pcName: $('pcName'), statusPill: $('statusPill'), statusText: $('statusText'), lastSeen: $('lastSeen'),
  cpuMetric: $('cpuMetric'), ramMetric: $('ramMetric'), uptimeMetric: $('uptimeMetric'), refreshBtn: $('refreshBtn'),
  desktopBtn: $('desktopBtn'), browserBtn: $('browserBtn'), desktopView: $('desktopView'), browserView: $('browserView'),
  desktopFrame: $('desktopFrame'), desktopMessage: $('desktopMessage'), desktopReload: $('desktopReload'),
  browserForm: $('browserForm'), addressInput: $('addressInput'), browserPlaceholder: $('browserPlaceholder'),
  mediaDemo: $('mediaDemo'), mediaVideo: $('mediaVideo'), mediaModeBtn: $('mediaModeBtn'), browserHome: $('browserHome'),
  confirmDialog: $('confirmDialog'), confirmTitle: $('confirmTitle'), confirmText: $('confirmText'), confirmAction: $('confirmAction'),
  toast: $('toast'), controlsLock: $('controlsLock')
};

const labels = {
  offline: 'Offline', asleep: 'Asleep', onlineUnlocked: 'Online · Unlocked', onlineLocked: 'Online · Locked'
};

let config = null;
let currentStatus = null;
let lastHeartbeat = 0;
let disconnectTimer = null;
let pendingAction = null;

init();

async function init() {
  registerServiceWorker();
  bindUi();
  try {
    config = await fetchJson('/api/config');
    app.pcName.textContent = config.pcName || 'Home PC';
    setPowerButtons(Boolean(config.powerControlsEnabled));
  } catch {
    setPowerButtons(false);
  }
  await refreshStatus();
  connectEvents();
}

function bindUi() {
  app.refreshBtn.addEventListener('click', refreshStatus);
  app.desktopBtn.addEventListener('click', openDesktop);
  app.browserBtn.addEventListener('click', () => openView(app.browserView));
  app.desktopReload.addEventListener('click', () => { app.desktopFrame.src = app.desktopFrame.src; });
  document.querySelectorAll('[data-close-view]').forEach(btn => btn.addEventListener('click', () => closeViews()));
  document.querySelectorAll('[data-power]').forEach(btn => btn.addEventListener('click', () => requestPower(btn.dataset.power)));
  app.confirmDialog.addEventListener('close', async () => {
    if (app.confirmDialog.returnValue === 'confirm' && pendingAction) await runPowerAction(pendingAction);
    pendingAction = null;
  });
  app.browserForm.addEventListener('submit', async event => {
    event.preventDefault();
    const input = app.addressInput.value.trim();
    if (!input) return;
    try {
      const result = await fetchJson('/api/browser/session', { method: 'POST', body: JSON.stringify({ url: normalizeUrl(input) }) });
      showToast(result.ok ? 'Browser session started' : result.error);
    } catch (error) { showToast(error.message); }
  });
  app.browserHome.addEventListener('click', () => { app.addressInput.value = ''; app.browserPlaceholder.hidden = false; app.mediaDemo.hidden = true; });
  app.mediaModeBtn.addEventListener('click', () => showToast('Media transport is queued for the browser-engine milestone.'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshStatus(); });
}

async function refreshStatus() {
  try {
    const started = performance.now();
    const status = await fetchJson('/api/status');
    status.roundTripMs = Math.round(performance.now() - started);
    lastHeartbeat = Date.now();
    renderStatus(status);
  } catch {
    renderDisconnectedState();
  }
}

function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('status', event => {
    lastHeartbeat = Date.now();
    const status = JSON.parse(event.data);
    renderStatus(status);
  });
  es.addEventListener('heartbeat', () => { lastHeartbeat = Date.now(); scheduleDisconnectCheck(); });
  es.onerror = () => { scheduleDisconnectCheck(); };
}

function scheduleDisconnectCheck() {
  clearTimeout(disconnectTimer);
  disconnectTimer = setTimeout(() => {
    if (Date.now() - lastHeartbeat > 8000) renderDisconnectedState();
  }, 8500);
}

function renderStatus(status) {
  currentStatus = status;
  const state = status.state || 'offline';
  app.statusPill.dataset.state = state;
  app.statusText.textContent = labels[state] || state;
  app.lastSeen.textContent = status.roundTripMs != null ? `${status.roundTripMs} ms` : 'Live';
  app.cpuMetric.textContent = status.metrics ? `${status.metrics.cpuPercent}%` : '—';
  app.ramMetric.textContent = status.metrics ? `${status.metrics.memoryPercent}%` : '—';
  app.uptimeMetric.textContent = status.host ? formatUptime(status.host.uptimeSeconds) : '—';
  if (state === 'asleep') localStorage.setItem('pcRemoteLastSleep', String(Date.now()));
  if (state.startsWith('online')) localStorage.removeItem('pcRemoteLastSleep');
  scheduleDisconnectCheck();
}

function renderDisconnectedState() {
  const lastSleep = Number(localStorage.getItem('pcRemoteLastSleep') || 0);
  const looksAsleep = lastSleep && Date.now() - lastSleep < 12 * 60 * 60 * 1000;
  const state = looksAsleep ? 'asleep' : 'offline';
  app.statusPill.dataset.state = state;
  app.statusText.textContent = labels[state];
  app.lastSeen.textContent = looksAsleep ? 'Last action: sleep' : 'Host unreachable';
  app.cpuMetric.textContent = app.ramMetric.textContent = app.uptimeMetric.textContent = '—';
}

function openDesktop() {
  openView(app.desktopView);
  app.desktopMessage.hidden = false;
  app.desktopFrame.onload = () => { app.desktopMessage.hidden = true; };
  app.desktopFrame.src = (config?.desktop?.path || '/guacamole/');
}

function openView(view) { view.hidden = false; document.body.style.overflow = 'hidden'; }
function closeViews() { app.desktopView.hidden = true; app.browserView.hidden = true; app.desktopFrame.src = 'about:blank'; document.body.style.overflow = ''; }

function requestPower(action) {
  const copy = {
    lock: ['Lock PC?', 'The local Windows console will be locked.'],
    sleep: ['Put PC to sleep?', 'The remote connection will end until the PC is awakened.'],
    restart: ['Restart PC?', 'All active applications will be interrupted.'],
    shutdown: ['Shut down PC?', 'The PC will become unreachable until powered on again.']
  };
  const [title, text] = copy[action] || ['Confirm action', action];
  pendingAction = action;
  app.confirmTitle.textContent = title;
  app.confirmText.textContent = text;
  app.confirmAction.textContent = title.replace('?', '');
  app.confirmDialog.showModal();
}

async function runPowerAction(action) {
  try {
    const result = await fetchJson(`/api/power/${action}`, { method: 'POST' });
    if (!result.ok) throw new Error(result.error || 'Action failed');
    if (action === 'sleep') localStorage.setItem('pcRemoteLastSleep', String(Date.now()));
    showToast(`${capitalize(action)} sent`);
    setTimeout(refreshStatus, action === 'lock' ? 1200 : 2500);
  } catch (error) { showToast(error.message); }
}

function setPowerButtons(enabled) {
  document.querySelectorAll('[data-power]').forEach(btn => btn.disabled = !enabled);
  app.controlsLock.textContent = enabled ? 'Enabled' : 'Disabled in setup';
}

async function fetchJson(url, options = {}) {
  const headers = { 'Accept': 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  const response = await fetch(url, { cache: 'no-store', ...options, headers });
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new Error(body.error || `${response.status} ${response.statusText}`);
  return body;
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days) return `${days}d ${hours}h`;
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

function normalizeUrl(value) {
  if (/^https?:\/\//i.test(value)) return value;
  if (value.includes('.') && !value.includes(' ')) return `https://${value}`;
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

function showToast(text) {
  app.toast.textContent = text;
  app.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => app.toast.classList.remove('show'), 2600);
}

function capitalize(value) { return value.charAt(0).toUpperCase() + value.slice(1); }

function registerServiceWorker() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
