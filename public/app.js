const $ = id => document.getElementById(id);

const app = {
  pcName: $('pcName'), statusDeviceName: $('statusDeviceName'), statusPill: $('statusPill'), statusText: $('statusText'),
  statusSummary: $('statusSummary'), lastSeen: $('lastSeen'), cpuMetric: $('cpuMetric'), ramMetric: $('ramMetric'), uptimeMetric: $('uptimeMetric'),
  refreshBtn: $('refreshBtn'), desktopBtn: $('desktopBtn'), browserBtn: $('browserBtn'), controlsLock: $('controlsLock'),
  connectView: $('connectView'), connectBackBtn: $('connectBackBtn'), connectDesktopBtn: $('connectDesktopBtn'), connectFootnote: $('connectFootnote'),
  privacyDetail: $('privacyDetail'), privacyDetailIcon: $('privacyDetailIcon'), privacyDetailTitle: $('privacyDetailTitle'), privacyNote: $('privacyNote'),
  sessionView: $('sessionView'), desktopFrame: $('desktopFrame'), sessionMenu: $('sessionMenu'), sessionConnectionText: $('sessionConnectionText'),
  sessionPrivacyLabel: $('sessionPrivacyLabel'), sessionWindowsState: $('sessionWindowsState'), sessionInputLabel: $('sessionInputLabel'),
  hubCloseBtn: $('hubCloseBtn'), surfaceToolbar: $('surfaceToolbar'), surfaceMenuBtn: $('surfaceMenuBtn'), surfaceTitle: $('surfaceTitle'),
  surfaceSubtitle: $('surfaceSubtitle'), surfaceStatusDot: $('surfaceStatusDot'), keyboardBtn: $('keyboardBtn'),
  menuAudioBtn: $('menuAudioBtn'), menuAudioLabel: $('menuAudioLabel'), surfaceAudioBtn: $('surfaceAudioBtn'), surfaceAudioLabel: $('surfaceAudioLabel'),
  appsMenu: $('appsMenu'), appsBackBtn: $('appsBackBtn'), appsAudioBtn: $('appsAudioBtn'), appsAudioLabel: $('appsAudioLabel'), appsList: $('appsList'),
  adminMenu: $('adminMenu'), adminBackBtn: $('adminBackBtn'), adminAudioBtn: $('adminAudioBtn'), adminAudioLabel: $('adminAudioLabel'), adminUpdateBtn: $('adminUpdateBtn'),
  commandBrowser: $('commandBrowser'), commandApps: $('commandApps'), commandDesktop: $('commandDesktop'), commandAdmin: $('commandAdmin'), commandUpdate: $('commandUpdate'), disconnectBtn: $('disconnectBtn'),
  surfaceDock: $('surfaceDock'), dockCommandsBtn: $('dockCommandsBtn'), dockKeyboardBtn: $('dockKeyboardBtn'), dockAudioBtn: $('dockAudioBtn'), dockAudioLabel: $('dockAudioLabel'),
  dockInputBtn: $('dockInputBtn'), dockInputIcon: $('dockInputIcon'), dockInputLabel: $('dockInputLabel'), dockDisconnectBtn: $('dockDisconnectBtn'),
  browserView: $('browserView'), browserAudioBtn: $('browserAudioBtn'), browserAudioLabel: $('browserAudioLabel'),
  audioDialog: $('audioDialog'), audioDialogTitle: $('audioDialogTitle'), audioRoutingNote: $('audioRoutingNote'),
  confirmDialog: $('confirmDialog'), confirmGlyph: $('confirmGlyph'), confirmTitle: $('confirmTitle'), confirmText: $('confirmText'), confirmAction: $('confirmAction'),
  toast: $('toast')
};

const labels = {
  offline: 'Offline',
  asleep: 'Asleep',
  onlineUnlocked: 'Online · Unlocked',
  onlineLocked: 'Online · Locked'
};
const audioLabels = { desktop: 'Desktop', mobile: 'Mobile', both: 'Both', muted: 'Muted' };

let config = null;
let currentStatus = null;
let apps = [];
let selectedPrivacy = localStorage.getItem('mrdPrivacyMode') || 'not-secret';
let sessionReady = false;
let sessionActive = false;
let activeSurface = null;
let keyboardOpen = false;
let inputMode = localStorage.getItem('mrdInputMode') === 'pointer' ? 'pointer' : 'touch';
let guacReadyTimer = null;
let guacAudioObserver = null;
let pendingConfirm = null;
let lastHeartbeat = 0;
let disconnectTimer = null;
let audioDialogMode = 'desktop';
let updateInProgress = false;
let audioState = { desktopMode:'mobile', browserMode:'mobile', activeMode:'none', effectiveDestination:null, routingApplied:false };
const mobileAudio = { context:null, socket:null, nextTime:0, format:{ sampleRate:48000, channels:2 } };

init();

async function init() {
  syncViewportHeight();
  registerServiceWorker();
  bindUi();

  try {
    config = await fetchJson('/api/config');
    const name = config.pcName || 'Home PC';
    app.pcName.textContent = name;
    app.statusDeviceName.textContent = name;
    app.connectDesktopBtn.querySelector('span').textContent = `Connect to ${name}`;
    setPowerButtons(Boolean(config.powerControlsEnabled));
    if (!['secret','not-secret'].includes(selectedPrivacy)) selectedPrivacy = config.desktop?.privacy?.defaultMode || 'not-secret';
  } catch {
    setPowerButtons(false);
  }

  renderPrivacySelection();
  renderInputMode();
  await Promise.all([refreshStatus(), refreshAudio()]);
  connectEvents();
  showRecentUpdateResult();
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
  app.dockAudioBtn.addEventListener('click', () => openAudioDialog('desktop'));
  document.querySelectorAll('[data-audio-destination]').forEach(btn => btn.addEventListener('click', () => chooseAudioDestination(btn.dataset.audioDestination)));

  app.surfaceMenuBtn.addEventListener('click', showSessionMenu);
  app.dockCommandsBtn.addEventListener('click', showSessionMenu);
  app.keyboardBtn.addEventListener('click', toggleKeyboard);
  app.dockKeyboardBtn.addEventListener('click', toggleKeyboard);
  app.dockInputBtn.addEventListener('click', toggleInputMode);
  app.dockDisconnectBtn.addEventListener('click', requestDisconnect);
  app.hubCloseBtn.addEventListener('click', requestDisconnect);

  app.commandBrowser.addEventListener('click', () => launchApp('chrome', 'Browser'));
  app.commandApps.addEventListener('click', showAppsMenu);
  app.commandDesktop.addEventListener('click', () => showSurface('Full Desktop', 'MRD Desktop'));
  app.commandAdmin.addEventListener('click', showAdminMenu);
  app.commandUpdate.addEventListener('click', requestRemoteUpdate);
  app.adminUpdateBtn.addEventListener('click', requestRemoteUpdate);
  app.disconnectBtn.addEventListener('click', requestDisconnect);
  app.appsBackBtn.addEventListener('click', showSessionMenu);
  app.adminBackBtn.addEventListener('click', showSessionMenu);

  document.querySelectorAll('[data-admin-action]').forEach(btn => btn.addEventListener('click', () => runAdminAction(btn.dataset.adminAction, btn)));
  document.querySelectorAll('[data-power]').forEach(btn => btn.addEventListener('click', () => requestPower(btn.dataset.power)));
  document.querySelectorAll('[data-close-view]').forEach(btn => btn.addEventListener('click', closeBrowserPreview));

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
      syncViewportHeight();
      refreshStatus();
      if (sessionActive) startGuacReadyWatch();
    }
  });

  window.addEventListener('resize', syncViewportHeight, { passive:true });
  window.visualViewport?.addEventListener('resize', syncViewportHeight, { passive:true });
}

function syncViewportHeight() {
  const height = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty('--viewport-height', `${Math.round(height)}px`);
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
  if (!['secret','not-secret'].includes(mode)) return;
  selectedPrivacy = mode;
  localStorage.setItem('mrdPrivacyMode', mode);
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
    app.privacyDetail.dataset.mode = 'secret';
    app.privacyDetailIcon.textContent = '◌';
    app.privacyDetailTitle.textContent = 'Secret';
    app.privacyNote.textContent = secretSupported
      ? 'Physical console stays active. MRD uses its console-sharing transport.'
      : 'Physical console should stay active, but the console/virtual-display transport is not installed yet. MRD will not fall back to RDP because RDP would lock the PC.';
    app.connectFootnote.textContent = secretSupported ? 'Secret transport ready.' : 'Secret is visible now, but connection is blocked until its transport is installed.';
  } else {
    app.privacyDetail.dataset.mode = 'not-secret';
    app.privacyDetailIcon.textContent = '◆';
    app.privacyDetailTitle.textContent = 'Not Secret';
    app.privacyNote.textContent = 'Physical console locks while connected. Uses the proven Windows RDP transport.';
    app.connectFootnote.textContent = 'Encrypted privately through Tailscale Serve.';
  }
}

async function connectDesktopSession() {
  app.connectDesktopBtn.disabled = true;
  const label = app.connectDesktopBtn.querySelector('span');
  const previousLabel = label?.textContent || 'Connect';
  if (label) label.textContent = 'Connecting…';

  try {
    const result = await fetchJson('/api/session/prepare', {
      method:'POST',
      body:JSON.stringify({ privacyMode:selectedPrivacy })
    });

    sessionActive = true;
    sessionReady = false;
    activeSurface = null;
    keyboardOpen = false;
    app.sessionPrivacyLabel.textContent = selectedPrivacy === 'secret' ? 'Secret' : 'Not Secret';
    app.sessionConnectionText.textContent = 'Connecting to MRD Desktop…';
    app.sessionConnectionText.className = '';
    app.connectView.hidden = true;
    app.sessionView.hidden = false;
    showSessionMenu();
    void setActiveAudioMode('desktop');

    const desktopPath = result.desktopPath || config?.desktop?.path || '/guacamole/';
    app.desktopFrame.src = desktopPath;
    startGuacReadyWatch();
  } catch (error) {
    app.privacyNote.textContent = error.message;
    app.connectFootnote.textContent = selectedPrivacy === 'secret' ? 'Secret connection was not started.' : 'Connection failed.';
    showToast(error.message);
  } finally {
    app.connectDesktopBtn.disabled = false;
    if (label) label.textContent = previousLabel;
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
      app.sessionWindowsState.textContent = currentStatus?.locked ? 'Locked' : 'Connected';
      syncGuacamoleAudioRoute();
      applyGuacInputMode();
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

function getGuacClientScope() {
  try {
    const doc = app.desktopFrame.contentDocument;
    const win = app.desktopFrame.contentWindow;
    if (!doc?.documentElement || !win?.angular) return null;
    const candidates = [doc.querySelector('guac-viewport'), doc.querySelector('.client-view'), doc.querySelector('.client-body')].filter(Boolean);
    for (const element of candidates) {
      let scope = win.angular.element(element).scope?.() || null;
      let depth = 0;
      while (scope && depth < 8) {
        if (scope.menu) return scope;
        scope = scope.$parent;
        depth += 1;
      }
    }
  } catch {}
  return null;
}

function probeGuacClientReady() {
  try {
    const doc = app.desktopFrame.contentDocument;
    if (!doc?.documentElement) return false;
    const scope = getGuacClientScope();
    if (!scope) return false;
    injectGuacBridgeStyles(doc);
    updateGuacScope(scope, () => {
      scope.menu.inputMethod = 'text';
      scope.menu.emulateAbsoluteMouse = inputMode === 'touch';
      if ('shown' in scope.menu) scope.menu.shown = false;
    });
    return Boolean(doc.querySelector('.text-input textarea.target'));
  } catch {
    return false;
  }
}

function updateGuacScope(scope, fn) {
  try {
    if (scope.$root?.$$phase) fn();
    else scope.$apply(fn);
  } catch {
    try { fn(); } catch {}
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
    showToast('Keyboard will be ready after Windows finishes connecting.');
    return;
  }
  const target = getGuacKeyboardTarget();
  if (!target) {
    showToast('Keyboard bridge is not ready yet.');
    return;
  }

  if (keyboardOpen) closeKeyboard();
  else {
    try { target.focus({ preventScroll:true }); } catch { target.focus(); }
    keyboardOpen = true;
    document.body.classList.add('keyboard-open');
    renderKeyboardState();
  }
}

function closeKeyboard() {
  const target = getGuacKeyboardTarget();
  try { target?.blur(); } catch {}
  keyboardOpen = false;
  document.body.classList.remove('keyboard-open');
  renderKeyboardState();
}

function renderKeyboardState() {
  const open = keyboardOpen;
  app.keyboardBtn.setAttribute('aria-pressed', String(open));
  app.keyboardBtn.setAttribute('aria-label', open ? 'Close keyboard' : 'Open keyboard');
  app.dockKeyboardBtn.classList.toggle('active', open);
  app.dockKeyboardBtn.querySelector('small').textContent = open ? 'Close' : 'Keyboard';
}

function toggleInputMode() {
  inputMode = inputMode === 'touch' ? 'pointer' : 'touch';
  localStorage.setItem('mrdInputMode', inputMode);
  renderInputMode();
  applyGuacInputMode();
  showToast(inputMode === 'touch' ? 'Direct touch input' : 'Precision pointer input');
}

function renderInputMode() {
  const touch = inputMode === 'touch';
  app.dockInputLabel.textContent = touch ? 'Touch' : 'Pointer';
  app.dockInputIcon.textContent = touch ? '◉' : '↖';
  app.dockInputBtn.classList.toggle('active', !touch);
  app.sessionInputLabel.textContent = touch ? 'Touch' : 'Pointer';
}

function applyGuacInputMode() {
  const scope = getGuacClientScope();
  if (!scope) return;
  updateGuacScope(scope, () => {
    scope.menu.emulateAbsoluteMouse = inputMode === 'touch';
    scope.menu.inputMethod = 'text';
    if ('shown' in scope.menu) scope.menu.shown = false;
  });
}

function showSessionMenu() {
  if (!sessionActive) return;
  closeKeyboard();
  activeSurface = null;
  app.surfaceToolbar.hidden = true;
  app.surfaceDock.hidden = true;
  app.sessionMenu.hidden = false;
  app.appsMenu.hidden = true;
  app.adminMenu.hidden = true;
}

function showAppsMenu() {
  closeKeyboard();
  activeSurface = null;
  app.surfaceToolbar.hidden = true;
  app.surfaceDock.hidden = true;
  app.sessionMenu.hidden = true;
  app.adminMenu.hidden = true;
  app.appsMenu.hidden = false;
  if (!apps.length) loadApps();
}

function showAdminMenu() {
  closeKeyboard();
  activeSurface = null;
  app.surfaceToolbar.hidden = true;
  app.surfaceDock.hidden = true;
  app.sessionMenu.hidden = true;
  app.appsMenu.hidden = true;
  app.adminMenu.hidden = false;
}

function showSurface(title, subtitle = 'MRD Desktop') {
  activeSurface = title;
  app.sessionMenu.hidden = true;
  app.appsMenu.hidden = true;
  app.adminMenu.hidden = true;
  app.surfaceTitle.textContent = title;
  app.surfaceSubtitle.textContent = subtitle;
  app.surfaceToolbar.hidden = false;
  app.surfaceDock.hidden = false;
  startGuacReadyWatch();
  applyGuacInputMode();
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
    showToast('Finish the Windows connection, then return to Commands.');
    return;
  }
  showToast(`Opening ${surfaceName}…`);
  try {
    const result = await fetchJson(`/api/apps/${encodeURIComponent(id)}/launch`, { method:'POST' });
    if (result.panel === 'mrd-admin') return showAdminMenu();
    setTimeout(() => showSurface(surfaceName, result.app?.name || 'MRD Desktop'), 220);
  } catch (error) {
    showToast(error.message);
  }
}

async function runAdminAction(action, button) {
  const destructive = ['restart-guacamole','restart-docker','restart-tailscale','restart-mrd'].includes(action);
  const titles = {
    'restart-guacamole':'Restart Guacamole?',
    'restart-docker':'Restart Docker Desktop?',
    'restart-tailscale':'Restart Tailscale?',
    'restart-mrd':'Restart MRD Host?'
  };
  const descriptions = {
    'restart-guacamole':'The active remote desktop will disconnect while Guacamole restarts.',
    'restart-docker':'Docker and Guacamole will be temporarily unavailable.',
    'restart-tailscale':'The private MRD connection may briefly drop while Tailscale restarts.',
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

  if (destructive) requestConfirm(titles[action], descriptions[action], titles[action].replace('?', ''), execute, 'restart');
  else await execute();
}

function requestDisconnect() {
  requestConfirm('Disconnect from PC?', 'The remote desktop session will close and MRD will return to the dashboard.', 'Disconnect', disconnectDesktopSession, 'disconnect');
}

async function disconnectDesktopSession() {
  closeKeyboard();
  clearInterval(guacReadyTimer);
  guacReadyTimer = null;
  guacAudioObserver?.disconnect();
  guacAudioObserver = null;
  sessionActive = false;
  sessionReady = false;
  activeSurface = null;
  app.desktopFrame.src = 'about:blank';
  app.sessionView.hidden = true;
  app.surfaceToolbar.hidden = true;
  app.surfaceDock.hidden = true;
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

  if (audioDialogMode === 'desktop') syncGuacamoleAudioRoute();
  else if (destination === 'mobile' || destination === 'both') primeMobileAudio();
  renderAudioState();

  try {
    audioState = await fetchJson('/api/audio', { method:'PUT', body:JSON.stringify({ mode:audioDialogMode, destination }) });
    renderAudioState();
    app.audioDialog.close();
    showToast(`Audio → ${audioLabels[destination]}`);
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
  const desktopLabel = audioLabels[desktopDestination] || 'Mobile';
  app.menuAudioLabel.textContent = desktopLabel;
  app.surfaceAudioLabel.textContent = desktopLabel;
  app.appsAudioLabel.textContent = desktopLabel;
  app.adminAudioLabel.textContent = desktopLabel;
  app.dockAudioLabel.textContent = desktopLabel;
  app.browserAudioLabel.textContent = audioLabels[browserDestination] || 'Mobile';

  const selected = audioDialogMode === 'desktop' ? desktopDestination : browserDestination;
  document.querySelectorAll('[data-audio-destination]').forEach(btn => {
    const active = btn.dataset.audioDestination === selected;
    btn.classList.toggle('selected', active);
    btn.setAttribute('aria-selected', String(active));
  });

  if (audioDialogMode === 'desktop') {
    app.audioRoutingNote.textContent = 'Phone audio is delivered through the RDP/Guacamole session; MRD controls physical PC output separately.';
  } else if (audioState.router?.lastError) {
    app.audioRoutingNote.textContent = `Audio Router error: ${audioState.router.lastError}`;
  } else {
    app.audioRoutingNote.textContent = audioState.routingApplied ? 'Live Windows audio routing is active.' : 'Audio destination is saved for the browser engine.';
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
  if (mobileAudio.socket && [WebSocket.OPEN,WebSocket.CONNECTING].includes(mobileAudio.socket.readyState)) return;
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
    try { mobileAudio.socket.close(1000,'Audio destination changed'); } catch {}
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
  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.getChannelData(1);
  let offset = 0;
  for (let i = 0; i < frames; i++) {
    left[i] = view.getInt16(offset,true) / 32768;
    right[i] = view.getInt16(offset + 2,true) / 32768;
    offset += 4;
  }
  const source = context.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(context.destination);
  const floor = context.currentTime + .045;
  let start = Math.max(floor,mobileAudio.nextTime || floor);
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
  } catch {
    renderDisconnectedState();
  }
}

function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('status', event => {
    lastHeartbeat = Date.now();
    renderStatus(JSON.parse(event.data));
  });
  es.addEventListener('audio', event => {
    audioState = JSON.parse(event.data);
    renderAudioState();
  });
  es.addEventListener('heartbeat', () => {
    lastHeartbeat = Date.now();
    scheduleDisconnectCheck();
  });
  es.onerror = scheduleDisconnectCheck;
}

function scheduleDisconnectCheck() {
  clearTimeout(disconnectTimer);
  disconnectTimer = setTimeout(() => {
    if (Date.now() - lastHeartbeat > 8000) renderDisconnectedState();
  },8500);
}

function renderStatus(status) {
  currentStatus = status;
  const state = status.state || 'offline';
  app.statusPill.dataset.state = state;
  app.statusText.textContent = labels[state] || state;
  app.lastSeen.textContent = status.roundTripMs != null ? `${status.roundTripMs} ms round trip` : 'Live status';
  app.cpuMetric.textContent = status.metrics ? `${status.metrics.cpuPercent}%` : '—';
  app.ramMetric.textContent = status.metrics ? `${status.metrics.memoryPercent}%` : '—';
  app.uptimeMetric.textContent = status.host ? formatUptime(status.host.uptimeSeconds) : '—';
  app.statusSummary.textContent = statusSummaryFor(state);
  app.sessionWindowsState.textContent = state === 'onlineLocked' ? 'Locked' : state === 'onlineUnlocked' ? 'Unlocked' : labels[state] || state;
  app.surfaceStatusDot.style.background = state === 'onlineUnlocked' ? 'var(--unlocked)' : state === 'onlineLocked' ? 'var(--locked)' : state === 'asleep' ? 'var(--asleep)' : 'var(--offline)';
  if (state === 'asleep') localStorage.setItem('pcRemoteLastSleep',String(Date.now()));
  if (state.startsWith('online')) localStorage.removeItem('pcRemoteLastSleep');
  scheduleDisconnectCheck();
}

function statusSummaryFor(state) {
  if (state === 'onlineLocked') return 'Ready for remote access · local console locked';
  if (state === 'onlineUnlocked') return 'Ready for remote access · local console active';
  if (state === 'asleep') return 'PC is sleeping';
  return 'Host is not reachable';
}

function renderDisconnectedState() {
  const lastSleep = Number(localStorage.getItem('pcRemoteLastSleep') || 0);
  const looksAsleep = lastSleep && Date.now() - lastSleep < 12 * 60 * 60 * 1000;
  const state = looksAsleep ? 'asleep' : 'offline';
  app.statusPill.dataset.state = state;
  app.statusText.textContent = labels[state];
  app.statusSummary.textContent = looksAsleep ? 'PC is sleeping' : 'Host is not reachable';
  app.lastSeen.textContent = looksAsleep ? 'Last action: sleep' : 'Waiting for connection';
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
  requestConfirm(title,text,title.replace('?',''),async () => {
    try {
      const result = await fetchJson(`/api/power/${action}`,{method:'POST'});
      if (action === 'sleep') localStorage.setItem('pcRemoteLastSleep',String(Date.now()));
      showToast(result.ok ? `${capitalize(action)} sent` : result.error);
      setTimeout(refreshStatus,action === 'lock' ? 1200 : 2500);
    } catch (error) {
      showToast(error.message);
    }
  }, action === 'shutdown' ? 'danger' : 'power');
}

function requestConfirm(title,text,actionLabel,callback,glyph='!') {
  pendingConfirm = callback;
  app.confirmTitle.textContent = title;
  app.confirmText.textContent = text;
  app.confirmAction.textContent = actionLabel;
  app.confirmGlyph.textContent = glyph === 'restart' ? '↻' : glyph === 'disconnect' ? '⏻' : glyph === 'update' ? '⇣' : '!';
  app.confirmDialog.showModal();
}

function setPowerButtons(enabled) {
  document.querySelectorAll('[data-power]').forEach(btn => btn.disabled = !enabled);
  app.controlsLock.textContent = enabled ? 'Enabled' : 'Disabled in setup';
}

function requestRemoteUpdate() {
  if (updateInProgress) return;
  requestConfirm(
    'Update MRD?',
    'MRD will pull the latest GitHub code with fast-forward only, run Start-MRD.cmd, briefly disconnect, then reload when the host returns.',
    'Update MRD',
    runRemoteUpdate,
    'update'
  );
}

async function runRemoteUpdate() {
  if (updateInProgress) return;
  updateInProgress = true;
  setUpdateUi(true,'Updating MRD…','Pulling GitHub & restarting');
  showToast('MRD update started');
  const startedAt = Date.now();

  try {
    const result = await fetchJson('/api/apps/update-mrd/launch',{method:'POST'});
    if (!result.ok) throw new Error(result.error || 'Could not start MRD updater.');
    await monitorUpdate(startedAt);
  } catch (error) {
    updateInProgress = false;
    setUpdateUi(false);
    showToast(error.message || 'Could not start MRD update');
  }
}

function setUpdateUi(busy,title='Update MRD',detail='Pull latest GitHub code & restart') {
  for (const button of [app.commandUpdate,app.adminUpdateBtn].filter(Boolean)) {
    button.disabled = busy;
    const strong = button.querySelector('strong');
    const small = button.querySelector('small');
    if (strong) strong.textContent = title;
    if (small) small.textContent = detail;
  }
}

async function monitorUpdate(startedAt) {
  let sawHostOffline = false;
  const deadline = Date.now() + 120000;

  while (Date.now() < deadline) {
    const result = await readUpdateResult();
    if (result && Number(result.at || 0) >= startedAt - 2000) {
      if (result.state === 'failed') {
        updateInProgress = false;
        setUpdateUi(false);
        showToast(result.message || 'MRD update failed');
        return;
      }
      if (result.state === 'success') {
        showToast('MRD updated · reloading');
        await delay(800);
        location.reload();
        return;
      }
    }

    try {
      const response = await fetch(`/api/status?update=${Date.now()}`,{cache:'no-store'});
      if (!response.ok) throw new Error('Host unavailable');
      if (sawHostOffline) {
        showToast('MRD is back online · loading update');
        await delay(1100);
        location.reload();
        return;
      }
    } catch {
      sawHostOffline = true;
    }

    await delay(1200);
  }

  updateInProgress = false;
  setUpdateUi(false);
  showToast('Update is taking longer than expected. MRD may still be restarting.');
}

async function showRecentUpdateResult() {
  await delay(900);
  const result = await readUpdateResult();
  if (!result) return;
  const age = Date.now() - Number(result.at || 0);
  if (age < 0 || age > 180000) return;
  if (result.state === 'success') showToast('MRD update completed successfully');
  else if (result.state === 'failed') showToast(result.message || 'MRD update failed');
}

async function readUpdateResult() {
  try {
    const response = await fetch(`/update-result.json?t=${Date.now()}`,{cache:'no-store'});
    if (!response.ok) return null;
    const type = response.headers.get('content-type') || '';
    if (!type.includes('application/json')) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchJson(url,options={}) {
  const headers = {Accept:'application/json',...(options.body ? {'Content-Type':'application/json'} : {}),...(options.headers || {})};
  const response = await fetch(url,{cache:'no-store',...options,headers});
  let body = {};
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new Error(body.error || `${response.status} ${response.statusText}`);
  return body;
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  if (days) return `${days}d ${hours}h`;
  return `${hours}h ${Math.floor((seconds % 3600) / 60)}m`;
}

function showToast(text) {
  app.toast.textContent = text;
  app.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => app.toast.classList.remove('show'),3600);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}

function capitalize(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
function delay(ms) { return new Promise(resolve => setTimeout(resolve,ms)); }
function registerServiceWorker() { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {}); }
