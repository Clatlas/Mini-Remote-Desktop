const $ = id => document.getElementById(id);

const app = {
  pcName:$('pcName'), statusPill:$('statusPill'), statusText:$('statusText'), lastSeen:$('lastSeen'),
  cpuMetric:$('cpuMetric'), ramMetric:$('ramMetric'), uptimeMetric:$('uptimeMetric'), refreshBtn:$('refreshBtn'),
  desktopBtn:$('desktopBtn'), browserBtn:$('browserBtn'), controlsLock:$('controlsLock'),
  connectView:$('connectView'), connectBackBtn:$('connectBackBtn'), connectDesktopBtn:$('connectDesktopBtn'), privacyNote:$('privacyNote'),
  sessionView:$('sessionView'), desktopFrame:$('desktopFrame'), sessionMenu:$('sessionMenu'), sessionConnectionText:$('sessionConnectionText'), sessionPrivacyLabel:$('sessionPrivacyLabel'),
  surfaceToolbar:$('surfaceToolbar'), surfaceMenuBtn:$('surfaceMenuBtn'), surfaceTitle:$('surfaceTitle'), surfaceSubtitle:$('surfaceSubtitle'), keyboardBtn:$('keyboardBtn'),
  menuAudioBtn:$('menuAudioBtn'), menuAudioLabel:$('menuAudioLabel'), surfaceAudioBtn:$('surfaceAudioBtn'), surfaceAudioLabel:$('surfaceAudioLabel'),
  appsMenu:$('appsMenu'), appsBackBtn:$('appsBackBtn'), appsAudioBtn:$('appsAudioBtn'), appsAudioLabel:$('appsAudioLabel'), appsList:$('appsList'),
  adminMenu:$('adminMenu'), adminBackBtn:$('adminBackBtn'), adminAudioBtn:$('adminAudioBtn'), adminAudioLabel:$('adminAudioLabel'),
  commandBrowser:$('commandBrowser'), commandApps:$('commandApps'), commandDesktop:$('commandDesktop'), commandAdmin:$('commandAdmin'), disconnectBtn:$('disconnectBtn'),
  browserView:$('browserView'), browserForm:$('browserForm'), addressInput:$('addressInput'), browserAudioBtn:$('browserAudioBtn'), browserAudioLabel:$('browserAudioLabel'),
  audioDialog:$('audioDialog'), audioDialogTitle:$('audioDialogTitle'), audioRoutingNote:$('audioRoutingNote'),
  confirmDialog:$('confirmDialog'), confirmTitle:$('confirmTitle'), confirmText:$('confirmText'), confirmAction:$('confirmAction'),
  toast:$('toast')
};

const labels = { offline:'Offline', asleep:'Asleep', onlineUnlocked:'Online · Unlocked', onlineLocked:'Online · Locked' };
const audioLabels = { desktop:'Desktop', mobile:'Mobile', both:'Both', muted:'Muted' };

let config = null;
let currentStatus = null;
let apps = [];
let selectedPrivacy = 'not-secret';
let sessionReady = false;
let sessionActive = false;
let keyboardOpen = false;
let guacReadyTimer = null;
let guacAudioObserver = null;
let pendingConfirm = null;
let lastHeartbeat = 0;
let disconnectTimer = null;
let audioDialogMode = 'desktop';
let audioState = { desktopMode:'mobile', browserMode:'mobile', activeMode:'none', effectiveDestination:null, routingApplied:false };
const mobileAudio = { context:null, socket:null, nextTime:0, format:{ sampleRate:48000, channels:2 } };

init();

async function init() {
  registerServiceWorker();
  bindUi();
  try {
    config = await fetchJson('/api/config');
    app.pcName.textContent = config.pcName || 'Home PC';
    setPowerButtons(Boolean(config.powerControlsEnabled));
    selectedPrivacy = config.desktop?.privacy?.defaultMode || 'not-secret';
    renderPrivacySelection();
  } catch {
    setPowerButtons(false);
  }
  await Promise.all([refreshStatus(), refreshAudio()]);
  connectEvents();
}

function bindUi() {
  app.refreshBtn.addEventListener('click', refreshStatus);
  app.desktopBtn.addEventListener('click', openDesktopSetup);
  app.browserBtn.addEventListener('click', openBrowserPreview);
  app.connectBackBtn.addEventListener('click', closeDesktopSetup);
  app.connectDesktopBtn.addEventListener('click', connectDesktopSession);
  document.querySelectorAll('[data-privacy-mode]').forEach(btn => btn.addEventListener('click', () => selectPrivacy(btn.dataset.privacyMode)));

  app.menuAudioBtn.addEventListener('click', () => openAudioDialog('desktop'));
  app.surfaceAudioBtn.addEventListener('click', () => openAudioDialog('desktop'));
  app.appsAudioBtn.addEventListener('click', () => openAudioDialog('desktop'));
  app.adminAudioBtn.addEventListener('click', () => openAudioDialog('desktop'));
  app.browserAudioBtn.addEventListener('click', () => openAudioDialog('browser'));
  document.querySelectorAll('[data-audio-destination]').forEach(btn => btn.addEventListener('click', () => chooseAudioDestination(btn.dataset.audioDestination)));

  app.surfaceMenuBtn.addEventListener('click', showSessionMenu);
  app.keyboardBtn.addEventListener('click', toggleKeyboard);
  app.commandBrowser.addEventListener('click', () => launchApp('chrome', 'Browser'));
  app.commandApps.addEventListener('click', showAppsMenu);
  app.commandDesktop.addEventListener('click', () => showSurface('Full Desktop', 'MRD Desktop'));
  app.commandAdmin.addEventListener('click', showAdminMenu);
  app.disconnectBtn.addEventListener('click', disconnectDesktopSession);
  app.appsBackBtn.addEventListener('click', showSessionMenu);
  app.adminBackBtn.addEventListener('click', showSessionMenu);

  document.querySelectorAll('[data-admin-action]').forEach(btn => btn.addEventListener('click', () => runAdminAction(btn.dataset.adminAction, btn)));
  document.querySelectorAll('[data-power]').forEach(btn => btn.addEventListener('click', () => requestPower(btn.dataset.power)));
  document.querySelectorAll('[data-close-view]').forEach(btn => btn.addEventListener('click', closeBrowserPreview));

  app.browserForm.addEventListener('submit', event => {
    event.preventDefault();
    showToast('Use Desktop → Browser for the working Chrome launcher.');
  });

  app.desktopFrame.addEventListener('load', () => {
    syncGuacamoleAudioRoute();
    startGuacReadyWatch();
  });

  app.confirmDialog.addEventListener('close', async () => {
    const action = pendingConfirm;
    pendingConfirm = null;
    if (app.confirmDialog.returnValue === 'confirm' && action) await action();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      refreshStatus();
      if (sessionActive) startGuacReadyWatch();
    }
  });
}

function openDesktopSetup() {
  renderPrivacySelection();
  app.connectView.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeDesktopSetup() {
  app.connectView.hidden = true;
  if (!sessionActive) document.body.style.overflow = '';
}

function selectPrivacy(mode) {
  selectedPrivacy = mode;
  renderPrivacySelection();
}

function renderPrivacySelection() {
  document.querySelectorAll('[data-privacy-mode]').forEach(btn => {
    const selected = btn.dataset.privacyMode === selectedPrivacy;
    btn.classList.toggle('selected', selected);
    btn.setAttribute('aria-checked', String(selected));
  });

  const secretSupported = Boolean(config?.desktop?.privacy?.secretSupported);
  if (selectedPrivacy === 'secret') {
    app.privacyNote.textContent = secretSupported
      ? 'Secret keeps the local console active and uses MRD console transport.'
      : 'Secret is wired into the new session flow, but the required console/virtual-display transport is not installed yet. MRD will not silently fall back to RDP because RDP would lock the PC.';
    app.privacyNote.classList.toggle('warning', !secretSupported);
  } else {
    app.privacyNote.textContent = 'Not Secret uses the proven Windows RDP path and locks the physical console while connected.';
    app.privacyNote.classList.remove('warning');
  }
}

async function connectDesktopSession() {
  app.connectDesktopBtn.disabled = true;
  app.connectDesktopBtn.textContent = 'Connecting…';
  try {
    const result = await fetchJson('/api/session/prepare', {
      method:'POST',
      body:JSON.stringify({ privacyMode:selectedPrivacy })
    });

    sessionActive = true;
    sessionReady = false;
    keyboardOpen = false;
    app.sessionPrivacyLabel.textContent = selectedPrivacy === 'secret' ? 'Secret' : 'Not Secret';
    app.sessionConnectionText.textContent = 'Connecting to MRD Desktop…';
    app.sessionConnectionText.className = '';
    app.connectView.hidden = true;
    app.sessionView.hidden = false;
    app.surfaceToolbar.hidden = true;
    showSessionMenu();
    void setActiveAudioMode('desktop');

    const desktopPath = result.desktopPath || config?.desktop?.path || '/guacamole/';
    app.desktopFrame.src = desktopPath;
    startGuacReadyWatch();
  } catch (error) {
    app.privacyNote.textContent = error.message;
    app.privacyNote.classList.add('warning');
  } finally {
    app.connectDesktopBtn.disabled = false;
    app.connectDesktopBtn.textContent = 'Connect';
  }
}

function startGuacReadyWatch() {
  if (!sessionActive || sessionReady || guacReadyTimer) return;
  let attempts = 0;
  guacReadyTimer = setInterval(() => {
    attempts += 1;
    if (probeGuacClientReady()) {
      clearInterval(guacReadyTimer);
      guacReadyTimer = null;
      sessionReady = true;
      app.sessionConnectionText.textContent = 'Desktop connected · commands ready';
      app.sessionConnectionText.className = 'ready';
      syncGuacamoleAudioRoute();
      return;
    }
    if (attempts >= 300) {
      clearInterval(guacReadyTimer);
      guacReadyTimer = null;
      app.sessionConnectionText.textContent = 'Open Full Desktop to finish Guacamole sign-in or connection setup.';
      app.sessionConnectionText.className = 'error';
    }
  }, 400);
}

function probeGuacClientReady() {
  try {
    const doc = app.desktopFrame.contentDocument;
    const win = app.desktopFrame.contentWindow;
    if (!doc?.documentElement || !win?.angular) return false;
    const viewport = doc.querySelector('guac-viewport');
    if (!viewport) return false;

    injectGuacBridgeStyles(doc);
    const candidates = [viewport, doc.querySelector('.client-view'), doc.querySelector('.client-body')].filter(Boolean);
    let clientScope = null;
    for (const element of candidates) {
      const scope = win.angular.element(element).scope?.();
      if (scope?.menu) { clientScope = scope; break; }
    }
    if (!clientScope) return false;

    if (clientScope.menu.inputMethod !== 'text') {
      if (clientScope.$root?.$$phase) clientScope.menu.inputMethod = 'text';
      else clientScope.$apply(() => { clientScope.menu.inputMethod = 'text'; });
    }

    return Boolean(doc.querySelector('.text-input textarea.target'));
  } catch {
    return false;
  }
}

function injectGuacBridgeStyles(doc) {
  if (doc.getElementById('mrd-guac-bridge-style')) return;
  const style = doc.createElement('style');
  style.id = 'mrd-guac-bridge-style';
  style.textContent = `
    .text-input-container{position:fixed!important;left:0!important;bottom:0!important;width:2px!important;height:2px!important;overflow:hidden!important;opacity:.01!important;z-index:-1!important;pointer-events:none!important}
    .text-input,.text-input-field,.text-input textarea.target{width:2px!important;height:2px!important;min-width:2px!important;min-height:2px!important;padding:0!important;border:0!important}
  `;
  doc.head?.appendChild(style);
}

function getGuacKeyboardTarget() {
  try { return app.desktopFrame.contentDocument?.querySelector('.text-input textarea.target') || null; }
  catch { return null; }
}

function toggleKeyboard() {
  if (!sessionReady && !probeGuacClientReady()) {
    showToast('Keyboard will be ready after the Windows session finishes connecting.');
    return;
  }
  const target = getGuacKeyboardTarget();
  if (!target) {
    showToast('Keyboard bridge is not ready yet.');
    return;
  }

  if (keyboardOpen) {
    target.blur();
    keyboardOpen = false;
  } else {
    target.focus({ preventScroll:true });
    keyboardOpen = app.desktopFrame.contentDocument?.activeElement === target;
    if (!keyboardOpen) target.focus();
  }
  app.keyboardBtn.setAttribute('aria-pressed', String(keyboardOpen));
  app.keyboardBtn.setAttribute('aria-label', keyboardOpen ? 'Close keyboard' : 'Open keyboard');
}

function closeKeyboard() {
  const target = getGuacKeyboardTarget();
  try { target?.blur(); } catch {}
  keyboardOpen = false;
  app.keyboardBtn.setAttribute('aria-pressed', 'false');
  app.keyboardBtn.setAttribute('aria-label', 'Open keyboard');
}

function showSessionMenu() {
  if (!sessionActive) return;
  closeKeyboard();
  app.surfaceToolbar.hidden = true;
  app.sessionMenu.hidden = false;
  app.appsMenu.hidden = true;
  app.adminMenu.hidden = true;
}

function showAppsMenu() {
  closeKeyboard();
  app.surfaceToolbar.hidden = true;
  app.sessionMenu.hidden = true;
  app.adminMenu.hidden = true;
  app.appsMenu.hidden = false;
  if (!apps.length) loadApps();
}

function showAdminMenu() {
  closeKeyboard();
  app.surfaceToolbar.hidden = true;
  app.sessionMenu.hidden = true;
  app.appsMenu.hidden = true;
  app.adminMenu.hidden = false;
}

function showSurface(title, subtitle = 'MRD Desktop') {
  app.sessionMenu.hidden = true;
  app.appsMenu.hidden = true;
  app.adminMenu.hidden = true;
  app.surfaceTitle.textContent = title;
  app.surfaceSubtitle.textContent = subtitle;
  app.surfaceToolbar.hidden = false;
  startGuacReadyWatch();
}

async function loadApps() {
  app.appsList.innerHTML = '<div class="panel-loading">Loading apps…</div>';
  try {
    const result = await fetchJson('/api/apps');
    apps = result.apps || [];
    renderApps();
  } catch (error) {
    app.appsList.innerHTML = `<div class="panel-loading">${escapeHtml(error.message)}</div>`;
  }
}

function renderApps() {
  const categories = new Map();
  for (const item of apps) {
    if (!categories.has(item.category)) categories.set(item.category, []);
    categories.get(item.category).push(item);
  }

  app.appsList.innerHTML = '';
  for (const [category, items] of categories) {
    const section = document.createElement('section');
    section.className = 'app-category';
    const heading = document.createElement('h3');
    heading.textContent = category;
    const grid = document.createElement('div');
    grid.className = 'app-category-grid';

    for (const item of items) {
      const button = document.createElement('button');
      button.className = 'app-card';
      button.disabled = item.available === false;
      button.innerHTML = `<span class="app-card-icon">${escapeHtml(item.icon || '□')}</span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.description || '')}</small>`;
      button.addEventListener('click', () => {
        if (item.id === 'mrd-admin') showAdminMenu();
        else launchApp(item.id, item.name);
      });
      grid.appendChild(button);
    }

    section.append(heading, grid);
    app.appsList.appendChild(section);
  }
}

async function launchApp(id, surfaceName) {
  if (!sessionReady && !probeGuacClientReady()) {
    showSurface('Full Desktop', 'Finish connecting first');
    showToast('Finish the Windows/Guacamole connection, then return to Commands.');
    return;
  }
  showToast(`Opening ${surfaceName}…`);
  try {
    const result = await fetchJson(`/api/apps/${encodeURIComponent(id)}/launch`, { method:'POST' });
    if (result.panel === 'mrd-admin') return showAdminMenu();
    setTimeout(() => showSurface(surfaceName, result.app?.name || 'MRD Desktop'), 250);
  } catch (error) {
    showToast(error.message);
  }
}

async function runAdminAction(action, button) {
  const destructive = ['restart-guacamole','restart-docker','restart-tailscale','restart-mrd'].includes(action);
  const titles = {
    'restart-guacamole':'Restart Guacamole?', 'restart-docker':'Restart Docker Desktop?',
    'restart-tailscale':'Restart Tailscale?', 'restart-mrd':'Restart MRD Host?'
  };
  const descriptions = {
    'restart-guacamole':'The active remote desktop will disconnect while Guacamole restarts.',
    'restart-docker':'Docker and Guacamole will be temporarily unavailable.',
    'restart-tailscale':'The private MRD connection may drop while Tailscale restarts.',
    'restart-mrd':'MRD will briefly go offline and then start again.'
  };

  const execute = async () => {
    button.disabled = true;
    try {
      const result = await fetchJson('/api/admin/action', { method:'POST', body:JSON.stringify({ action }) });
      if (action === 'open-task-manager') return showSurface('Task Manager', 'MRD Admin');
      if (action === 'open-services') return showSurface('Services', 'MRD Admin');
      showToast(result.ok ? 'Admin action sent' : result.error);
      if (['restart-guacamole','restart-docker'].includes(action)) {
        sessionReady = false;
        app.sessionConnectionText.textContent = 'Gateway restarting…';
        app.sessionConnectionText.className = '';
      }
    } catch (error) {
      showToast(error.message);
    } finally {
      setTimeout(() => { button.disabled = false; }, 1200);
    }
  };

  if (destructive) requestConfirm(titles[action], descriptions[action], titles[action].replace('?', ''), execute);
  else await execute();
}

async function disconnectDesktopSession() {
  closeKeyboard();
  clearInterval(guacReadyTimer);
  guacReadyTimer = null;
  guacAudioObserver?.disconnect();
  guacAudioObserver = null;
  sessionActive = false;
  sessionReady = false;
  app.desktopFrame.src = 'about:blank';
  app.sessionView.hidden = true;
  app.surfaceToolbar.hidden = true;
  app.appsMenu.hidden = true;
  app.adminMenu.hidden = true;
  app.sessionMenu.hidden = false;
  await setActiveAudioMode('none');
  stopMobileAudioStream();
  document.body.style.overflow = '';
}

function openBrowserPreview() {
  app.browserView.hidden = false;
  const destination = audioState.browserMode || 'mobile';
  if (destination === 'mobile' || destination === 'both') primeMobileAudio();
  void setActiveAudioMode('browser');
  document.body.style.overflow = 'hidden';
}

function closeBrowserPreview() {
  app.browserView.hidden = true;
  void setActiveAudioMode('none');
  stopMobileAudioStream();
  document.body.style.overflow = '';
}

async function refreshAudio() {
  try { audioState = await fetchJson('/api/audio'); } catch {}
  renderAudioState();
}

function openAudioDialog(mode) {
  audioDialogMode = mode;
  app.audioDialogTitle.textContent = `${mode === 'desktop' ? 'Desktop' : 'Browser'} audio`;
  renderAudioState();
  app.audioDialog.showModal();
}

async function chooseAudioDestination(destination) {
  if (!audioLabels[destination]) return;

  const key = audioDialogMode === 'desktop' ? 'desktopMode' : 'browserMode';
  const previous = audioState[key];
  audioState[key] = destination;
  if (audioState.activeMode === audioDialogMode) audioState.effectiveDestination = destination;

  // Apply the Guacamole mute/play state synchronously while this iOS tap still
  // counts as a user gesture. This makes Mobile/Both much more reliable on Safari.
  if (audioDialogMode === 'desktop') syncGuacamoleAudioRoute();
  else if (destination === 'mobile' || destination === 'both') primeMobileAudio();
  renderAudioState();

  try {
    audioState = await fetchJson('/api/audio', { method:'PUT', body:JSON.stringify({ mode:audioDialogMode, destination }) });
    renderAudioState();
    app.audioDialog.close();
    showToast(`${audioDialogMode === 'desktop' ? 'Desktop' : 'Browser'} audio → ${audioLabels[destination]}`);
  } catch (error) {
    audioState[key] = previous;
    renderAudioState();
    showToast(error.message);
  }
}

async function setActiveAudioMode(activeMode) {
  try {
    audioState = await fetchJson('/api/audio', { method:'PUT', body:JSON.stringify({ activeMode }) });
    renderAudioState();
  } catch {}
}

function renderAudioState() {
  const desktopDestination = audioState.desktopMode || 'mobile';
  const browserDestination = audioState.browserMode || 'mobile';
  app.menuAudioLabel.textContent = audioLabels[desktopDestination] || 'Mobile';
  app.surfaceAudioLabel.textContent = audioLabels[desktopDestination] || 'Mobile';
  app.appsAudioLabel.textContent = audioLabels[desktopDestination] || 'Mobile';
  app.adminAudioLabel.textContent = audioLabels[desktopDestination] || 'Mobile';
  app.browserAudioLabel.textContent = audioLabels[browserDestination] || 'Mobile';

  const selected = audioDialogMode === 'desktop' ? desktopDestination : browserDestination;
  document.querySelectorAll('[data-audio-destination]').forEach(btn => {
    const active = btn.dataset.audioDestination === selected;
    btn.classList.toggle('selected', active);
    btn.setAttribute('aria-selected', String(active));
  });

  if (audioDialogMode === 'desktop') {
    app.audioRoutingNote.textContent = 'Desktop audio uses Guacamole for the phone and MRD Audio Router for the physical PC output.';
  } else if (audioState.router?.lastError) {
    app.audioRoutingNote.textContent = `Audio Router error: ${audioState.router.lastError}`;
  } else {
    app.audioRoutingNote.textContent = audioState.routingApplied
      ? 'Live Windows audio routing is active.'
      : 'Audio destination is saved and will apply when the browser engine is active.';
  }
  syncMobileAudioTransport();
  syncGuacamoleAudioRoute();
}

function syncGuacamoleAudioRoute() {
  try {
    const doc = app.desktopFrame.contentDocument;
    if (!doc?.documentElement) return;
    const destination = audioState.desktopMode || 'mobile';
    const shouldPlay = sessionActive && ['mobile','both'].includes(destination);
    const apply = () => {
      doc.querySelectorAll('audio,video').forEach(media => {
        media.muted = !shouldPlay;
        if (shouldPlay && media.play) media.play().catch(() => {});
      });
    };
    apply();
    guacAudioObserver?.disconnect();
    guacAudioObserver = new MutationObserver(apply);
    guacAudioObserver.observe(doc.documentElement, { childList:true, subtree:true });
  } catch {}
}

function primeMobileAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  if (!mobileAudio.context) {
    try { mobileAudio.context = new AudioContextClass({ latencyHint:'interactive', sampleRate:48000 }); }
    catch { mobileAudio.context = new AudioContextClass(); }
  }
  if (mobileAudio.context.state === 'suspended') mobileAudio.context.resume().catch(() => {});
}

function syncMobileAudioTransport() {
  const wantsStream = audioState.activeMode === 'browser'
    && ['mobile','both'].includes(audioState.effectiveDestination)
    && audioState.router?.helperAvailable;
  if (wantsStream) ensureMobileAudioStream(); else stopMobileAudioStream();
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
  socket.addEventListener('close', () => { if (mobileAudio.socket === socket) mobileAudio.socket = null; });
  socket.addEventListener('error', () => { if (mobileAudio.socket === socket) mobileAudio.socket = null; });
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
  if (Number(mobileAudio.format.channels || 2) !== 2) return;
  const view = new DataView(arrayBuffer);
  const frames = Math.floor(view.byteLength / 4);
  if (!frames) return;
  const audioBuffer = context.createBuffer(2, frames, sampleRate);
  const left = audioBuffer.getChannelData(0), right = audioBuffer.getChannelData(1);
  let offset = 0;
  for (let i = 0; i < frames; i++) {
    left[i] = view.getInt16(offset, true) / 32768;
    right[i] = view.getInt16(offset + 2, true) / 32768;
    offset += 4;
  }
  const source = context.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(context.destination);
  const floor = context.currentTime + .045;
  let start = Math.max(floor, mobileAudio.nextTime || floor);
  if (start - context.currentTime > .35) start = floor;
  source.start(start);
  mobileAudio.nextTime = start + audioBuffer.duration;
}

async function refreshStatus() {
  try {
    const started = performance.now();
    const status = await fetchJson('/api/status');
    status.roundTripMs = Math.round(performance.now() - started);
    lastHeartbeat = Date.now();
    renderStatus(status);
  } catch { renderDisconnectedState(); }
}

function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('status', event => { lastHeartbeat = Date.now(); renderStatus(JSON.parse(event.data)); });
  es.addEventListener('audio', event => { audioState = JSON.parse(event.data); renderAudioState(); });
  es.addEventListener('heartbeat', () => { lastHeartbeat = Date.now(); scheduleDisconnectCheck(); });
  es.onerror = scheduleDisconnectCheck;
}

function scheduleDisconnectCheck() {
  clearTimeout(disconnectTimer);
  disconnectTimer = setTimeout(() => { if (Date.now() - lastHeartbeat > 8000) renderDisconnectedState(); }, 8500);
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

function requestPower(action) {
  const copy = {
    lock:['Lock PC?','The local Windows console will be locked.'],
    sleep:['Put PC to sleep?','The remote connection will end until the PC is awakened.'],
    restart:['Restart PC?','All active applications will be interrupted.'],
    shutdown:['Shut down PC?','The PC will become unreachable until powered on again.']
  };
  const [title,text] = copy[action] || ['Confirm action',action];
  requestConfirm(title, text, title.replace('?', ''), async () => {
    try {
      const result = await fetchJson(`/api/power/${action}`, { method:'POST' });
      if (action === 'sleep') localStorage.setItem('pcRemoteLastSleep', String(Date.now()));
      showToast(result.ok ? `${capitalize(action)} sent` : result.error);
      setTimeout(refreshStatus, action === 'lock' ? 1200 : 2500);
    } catch (error) { showToast(error.message); }
  });
}

function requestConfirm(title, text, actionLabel, callback) {
  pendingConfirm = callback;
  app.confirmTitle.textContent = title;
  app.confirmText.textContent = text;
  app.confirmAction.textContent = actionLabel;
  app.confirmDialog.showModal();
}

function setPowerButtons(enabled) {
  document.querySelectorAll('[data-power]').forEach(btn => btn.disabled = !enabled);
  app.controlsLock.textContent = enabled ? 'Enabled' : 'Disabled in setup';
}

async function fetchJson(url, options = {}) {
  const headers = { Accept:'application/json', ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers || {}) };
  const response = await fetch(url, { cache:'no-store', ...options, headers });
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new Error(body.error || `${response.status} ${response.statusText}`);
  return body;
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400), hours = Math.floor((seconds % 86400) / 3600);
  if (days) return `${days}d ${hours}h`;
  return `${hours}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function showToast(text) {
  app.toast.textContent = text;
  app.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => app.toast.classList.remove('show'), 2800);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}
function capitalize(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
function registerServiceWorker() { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {}); }
