(() => {
  const state = {
    active: false,
    ready: false,
    privacyMode: 'not-secret',
    video: null,
    input: null,
    frameUrl: null,
    inputMode: localStorage.getItem('mrdInputMode') === 'pointer' ? 'pointer' : 'touch',
    pointer: null,
    pointers: new Map(),
    pointerGesture: null,
    catalog: null,
    audio: { context:null, socket:null, nextTime:0, format:{ sampleRate:48000, channels:2 } }
  };

  const $ = id => document.getElementById(id);
  const sessionStage = document.querySelector('.session-stage');
  if (!sessionStage) return;

  const frame = document.createElement('img');
  frame.id = 'secretFrame';
  frame.className = 'secret-frame';
  frame.alt = 'MRD virtual display';
  frame.draggable = false;
  frame.hidden = true;
  sessionStage.insertBefore(frame, sessionStage.firstChild);

  const keyboard = document.createElement('textarea');
  keyboard.id = 'secretKeyboardTarget';
  keyboard.className = 'secret-keyboard-target';
  keyboard.rows = 1;
  keyboard.autocomplete = 'off';
  keyboard.autocapitalize = 'none';
  keyboard.autocorrect = 'off';
  keyboard.spellcheck = false;
  document.body.appendChild(keyboard);

  const style = document.createElement('style');
  style.textContent = `
    .secret-frame{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#020304;z-index:1;touch-action:none;user-select:none;-webkit-user-select:none;-webkit-touch-callout:none}
    .secret-keyboard-target{position:fixed;left:50%;bottom:calc(74px + env(safe-area-inset-bottom));width:2px;height:2px;opacity:.01;z-index:9999;border:0;padding:0;pointer-events:none}
    body.mrd-vdd-active #desktopFrame{display:none!important}
    body.mrd-vdd-active .surface-title small::after{content:' · VDD';color:var(--accent)}
  `;
  document.head.appendChild(style);

  bindVddUi();
  bindPrivacyCopy();

  function selectedPrivacy() {
    return document.querySelector('[data-privacy-mode].selected')?.dataset.privacyMode || 'not-secret';
  }

  function bindPrivacyCopy() {
    const note = $('privacyNote');
    if (note) {
      const observer = new MutationObserver(() => syncPrivacyCopy());
      observer.observe(note, { childList:true, characterData:true, subtree:true });
    }
    document.querySelectorAll('[data-privacy-mode]').forEach(button => {
      button.addEventListener('click', () => setTimeout(syncPrivacyCopy, 0));
    });
    for (const delay of [0,150,500,1200]) setTimeout(syncPrivacyCopy, delay);
  }

  function syncPrivacyCopy() {
    const mode = selectedPrivacy();
    const note = $('privacyNote');
    const foot = $('connectFootnote');
    const title = $('privacyDetailTitle');
    if (mode === 'secret') {
      if (title) title.textContent = 'Secret';
      const text = 'MRD uses the virtual display while a privacy curtain covers every physical monitor. Windows stays in the interactive console session.';
      if (note && note.textContent !== text) note.textContent = text;
      const footer = 'Physical monitors hidden · MRD virtual display remains active.';
      if (foot && foot.textContent !== footer) foot.textContent = footer;
    } else {
      if (title) title.textContent = 'Not Secret';
      const text = 'MRD uses the same virtual display, but physical monitors remain visible and usable.';
      if (note && note.textContent !== text) note.textContent = text;
      const footer = 'Physical monitors visible · MRD virtual display remains active.';
      if (foot && foot.textContent !== footer) foot.textContent = footer;
    }
  }

  function bindVddUi() {
    $('connectDesktopBtn')?.addEventListener('click', event => {
      const mode = selectedPrivacy();
      if (!['secret','not-secret'].includes(mode)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void connectVdd(mode);
    }, true);

    $('appsList')?.addEventListener('click', event => {
      if (!state.active) return;
      const card = event.target.closest('.app-card');
      if (!card) return;
      const id = card.dataset.appId || '';
      const name = card.querySelector('strong')?.textContent?.trim();
      if (!name || id === 'mrd-admin' || name === 'MRD Admin') return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (id) void launchVddApp(id, name);
      else void launchVddAppByName(name);
    }, true);

    for (const id of ['appsBackBtn','adminBackBtn','surfaceMenuBtn','dockCommandsBtn']) {
      $(id)?.addEventListener('click', event => {
        if (!state.active) return;
        event.preventDefault(); event.stopImmediatePropagation();
        showVddMenu();
      }, true);
    }

    $('commandDesktop')?.addEventListener('click', () => {
      if (state.active) setTimeout(() => showVddSurface('Full Desktop', surfaceSubtitle()), 0);
    });

    for (const id of ['keyboardBtn','dockKeyboardBtn']) {
      $(id)?.addEventListener('click', event => {
        if (!state.active) return;
        event.preventDefault(); event.stopImmediatePropagation();
        toggleVddKeyboard();
      }, true);
    }

    $('dockInputBtn')?.addEventListener('click', event => {
      if (!state.active) return;
      event.preventDefault(); event.stopImmediatePropagation();
      state.inputMode = state.inputMode === 'touch' ? 'pointer' : 'touch';
      localStorage.setItem('mrdInputMode', state.inputMode);
      renderVddInputMode();
      toast(state.inputMode === 'touch' ? 'Direct touch input' : 'Trackpad pointer input');
    }, true);

    document.querySelectorAll('[data-audio-destination]').forEach(button => {
      button.addEventListener('click', () => {
        if (state.active) setTimeout(syncVddAudio, 350);
      });
    });
    for (const id of ['menuAudioBtn','surfaceAudioBtn','appsAudioBtn','adminAudioBtn','dockAudioBtn']) {
      $(id)?.addEventListener('click', () => {
        if (state.active) setTimeout(() => {
          const note = $('audioRoutingNote');
          if (note) note.textContent = 'MRD virtual-display mode uses native Windows audio capture; no RDP audio path is involved.';
        }, 0);
      });
    }

    $('confirmDialog')?.addEventListener('close', () => {
      if (!state.active || $('confirmDialog')?.returnValue !== 'confirm') return;
      if (($('confirmTitle')?.textContent || '').startsWith('Disconnect')) void stopVdd();
    });

    keyboard.addEventListener('input', () => {
      if (!state.active || !keyboard.value) return;
      sendInput({ type:'text', text:keyboard.value });
      keyboard.value = '';
    });
    keyboard.addEventListener('keydown', event => {
      if (!state.active) return;
      const keys = new Set(['Backspace','Tab','Enter','Escape','ArrowLeft','ArrowUp','ArrowRight','ArrowDown','Delete','Home','End','PageUp','PageDown']);
      if (!keys.has(event.key)) return;
      event.preventDefault();
      sendInput({ type:'key', key:event.key });
    });
    keyboard.addEventListener('blur', renderVddKeyboardState);
    keyboard.addEventListener('focus', renderVddKeyboardState);

    frame.addEventListener('contextmenu', event => event.preventDefault());
    frame.addEventListener('pointerdown', onPointerDown);
    frame.addEventListener('pointermove', onPointerMove);
    frame.addEventListener('pointerup', onPointerUp);
    frame.addEventListener('pointercancel', onPointerUp);

    const subtitle = $('surfaceSubtitle');
    if (subtitle) {
      const observer = new MutationObserver(() => {
        if (!state.active || !document.body.classList.contains('mrd-chrome-surface')) return;
        const desired = surfaceSubtitle();
        if (subtitle.textContent !== desired) subtitle.textContent = desired;
      });
      observer.observe(subtitle, { childList:true, characterData:true, subtree:true });
    }
  }

  async function connectVdd(mode) {
    const button = $('connectDesktopBtn');
    const label = button?.querySelector('span');
    const original = label?.textContent || 'Connect';
    if (button) button.disabled = true;
    if (label) label.textContent = mode === 'secret' ? 'Starting private VDD…' : 'Starting VDD…';
    primeVddAudio();

    try {
      const preflight = await fetchJson('/api/secret/status');
      if (!preflight.ready) throw new Error(preflight.error || 'MRD virtual display transport is not ready.');

      if (mode === 'not-secret') await stopPrivacyCurtain();

      const result = await fetchJson('/api/session/prepare', {
        method:'POST', body:JSON.stringify({ privacyMode:mode })
      });

      if (mode === 'secret') {
        await startPrivacyCurtain();
        await delay(250);
      }

      state.active = true;
      state.ready = false;
      state.privacyMode = mode;
      document.body.classList.add('mrd-vdd-active');
      // Compatibility with the existing Chrome surface controller, which uses
      // this class to decide whether to reveal the VDD image instead of RDP.
      document.body.classList.add('mrd-secret-active');
      $('connectView').hidden = true;
      $('sessionView').hidden = false;
      $('desktopFrame').src = 'about:blank';
      frame.hidden = false;
      $('sessionPrivacyLabel').textContent = mode === 'secret' ? 'Secret' : 'Not Secret';
      $('sessionWindowsState').textContent = mode === 'secret' ? 'Privacy curtain' : 'Console visible';
      $('sessionConnectionText').textContent = mode === 'secret' ? 'Starting private virtual display…' : 'Starting virtual display…';
      $('sessionConnectionText').className = '';
      document.body.style.overflow = 'hidden';
      renderVddInputMode();
      showVddMenu();

      await fetchJson('/api/audio', { method:'PUT', body:JSON.stringify({ activeMode:'desktop' }) }).catch(() => null);
      startVddSockets(result.secret || {});
      void syncVddAudio();
    } catch (error) {
      if (mode === 'secret') await stopPrivacyCurtain().catch(() => {});
      try { await fetch('/api/secret/stop', { method:'POST', cache:'no-store' }); } catch {}
      const note = $('privacyNote');
      const foot = $('connectFootnote');
      if (note) note.textContent = error.message;
      if (foot) foot.textContent = error.message.includes('locked')
        ? 'Unlock Windows once, then reconnect. Secret will cover the physical monitors after connection.'
        : 'Virtual-display connection was not started.';
      toast(error.message);
    } finally {
      if (button) button.disabled = false;
      if (label) label.textContent = original;
      if (!state.active) setTimeout(syncPrivacyCopy, 0);
    }
  }

  async function startPrivacyCurtain() {
    const command = `Set-Location 'B:\\Mini-Remote-Desktop'; $script = Join-Path (Get-Location) 'scripts\\privacy-curtain.ps1'; Start-Process powershell.exe -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',$script,'-Mode','Start') -WindowStyle Hidden; $deadline=(Get-Date).AddSeconds(4); while((Get-Date) -lt $deadline -and -not (Test-Path '.\\.runtime\\privacy-curtain.pid')){Start-Sleep -Milliseconds 100}; if(-not (Test-Path '.\\.runtime\\privacy-curtain.pid')){throw 'MRD privacy curtain did not start.'}`;
    const result = await runHostPowerShell(command);
    if (Number(result.exitCode || 0) !== 0) throw new Error(result.stderr || result.stdout || 'MRD privacy curtain did not start.');
  }

  async function stopPrivacyCurtain() {
    const command = `Set-Location 'B:\\Mini-Remote-Desktop'; & '.\\scripts\\privacy-curtain.ps1' -Mode Stop`;
    await runHostPowerShell(command).catch(() => null);
  }

  async function runHostPowerShell(command) {
    const response = await fetch('/api/admin/action', {
      method:'POST', cache:'no-store',
      headers:{ 'Content-Type':'application/json', Accept:'application/json' },
      body:JSON.stringify({ action:`powershell:$ProgressPreference='SilentlyContinue';${command}` })
    });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok || body.executed === false) throw new Error(body.error || body.stderr || 'Host PowerShell command failed.');
    return body;
  }

  function startVddSockets(paths = {}) {
    closeVddSockets();
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const videoPath = paths.videoPath || '/api/secret/video';
    const inputPath = paths.inputPath || '/api/secret/input';

    state.video = new WebSocket(`${scheme}//${location.host}${videoPath}`);
    state.video.binaryType = 'blob';
    state.video.addEventListener('message', event => {
      if (typeof event.data === 'string') {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'error') toast(message.message);
        } catch {}
        return;
      }
      const previous = state.frameUrl;
      const url = URL.createObjectURL(event.data);
      state.frameUrl = url;
      frame.onload = () => { if (previous) URL.revokeObjectURL(previous); };
      frame.src = url;
      if (!state.ready) {
        state.ready = true;
        $('sessionConnectionText').textContent = state.privacyMode === 'secret'
          ? 'Private virtual display connected · commands ready'
          : 'Virtual display connected · commands ready';
        $('sessionConnectionText').className = 'ready';
      }
    });
    state.video.addEventListener('close', () => {
      if (state.active) {
        state.ready = false;
        $('sessionConnectionText').textContent = 'Virtual-display video disconnected';
        $('sessionConnectionText').className = 'error';
        if (state.privacyMode === 'secret') void stopPrivacyCurtain();
      }
    });

    state.input = new WebSocket(`${scheme}//${location.host}${inputPath}`);
    state.input.addEventListener('message', event => {
      if (typeof event.data !== 'string') return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'error') toast(message.message);
      } catch {}
    });
  }

  function surfaceSubtitle() {
    return state.privacyMode === 'secret' ? 'Private MRD virtual display' : 'MRD virtual display · physical monitors visible';
  }

  function showVddMenu() {
    if (!state.active) return;
    closeVddKeyboard();
    $('surfaceToolbar').hidden = true;
    $('surfaceDock').hidden = true;
    $('sessionMenu').hidden = false;
    $('appsMenu').hidden = true;
    $('adminMenu').hidden = true;
  }

  function showVddSurface(title, subtitle=surfaceSubtitle()) {
    if (!state.active) return;
    $('sessionMenu').hidden = true;
    $('appsMenu').hidden = true;
    $('adminMenu').hidden = true;
    $('surfaceTitle').textContent = title;
    $('surfaceSubtitle').textContent = subtitle;
    $('surfaceToolbar').hidden = false;
    $('surfaceDock').hidden = false;
    frame.hidden = false;
  }

  async function launchVddAppByName(name) {
    if (!state.catalog) {
      const result = await fetchJson('/api/apps');
      state.catalog = result.apps || [];
    }
    const item = state.catalog.find(app => app.name === name);
    if (!item) return toast(`${name} is not in the MRD app catalog.`);
    await launchVddApp(item.id, item.name);
  }

  async function launchVddApp(id, name) {
    if (!state.ready) return toast('MRD virtual display is still starting.');
    toast(`Opening ${name}…`);
    try {
      const result = await fetchJson(`/api/apps/${encodeURIComponent(id)}/launch`, { method:'POST' });
      if (result.panel === 'mrd-admin') return;
      setTimeout(() => showVddSurface(name, surfaceSubtitle()), 300);
    } catch (error) {
      toast(error.message);
    }
  }

  function toggleVddKeyboard() {
    if (!state.ready) return toast('MRD virtual display is still starting.');
    if (document.activeElement === keyboard) closeVddKeyboard();
    else {
      keyboard.value = '';
      try { keyboard.focus({ preventScroll:true }); } catch { keyboard.focus(); }
      document.body.classList.add('keyboard-open');
      renderVddKeyboardState();
    }
  }

  function closeVddKeyboard() {
    try { keyboard.blur(); } catch {}
    document.body.classList.remove('keyboard-open');
    renderVddKeyboardState();
  }

  function renderVddKeyboardState() {
    const open = document.activeElement === keyboard;
    $('keyboardBtn')?.setAttribute('aria-pressed', String(open));
    $('dockKeyboardBtn')?.classList.toggle('active', open);
    const small = $('dockKeyboardBtn')?.querySelector('small');
    if (small) small.textContent = open ? 'Close' : 'Keyboard';
  }

  function renderVddInputMode() {
    const touch = state.inputMode === 'touch';
    if ($('dockInputLabel')) $('dockInputLabel').textContent = touch ? 'Touch' : 'Pointer';
    if ($('dockInputIcon')) $('dockInputIcon').textContent = touch ? '◉' : '↖';
    $('dockInputBtn')?.classList.toggle('active', !touch);
    if ($('sessionInputLabel')) $('sessionInputLabel').textContent = touch ? 'Touch' : 'Pointer';
  }

  function pointFromEvent(event) {
    const box = frame.getBoundingClientRect();
    const imageRatio = 440 / 956;
    const boxRatio = box.width / Math.max(1, box.height);
    let width = box.width, height = box.height, left = box.left, top = box.top;
    if (boxRatio > imageRatio) {
      width = box.height * imageRatio;
      left += (box.width - width) / 2;
    } else {
      height = box.width / imageRatio;
      top += (box.height - height) / 2;
    }
    return {
      x: Math.max(0, Math.min(1, (event.clientX - left) / Math.max(1, width))),
      y: Math.max(0, Math.min(1, (event.clientY - top) / Math.max(1, height)))
    };
  }

  function onPointerDown(event) {
    if (!state.active || !state.ready) return;
    event.preventDefault();
    frame.setPointerCapture?.(event.pointerId);
    const p = pointFromEvent(event);

    if (state.inputMode === 'touch') {
      state.pointer = { id:event.pointerId, startX:event.clientX, startY:event.clientY, lastY:event.clientY, moved:false, p };
      return;
    }

    const now = performance.now();
    state.pointers.set(event.pointerId, {
      id:event.pointerId,
      startX:event.clientX, startY:event.clientY,
      lastX:event.clientX, lastY:event.clientY,
      downAt:now
    });
    if (!state.pointerGesture) state.pointerGesture = { startedAt:now, twoFinger:false, moved:false, dragging:false, rightClicked:false, lastCentroid:null };
    if (state.pointers.size >= 2) {
      state.pointerGesture.twoFinger = true;
      state.pointerGesture.lastCentroid = pointerCentroid();
    }
  }

  function onPointerMove(event) {
    if (!state.active || !state.ready) return;
    event.preventDefault();

    if (state.inputMode === 'touch') {
      if (!state.pointer || state.pointer.id !== event.pointerId) return;
      const p = pointFromEvent(event);
      const distance = Math.hypot(event.clientX - state.pointer.startX, event.clientY - state.pointer.startY);
      if (distance > 8) state.pointer.moved = true;
      if (state.pointer.moved) {
        const dy = state.pointer.lastY - event.clientY;
        if (Math.abs(dy) >= 3) sendInput({ type:'wheel', delta:Math.round(dy * 6), ...p });
        state.pointer.lastY = event.clientY;
      }
      return;
    }

    const point = state.pointers.get(event.pointerId);
    if (!point || !state.pointerGesture) return;
    const dx = event.clientX - point.lastX;
    const dy = event.clientY - point.lastY;
    point.lastX = event.clientX;
    point.lastY = event.clientY;

    const total = Math.hypot(event.clientX - point.startX, event.clientY - point.startY);
    if (total > 5) state.pointerGesture.moved = true;

    if (state.pointers.size >= 2 || state.pointerGesture.twoFinger) {
      const centroid = pointerCentroid();
      const previous = state.pointerGesture.lastCentroid || centroid;
      const scrollY = previous.y - centroid.y;
      state.pointerGesture.lastCentroid = centroid;
      if (Math.abs(scrollY) >= 1.5) {
        state.pointerGesture.moved = true;
        sendInput({ type:'relative-wheel', delta:Math.round(scrollY * 14) });
      }
      return;
    }

    const held = performance.now() - state.pointerGesture.startedAt;
    if (!state.pointerGesture.dragging && held > 360 && total > 3) {
      state.pointerGesture.dragging = true;
      sendInput({ type:'button', button:'left', down:true });
    }
    if (Math.abs(dx) >= .35 || Math.abs(dy) >= .35) {
      sendInput({ type:'relative-move', dx:Math.round(dx * 1.55), dy:Math.round(dy * 1.55) });
    }
  }

  function onPointerUp(event) {
    if (!state.active) return;
    event.preventDefault();

    if (state.inputMode === 'touch') {
      if (!state.pointer || state.pointer.id !== event.pointerId) return;
      const p = pointFromEvent(event);
      if (!state.pointer.moved) {
        sendInput({ type:'move', ...p });
        sendInput({ type:'down', button:'left', ...p });
        sendInput({ type:'up', button:'left', ...p });
      }
      state.pointer = null;
      return;
    }

    const gesture = state.pointerGesture;
    const countBefore = state.pointers.size;
    const point = state.pointers.get(event.pointerId);
    if (!gesture || !point) return;

    if (gesture.dragging) {
      sendInput({ type:'button', button:'left', down:false });
      gesture.dragging = false;
    } else if (gesture.twoFinger && !gesture.moved && !gesture.rightClicked && countBefore >= 2) {
      sendInput({ type:'button', button:'right', down:true });
      sendInput({ type:'button', button:'right', down:false });
      gesture.rightClicked = true;
    } else if (!gesture.twoFinger && !gesture.moved) {
      sendInput({ type:'button', button:'left', down:true });
      sendInput({ type:'button', button:'left', down:false });
    }

    state.pointers.delete(event.pointerId);
    if (state.pointers.size === 0) state.pointerGesture = null;
    else state.pointerGesture.lastCentroid = pointerCentroid();
  }

  function pointerCentroid() {
    const points = [...state.pointers.values()];
    if (!points.length) return { x:0, y:0 };
    return {
      x: points.reduce((sum, point) => sum + point.lastX, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.lastY, 0) / points.length
    };
  }

  function sendInput(message) {
    if (state.input?.readyState !== WebSocket.OPEN) return;
    try { state.input.send(JSON.stringify(message)); } catch {}
  }

  async function stopVdd() {
    if (!state.active) return;
    const wasSecret = state.privacyMode === 'secret';
    state.active = false;
    state.ready = false;
    closeVddKeyboard();
    closeVddSockets();
    closeVddAudio();
    frame.hidden = true;
    frame.removeAttribute('src');
    document.body.classList.remove('mrd-vdd-active');
    document.body.classList.remove('mrd-secret-active');
    if (wasSecret) await stopPrivacyCurtain().catch(() => {});
    try { await fetch('/api/secret/stop', { method:'POST', cache:'no-store' }); } catch {}
  }

  function closeVddSockets() {
    for (const socket of [state.video,state.input]) {
      try { socket?.close(1000,'MRD virtual-display session ended'); } catch {}
    }
    state.video = state.input = null;
    if (state.frameUrl) URL.revokeObjectURL(state.frameUrl);
    state.frameUrl = null;
  }

  function primeVddAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!state.audio.context) {
      try { state.audio.context = new AudioContextClass({ latencyHint:'interactive', sampleRate:48000 }); }
      catch { state.audio.context = new AudioContextClass(); }
    }
    if (state.audio.context.state === 'suspended') state.audio.context.resume().catch(() => {});
  }

  async function syncVddAudio() {
    if (!state.active) return closeVddAudio();
    let audio;
    try { audio = await fetchJson('/api/audio'); } catch { return; }
    const wants = ['mobile','both'].includes(audio.desktopMode);
    if (!wants) return closeVddAudio();
    primeVddAudio();
    if (!state.audio.context || (state.audio.socket && [WebSocket.OPEN,WebSocket.CONNECTING].includes(state.audio.socket.readyState))) return;

    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${scheme}//${location.host}/api/audio/stream`);
    state.audio.socket = socket;
    socket.binaryType = 'arraybuffer';
    socket.addEventListener('message', event => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'format') state.audio.format = msg;
        } catch {}
        return;
      }
      queueAudio(event.data);
    });
    socket.addEventListener('close', () => { if (state.audio.socket === socket) state.audio.socket = null; });
  }

  function closeVddAudio() {
    try { state.audio.socket?.close(1000,'Audio route changed'); } catch {}
    state.audio.socket = null;
    state.audio.nextTime = 0;
  }

  function queueAudio(arrayBuffer) {
    const context = state.audio.context;
    if (!context || context.state !== 'running' || !arrayBuffer?.byteLength) return;
    const sampleRate = Number(state.audio.format.sampleRate || 48000);
    const view = new DataView(arrayBuffer);
    const frames = Math.floor(view.byteLength / 4);
    if (!frames) return;
    const buffer = context.createBuffer(2,frames,sampleRate);
    const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
    let offset = 0;
    for (let i=0;i<frames;i++) {
      left[i] = view.getInt16(offset,true) / 32768;
      right[i] = view.getInt16(offset+2,true) / 32768;
      offset += 4;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    const floor = context.currentTime + .045;
    let start = Math.max(floor,state.audio.nextTime || floor);
    if (start - context.currentTime > .35) start = floor;
    source.start(start);
    state.audio.nextTime = start + buffer.duration;
  }

  async function fetchJson(url, options={}) {
    const headers = { Accept:'application/json', ...(options.body ? {'Content-Type':'application/json'} : {}) };
    const response = await fetch(url, { cache:'no-store', ...options, headers });
    let body = {};
    try { body = await response.json(); } catch {}
    if (!response.ok) throw new Error(body.error || `${response.status} ${response.statusText}`);
    return body;
  }

  function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  function toast(text) {
    const target = $('toast');
    if (!target) return;
    target.textContent = text;
    target.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => target.classList.remove('show'), 4200);
  }
})();
