const $ = (id) => document.getElementById(id);
const app = {
  pcName: $('pcName'), statusPill: $('statusPill'), statusText: $('statusText'), lastSeen: $('lastSeen'),
  cpuMetric: $('cpuMetric'), ramMetric: $('ramMetric'), uptimeMetric: $('uptimeMetric'), refreshBtn: $('refreshBtn'),
  desktopBtn: $('desktopBtn'), browserBtn: $('browserBtn'), desktopView: $('desktopView'), browserView: $('browserView'),
  desktopFrame: $('desktopFrame'), desktopMessage: $('desktopMessage'), desktopReload: $('desktopReload'),
  desktopAudioBtn: $('desktopAudioBtn'), desktopAudioLabel: $('desktopAudioLabel'),
  browserForm: $('browserForm'), addressInput: $('addressInput'), browserPlaceholder: $('browserPlaceholder'),
  mediaDemo: $('mediaDemo'), mediaVideo: $('mediaVideo'), mediaModeBtn: $('mediaModeBtn'), browserHome: $('browserHome'),
  browserAudioBtn: $('browserAudioBtn'), browserAudioLabel: $('browserAudioLabel'),
  confirmDialog: $('confirmDialog'), confirmTitle: $('confirmTitle'), confirmText: $('confirmText'), confirmAction: $('confirmAction'),
  audioDialog: $('audioDialog'), audioDialogTitle: $('audioDialogTitle'), audioRoutingNote: $('audioRoutingNote'),
  toast: $('toast'), controlsLock: $('controlsLock')
};

const labels = {
  offline: 'Offline', asleep: 'Asleep', onlineUnlocked: 'Online · Unlocked', onlineLocked: 'Online · Locked'
};

const audioLabels = { desktop: 'Desktop', mobile: 'Mobile', both: 'Both', muted: 'Muted' };

let config = null;
let currentStatus = null;
let lastHeartbeat = 0;
let disconnectTimer = null;
let pendingAction = null;
let audioDialogMode = 'desktop';
let audioState = { desktopMode: 'mobile', browserMode: 'mobile', activeMode: 'none', effectiveDestination: null, routingApplied: false };
let guacAudioObserver = null;
const mobileAudio = { context: null, socket: null, nextTime: 0, format: { sampleRate: 48000, channels: 2 } };

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
  await Promise.all([refreshStatus(), refreshAudio()]);
  connectEvents();
}

function bindUi() {
  app.refreshBtn.addEventListener('click', refreshStatus);
  app.desktopBtn.addEventListener('click', openDesktop);
  app.browserBtn.addEventListener('click', openBrowser);
  app.desktopReload.addEventListener('click', () => { app.desktopFrame.src = app.desktopFrame.src; });
  app.desktopAudioBtn.addEventListener('click', () => openAudioDialog('desktop'));
  app.browserAudioBtn.addEventListener('click', () => openAudioDialog('browser'));
  document.querySelectorAll('[data-audio-destination]').forEach(btn => btn.addEventListener('click', () => chooseAudioDestination(btn.dataset.audioDestination)));
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

async function refreshAudio() {
  try {
    audioState = await fetchJson('/api/audio');
    renderAudioState();
  } catch {
    renderAudioState();
  }
}

function openAudioDialog(mode) {
  audioDialogMode = mode;
  app.audioDialogTitle.textContent = `${mode === 'desktop' ? 'Desktop' : 'Browser'} audio`;
  renderAudioState();
  app.audioDialog.showModal();
}

async function chooseAudioDestination(destination) {
  if (!audioLabels[destination]) return;
  if (audioDialogMode === 'browser' && (destination === 'mobile' || destination === 'both')) primeMobileAudio();
  try {
    audioState = await fetchJson('/api/audio', {
      method: 'PUT',
      body: JSON.stringify({ mode: audioDialogMode, destination })
    });
    renderAudioState();
    app.audioDialog.close();
    showToast(`${audioDialogMode === 'desktop' ? 'Desktop' : 'Browser'} audio → ${audioLabels[destination]}`);
  } catch (error) {
    showToast(error.message);
  }
}

async function setActiveAudioMode(activeMode) {
  try {
    audioState = await fetchJson('/api/audio', { method: 'PUT', body: JSON.stringify({ activeMode }) });
    renderAudioState();
  } catch {}
}

function renderAudioState() {
  const desktopDestination = audioState.desktopMode || 'mobile';
  const browserDestination = audioState.browserMode || 'mobile';
  app.desktopAudioLabel.textContent = audioLabels[desktopDestination] || 'Mobile';
  app.browserAudioLabel.textContent = audioLabels[browserDestination] || 'Mobile';

  const selected = audioDialogMode === 'desktop' ? desktopDestination : browserDestination;
  document.querySelectorAll('[data-audio-destination]').forEach(btn => {
    const active = btn.dataset.audioDestination === selected;
    btn.classList.toggle('selected', active);
    btn.setAttribute('aria-selected', String(active));
  });

  if (audioState.router?.lastError) {
    app.audioRoutingNote.textContent = `Audio Router error: ${audioState.router.lastError}`;
  } else if (audioState.router?.helperAvailable === false) {
    app.audioRoutingNote.textContent = 'Routing preference is saved. Install the MRD Audio Router helper to apply it live.';
  } else {
    app.audioRoutingNote.textContent = audioState.routingApplied
      ? 'Live Windows audio routing is active for this session.'
      : 'Audio Router is ready. Open Desktop or Browser to apply the selected destination.';
  }
  syncMobileAudioTransport();
  syncGuacamoleAudioRoute();
}

function primeMobileAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  if (!mobileAudio.context) {
    try {
      mobileAudio.context = new AudioContextClass({ latencyHint: 'interactive', sampleRate: 48000 });
    } catch {
      mobileAudio.context = new AudioContextClass();
    }
  }
  if (mobileAudio.context.state === 'suspended') mobileAudio.context.resume().catch(() => {});
}

function syncMobileAudioTransport() {
  const wantsStream = audioState.activeMode === 'browser'
    && ['mobile', 'both'].includes(audioState.effectiveDestination)
    && audioState.router?.helperAvailable;
  if (wantsStream) ensureMobileAudioStream();
  else stopMobileAudioStream();
}

function ensureMobileAudioStream() {
  primeMobileAudio();
  if (!mobileAudio.context) return;
  if (mobileAudio.socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(mobileAudio.socket.readyState)) return;

  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${scheme}//${location.host}/api/audio/stream`);
  mobileAudio.socket = socket;
  socket.binaryType = 'arraybuffer';

  socket.addEventListener('message', event => {
    if (typeof event.data === 'string') {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'format') mobileAudio.format = message;
        if (message.type === 'error') showToast(message.message);
      } catch {}
      return;
    }
    queuePcmAudio(event.data);
  });
  socket.addEventListener('close', () => {
    if (mobileAudio.socket === socket) mobileAudio.socket = null;
  });
  socket.addEventListener('error', () => {
    if (mobileAudio.socket === socket) mobileAudio.socket = null;
  });
}

function stopMobileAudioStream() {
  if (mobileAudio.socket) {
    try { mobileAudio.socket.close(1000, 'Audio destination changed'); } catch {}
    mobileAudio.socket = null;
  }
  mobileAudio.nextTime = 0;
  if (mobileAudio.context?.state === 'running') mobileAudio.context.suspend().catch(() => {});
}

function queuePcmAudio(arrayBuffer) {
  const context = mobileAudio.context;
  if (!context || context.state !== 'running' || !arrayBuffer?.byteLength) return;

  const sampleRate = Number(mobileAudio.format.sampleRate || 48000);
  const channels = Number(mobileAudio.format.channels || 2);
  if (channels !== 2) return;

  const view = new DataView(arrayBuffer);
  const frames = Math.floor(view.byteLength / 4);
  if (!frames) return;

  const audioBuffer = context.createBuffer(2, frames, sampleRate);
  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.getChannelData(1);
  let offset = 0;
  for (let i = 0; i < frames; i++) {
    left[i] = view.getInt16(offset, true) / 32768;
    right[i] = view.getInt16(offset + 2, true) / 32768;
    offset += 4;
  }

  const source = context.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(context.destination);
  const floor = context.currentTime + 0.045;
  let start = Math.max(floor, mobileAudio.nextTime || floor);
  if (start - context.currentTime > 0.35) start = floor;
  source.start(start);
  mobileAudio.nextTime = start + audioBuffer.duration;
}

function syncGuacamoleAudioRoute() {
  try {
    const doc = app.desktopFrame.contentDocument;
    if (!doc?.documentElement) return;

    const shouldPlayOnMobile = audioState.activeMode === 'desktop'
      && ['mobile', 'both'].includes(audioState.effectiveDestination);

    const apply = () => {
      doc.querySelectorAll('audio,video').forEach(media => {
        media.muted = !shouldPlayOnMobile;
        if (shouldPlayOnMobile && media.paused && media.play) media.play().catch(() => {});
      });
    };

    apply();
    guacAudioObserver?.disconnect();
    guacAudioObserver = new MutationObserver(apply);
    guacAudioObserver.observe(doc.documentElement, { childList: true, subtree: true });
  } catch {}
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
  es.addEventListener('audio', event => {
    audioState = JSON.parse(event.data);
    renderAudioState();
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
  void setActiveAudioMode('desktop');
  app.desktopMessage.hidden = false;
  app.desktopFrame.onload = () => { app.desktopMessage.hidden = true; syncGuacamoleAudioRoute(); };
  app.desktopFrame.src = (config?.desktop?.path || '/guacamole/');
}

function openBrowser() {
  openView(app.browserView);
  const destination = audioState.browserMode || 'mobile';
  if (destination === 'mobile' || destination === 'both') primeMobileAudio();
  void setActiveAudioMode('browser');
}

function openView(view) { view.hidden = false; document.body.style.overflow = 'hidden'; }
function closeViews() {
  app.desktopView.hidden = true;
  app.browserView.hidden = true;
  app.desktopFrame.src = 'about:blank';
  document.body.style.overflow = '';
  guacAudioObserver?.disconnect();
  guacAudioObserver = null;
  void setActiveAudioMode('none');
  stopMobileAudioStream();
}

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
