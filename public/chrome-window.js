(() => {
  const $ = id => document.getElementById(id);
  const state = {
    mode: localStorage.getItem('mrdChromeMode') === 'normal' ? 'normal' : 'incognito',
    autoTimer: null,
    launchCallback: null,
    chromeSurface: false
  };

  renderMode();
  bind();
  window.MRDChrome = { openChooser, launch, getMode: () => state.mode, setSurfaceActive };

  function bind() {
    $('browserBtn')?.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      setConnectIntent('browser');
      $('connectView').hidden = false;
      document.body.style.overflow = 'hidden';
    }, true);

    $('desktopBtn')?.addEventListener('click', () => setConnectIntent('desktop'), true);

    $('connectDesktopBtn')?.addEventListener('click', () => {
      if (($('connectView')?.dataset.intent || 'desktop') === 'browser') armAutoLaunch();
    }, true);

    document.querySelectorAll('[data-browser-mode]').forEach(button => {
      button.addEventListener('click', () => selectMode(button.dataset.browserMode));
    });

    $('browserModeOpenBtn')?.addEventListener('click', () => void launch(state.mode, state.launchCallback));
    $('browserModeCloseBtn')?.addEventListener('click', () => $('browserModeDialog')?.close());

    $('commandBrowser')?.addEventListener('click', event => {
      if ($('sessionView')?.hidden) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openChooser(showChromeSurface);
    }, true);

    $('appsList')?.addEventListener('click', event => {
      const card = event.target.closest('.app-card');
      if (!card || card.dataset.appId !== 'chrome') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openChooser(showChromeSurface);
    }, true);

    for (const id of ['surfaceAudioBtn', 'dockAudioBtn']) {
      $(id)?.addEventListener('click', event => {
        if (!state.chromeSurface) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        window.MRDAudio?.open?.('browser');
      }, true);
    }

    for (const id of ['commandDesktop', 'commandApps', 'commandAdmin']) {
      $(id)?.addEventListener('click', () => setSurfaceActive(false), true);
    }

    $('appsList')?.addEventListener('click', event => {
      const card = event.target.closest('.app-card');
      if (card && card.dataset.appId !== 'chrome') setSurfaceActive(false);
    }, true);

    $('confirmDialog')?.addEventListener('close', () => {
      if ($('confirmDialog')?.returnValue !== 'confirm') return;
      if (($('confirmTitle')?.textContent || '').startsWith('Disconnect')) {
        void closeManagedChrome();
        setSurfaceActive(false);
      }
    });
  }

  function setConnectIntent(intent) {
    const browser = intent === 'browser';
    const view = $('connectView');
    if (view) view.dataset.intent = browser ? 'browser' : 'desktop';
    if ($('browserModeCard')) $('browserModeCard').hidden = !browser;
    if ($('connectHeadingTitle')) $('connectHeadingTitle').textContent = browser ? 'Google Chrome' : 'Desktop';
    if ($('connectHeadingSubtitle')) $('connectHeadingSubtitle').textContent = browser ? 'Chrome connection setup' : 'Connection setup';
    if ($('connectHeroGlyph')) $('connectHeroGlyph').textContent = browser ? '◎' : '▣';
    if ($('connectHeroEyebrow')) $('connectHeroEyebrow').textContent = browser ? 'REMOTE CHROME' : 'REMOTE WINDOWS';
    if ($('connectHeroTitle')) $('connectHeroTitle').textContent = browser ? 'Choose privacy and Chrome mode' : 'Choose privacy first';
    if ($('connectHeroText')) $('connectHeroText').textContent = browser
      ? 'MRD connects the virtual-display transport, then silently opens or focuses one managed Chrome window.'
      : 'Your privacy mode is fixed for this connection.';
    const label = $('connectDesktopBtn')?.querySelector('span');
    const pc = $('pcName')?.textContent?.trim() || 'Home PC';
    if (label) label.textContent = browser ? 'Connect & open Chrome' : `Connect to ${pc}`;
    renderMode();
  }

  function selectMode(mode) {
    if (!['normal', 'incognito'].includes(mode)) return;
    state.mode = mode;
    localStorage.setItem('mrdChromeMode', mode);
    renderMode();
  }

  function renderMode() {
    document.querySelectorAll('[data-browser-mode]').forEach(button => {
      const selected = button.dataset.browserMode === state.mode;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-checked', String(selected));
    });
    const normal = state.mode === 'normal';
    if ($('browserModeDetailTitle')) $('browserModeDetailTitle').textContent = normal ? 'Normal' : 'Incognito';
    if ($('browserModeDetailText')) $('browserModeDetailText').textContent = normal
      ? 'Uses your existing Chrome profile, including normal website cookies and signed-in sessions.'
      : 'Uses your existing Chrome profile for bookmarks and saved passwords, while website cookies remain private to this Incognito session.';
    if ($('browserModeDialogNote')) {
      $('browserModeDialogNote').textContent = normal
        ? 'Normal mode carries over your existing website logins and browsing state.'
        : 'Incognito uses your existing Chrome profile foundation without inheriting normal website cookies.';
      $('browserModeDialogNote').style.color = '';
    }
  }

  function openChooser(callback = showChromeSurface) {
    state.launchCallback = callback;
    renderMode();
    $('browserModeDialog')?.showModal();
  }

  function armAutoLaunch() {
    clearInterval(state.autoTimer);
    const deadline = Date.now() + 90000;
    state.autoTimer = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(state.autoTimer);
        state.autoTimer = null;
        return;
      }
      if ($('sessionView')?.hidden) return;
      const vdd = document.body.classList.contains('mrd-vdd-active') || document.body.classList.contains('mrd-secret-active');
      const secretFrame = $('secretFrame');
      const ready = vdd
        ? Boolean(secretFrame && !secretFrame.hidden && secretFrame.getAttribute('src'))
        : $('sessionConnectionText')?.classList.contains('ready');
      if (!ready) return;
      clearInterval(state.autoTimer);
      state.autoTimer = null;
      void launch(state.mode, showChromeSurface);
    }, 250);
  }

  async function launch(mode = state.mode, callback = showChromeSurface) {
    selectMode(mode);
    const button = $('browserModeOpenBtn');
    const note = $('browserModeDialogNote');
    if (button) button.disabled = true;
    if (note) {
      note.textContent = state.mode === 'incognito' ? 'Opening Incognito Chrome on the MRD virtual display…' : 'Opening Chrome on the MRD virtual display…';
      note.style.color = '';
    }
    toast(state.mode === 'incognito' ? 'Opening Incognito Chrome…' : 'Opening Chrome…');
    try {
      const result = await fetchJson('/api/chrome/open', {
        method: 'POST',
        body: JSON.stringify({ mode: state.mode })
      });
      $('browserModeDialog')?.close();
      setSurfaceActive(true);
      await setActiveAudio('browser');
      (callback || showChromeSurface)(result);
      toast(result.action === 'focused' ? 'Chrome focused' : `${state.mode === 'incognito' ? 'Incognito ' : ''}Chrome opened`);
      return result;
    } catch (error) {
      const message = error?.message || 'Chrome launch failed.';
      if (note) {
        note.textContent = `Chrome launch failed: ${message}`;
        note.style.color = '#ff9b9b';
      }
      toast(message);
      return null;
    } finally {
      if (button) button.disabled = false;
      state.launchCallback = null;
    }
  }

  function showChromeSurface() {
    if ($('sessionView')?.hidden) return;
    $('sessionMenu').hidden = true;
    $('appsMenu').hidden = true;
    $('adminMenu').hidden = true;
    $('surfaceTitle').textContent = state.mode === 'incognito' ? 'Chrome · Incognito' : 'Google Chrome';
    const vdd = document.body.classList.contains('mrd-vdd-active') || document.body.classList.contains('mrd-secret-active');
    $('surfaceSubtitle').textContent = vdd ? 'MRD virtual display' : 'MRD Desktop';
    $('surfaceToolbar').hidden = false;
    $('surfaceDock').hidden = false;
    if (vdd && $('secretFrame')) $('secretFrame').hidden = false;
    setSurfaceActive(true);
  }

  function setSurfaceActive(active) {
    state.chromeSurface = Boolean(active);
    document.body.classList.toggle('mrd-chrome-surface', state.chromeSurface);
    if (!state.chromeSurface) void setActiveAudio('desktop');
    void refreshSurfaceAudioLabel();
  }

  async function refreshSurfaceAudioLabel() {
    if (!state.chromeSurface) return;
    try {
      const audio = await fetchJson('/api/audio');
      const labels = { desktop:'Desktop', mobile:'Mobile', both:'Both', muted:'Muted' };
      const label = labels[audio.browserMode] || 'Mobile';
      if ($('surfaceAudioLabel')) $('surfaceAudioLabel').textContent = label;
      if ($('dockAudioLabel')) $('dockAudioLabel').textContent = label;
    } catch {}
  }

  async function setActiveAudio(activeMode) {
    try {
      await fetchJson('/api/audio', { method:'PUT', body:JSON.stringify({ activeMode }) });
    } catch {}
    await refreshSurfaceAudioLabel();
  }

  async function closeManagedChrome() {
    try { await fetch('/api/chrome/close', { method:'POST', cache:'no-store' }); } catch {}
  }

  async function fetchJson(url, options={}) {
    const response = await fetch(url, {
      cache:'no-store',
      ...options,
      headers:{ Accept:'application/json', ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers || {}) }
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) throw new Error(body.error || `${response.status} ${response.statusText}`);
    return body;
  }

  function toast(text) {
    const node = $('toast');
    if (!node) return;
    node.textContent = text;
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 3200);
  }
})();
