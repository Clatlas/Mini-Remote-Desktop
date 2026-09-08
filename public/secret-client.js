(() => {
  const state = {
    active: false,
    ready: false,
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
  frame.alt = 'MRD Secret virtual display';
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
    body.mrd-secret-active #desktopFrame{display:none!important}
    body.mrd-secret-active .surface-title small::after{content:' · Secret';color:var(--accent)}
  `;
  document.head.appendChild(style);

  bindSecretUi();

  function selectedPrivacy() {
    return document.querySelector('[data-privacy-mode].selected')?.dataset.privacyMode || 'not-secret';
  }

  function bindSecretUi() {
    $('connectDesktopBtn')?.addEventListener('click', event => {
      if (selectedPrivacy() !== 'secret') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void connectSecret();
    }, true);

    $('appsList')?.addEventListener('click', event => {
      if (!state.active) return;
      const card = event.target.closest('.app-card');
      if (!card) return;
      const id = card.dataset.appId || '';
      const name = card.querySelector('strong')?.textContent?.trim();
      if (!name || id === 'mrd-admin' || name === 'MRD Admin') return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (id) void launchSecretApp(id, name);
      else void launchSecretAppByName(name);
    }, true);

    for (const id of ['appsBackBtn','adminBackBtn','surfaceMenuBtn','dockCommandsBtn']) {
      $(id)?.addEventListener('click', event => {
        if (!state.active) return;
        event.preventDefault(); event.stopImmediatePropagation();
        showSecretMenu();
      }, true);
    }

    $('commandDesktop')?.addEventListener('click', () => {
      if (state.active) setTimeout(() => showSecretSurface('Full Desktop','Secret virtual display'), 0);
    });

    for (const id of ['keyboardBtn','dockKeyboardBtn']) {
      $(id)?.addEventListener('click', event => {
        if (!state.active) return;
        event.preventDefault(); event.stopImmediatePropagation();
        toggleSecretKeyboard();
      }, true);
    }

    $('dockInputBtn')?.addEventListener('click', event => {
      if (!state.active) return;
      event.preventDefault(); event.stopImmediatePropagation();
      state.inputMode = state.inputMode === 'touch' ? 'pointer' : 'touch';
      localStorage.setItem('mrdInputMode', state.inputMode);
      renderSecretInputMode();
      toast(state.inputMode === 'touch' ? 'Direct touch input' : 'Trackpad pointer input');
    }, true);

    document.querySelectorAll('[data-audio-destination]').forEach(button => {
      button.addEventListener('click', () => {
        if (state.active) setTimeout(syncSecretAudio, 350);
      });
    });
    for (const id of ['menuAudioBtn','surfaceAudioBtn','appsAudioBtn','adminAudioBtn','dockAudioBtn']) {
      $(id)?.addEventListener('click', () => {
        if (state.active) setTimeout(() => {
          const note = $('audioRoutingNote');
          if (note) note.textContent = 'Secret mode uses MRD native Windows audio capture; no RDP audio path is involved.';
        }, 0);
      });
    }

    $('confirmDialog')?.addEventListener('close', () => {
      if (!state.active || $('confirmDialog')?.returnValue !== 'confirm') return;
      if (($('confirmTitle')?.textContent || '').startsWith('Disconnect')) void stopSecret();
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
    keyboard.addEventListener('blur', renderSecretKeyboardState);
    keyboard.addEventListener('focus', renderSecretKeyboardState);

    frame.addEventListener('contextmenu', event => event.preventDefault());
    frame.addEventListener('pointerdown', onPointerDown);
    frame.addEventListener('pointermove', onPointerMove);
    frame.addEventListener('pointerup', onPointerUp);
    frame.addEventListener('pointercancel', onPointerUp);
  }

  async function connectSecret() {
    const button = $('connectDesktopBtn');
    const label = button?.querySelector('span');
    const original = label?.textContent || 'Connect';
    if (button) button.disabled = true;
    if (label) label.textContent = 'Starting Secret…';
    primeSecretAudio();

    try {
      const result = await fetchJson('/api/session/prepare', {
        method:'POST', body:JSON.stringify({ privacyMode:'secret' })
      });
      if (result.transport !== 'secret') throw new Error('MRD did not return the Secret transport.');

      state.active = true;
      state.ready = false;
      document.body.classList.add('mrd-secret-active');
      $('connectView').hidden = true;
      $('sessionView').hidden = false;
      $('desktopFrame').src = 'about:blank';
      frame.hidden = false;
      $('sessionPrivacyLabel').textContent = 'Secret';
      $('sessionWindowsState').textContent = 'Console active';
      $('sessionConnectionText').textContent = 'Starting Secret virtual workspace…';
      $('sessionConnectionText').className = '';
      document.body.style.overflow = 'hidden';
      renderSecretInputMode();
      showSecretMenu();

      await fetchJson('/api/audio', { method:'PUT', body:JSON.stringify({ activeMode:'desktop' }) }).catch(() => null);
      startSecretSockets(result.secret || {});
      void syncSecretAudio();
    } catch (error) {
      const note = $('privacyNote');
      const foot = $('connectFootnote');
      if (note) note.textContent = error.message;
      if (foot) foot.textContent = 'Run scripts/setup-secret-transport.ps1 once as Administrator, then restart MRD.';
      toast(error.message);
    } finally {
      if (button) button.disabled = false;
      if (label) label.textContent = original;
    }
  }

  function startSecretSockets(secret) {
    closeSecretSockets();
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const videoPath = secret.videoPath || '/api/secret/video';
    const inputPath = secret.inputPath || '/api/secret/input';

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
        $('sessionConnectionText').textContent = 'Secret workspace connected · commands ready';
        $('sessionConnectionText').className = 'ready';
      }
    });
    state.video.addEventListener('close', () => {
      if (state.active) {
        state.ready = false;
        $('sessionConnectionText').textContent = 'Secret video disconnected';
        $('sessionConnectionText').className = 'error';
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

  function showSecretMenu() {
    if (!state.active) return;
    closeSecretKeyboard();
    $('surfaceToolbar').hidden = true;
    $('surfaceDock').hidden = true;
    $('sessionMenu').hidden = false;
    $('appsMenu').hidden = true;
    $('adminMenu').hidden = true;
  }

  function showSecretSurface(title, subtitle='Secret virtual display') {
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

  async function launchSecretAppByName(name) {
    if (!state.catalog) {
      const result = await fetchJson('/api/apps');
      state.catalog = result.apps || [];
    }
    const item = state.catalog.find(app => app.name === name);
    if (!item) return toast(`${name} is not in the MRD app catalog.`);
    await launchSecretApp(item.id, item.name);
  }

  async function launchSecretApp(id, name) {
    if (!state.ready) return toast('Secret workspace is still starting.');
    toast(`Opening ${name}…`);
    try {
      const result = await fetchJson(`/api/apps/${encodeURIComponent(id)}/launch`, { method:'POST' });
      if (result.panel === 'mrd-admin') return;
      setTimeout(() => showSecretSurface(name, 'Secret virtual display'), 300);
    } catch (error) {
      toast(error.message);
    }
  }

  function toggleSecretKeyboard() {
    if (!state.ready) return toast('Secret workspace is still starting.');
    if (document.activeElement === keyboard) closeSecretKeyboard();
    else {
      keyboard.value = '';
      try { keyboard.focus({ preventScroll:true }); } catch { keyboard.focus(); }
      document.body.classList.add('keyboard-open');
      renderSecretKeyboardState();
    }
  }

  function closeSecretKeyboard() {
    try { keyboard.blur(); } catch {}
    document.body.classList.remove('keyboard-open');
    renderSecretKeyboardState();
  }

  function renderSecretKeyboardState() {
    const open = document.activeElement === keyboard;
    $('keyboardBtn')?.setAttribute('aria-pressed', String(open));
    $('dockKeyboardBtn')?.classList.toggle('active', open);
    const small = $('dockKeyboardBtn')?.querySelector('small');
    if (small) small.textContent = open ? 'Close' : 'Keyboard';
  }

  function renderSecretInputMode() {
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

  async function stopSecret() {
    if (!state.active) return;
    state.active = false;
    state.ready = false;
    closeSecretKeyboard();
    closeSecretSockets();
    closeSecretAudio();
    frame.hidden = true;
    frame.removeAttribute('src');
    document.body.classList.remove('mrd-secret-active');
    try { await fetch('/api/secret/stop', { method:'POST', cache:'no-store' }); } catch {}
  }

  function closeSecretSockets() {
    for (const socket of [state.video,state.input]) {
      try { socket?.close(1000,'Secret session ended'); } catch {}
    }
    state.video = state.input = null;
    if (state.frameUrl) URL.revokeObjectURL(state.frameUrl);
    state.frameUrl = null;
  }

  function primeSecretAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!state.audio.context) {
      try { state.audio.context = new AudioContextClass({ latencyHint:'interactive', sampleRate:48000 }); }
      catch { state.audio.context = new AudioContextClass(); }
    }
    if (state.audio.context.state === 'suspended') state.audio.context.resume().catch(() => {});
  }

  async function syncSecretAudio() {
    if (!state.active) return closeSecretAudio();
    let audio;
    try { audio = await fetchJson('/api/audio'); } catch { return; }
    const wants = ['mobile','both'].includes(audio.desktopMode);
    if (!wants) return closeSecretAudio();
    primeSecretAudio();
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

  function closeSecretAudio() {
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

  function toast(text) {
    const target = $('toast');
    if (!target) return;
    target.textContent = text;
    target.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => target.classList.remove('show'), 4200);
  }
})();
