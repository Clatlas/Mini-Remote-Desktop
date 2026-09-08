(() => {
  const $ = id => document.getElementById(id);
  const view = $('browserView');
  if (!view) return;

  const state = {
    socket: null,
    frameUrl: null,
    ready: false,
    active: false,
    targetId: null,
    tabs: [],
    media: null,
    pointer: null,
    controlsTimer: null,
    keyboardOpen: false,
    remoteViewport: { width: 440, height: 956 },
    lastEnterAt: 0
  };

  buildUi();
  bindUi();

  function buildUi() {
    const heading = view.querySelector('.screen-heading');
    if (heading?.querySelector('small')) heading.querySelector('small').textContent = 'PC-powered · mobile viewport';

    const header = view.querySelector('.screen-topbar');
    const audio = $('browserAudioBtn');
    const keyboardButton = document.createElement('button');
    keyboardButton.className = 'round-button keyboard-button browser-keyboard-button';
    keyboardButton.id = 'browserKeyboardBtn';
    keyboardButton.type = 'button';
    keyboardButton.setAttribute('aria-label', 'Open keyboard');
    keyboardButton.setAttribute('aria-pressed', 'false');
    keyboardButton.textContent = '⌨';
    header?.insertBefore(keyboardButton, audio?.nextSibling || null);

    const oldBody = view.querySelector('.browser-preview');
    if (oldBody) {
      oldBody.className = 'browser-engine-shell';
      oldBody.innerHTML = `
        <div class="browser-nav">
          <form id="browserAddressForm" class="browser-address-form">
            <span class="browser-address-icon">⌕</span>
            <input id="browserAddress" type="url" inputmode="url" enterkeyhint="go" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Search or enter address" />
            <button id="browserAddressGo" class="browser-address-go" type="submit">Go</button>
          </form>
        </div>
        <div class="browser-stage" id="browserStage">
          <div class="browser-loading" id="browserLoading"><span class="browser-spinner"></span><strong>Starting Browser Engine</strong><small>Chrome is running privately on Home PC</small></div>
          <img id="browserFrame" alt="MRD PC-powered browser" draggable="false" />
          <div class="browser-media-hud" id="browserMediaHud" hidden>
            <button id="browserMediaExpand"><span id="browserMediaGlyph">▶</span><span><strong id="browserMediaTitle">Media</strong><small id="browserMediaTime">0:00 / 0:00</small></span><span>⌃</span></button>
          </div>
          <div class="browser-media-mode" id="browserMediaMode" hidden>
            <div class="browser-media-top" id="browserMediaTop">
              <button id="browserMediaDone">Done</button>
              <strong id="browserMediaModeTitle">Media</strong>
              <button id="browserMediaFullscreen">⛶</button>
            </div>
            <div class="browser-media-center" id="browserMediaCenter">
              <button data-media-action="skip" data-value="-10">↶<small>10</small></button>
              <button class="media-play" data-media-action="play-pause" id="browserMediaPlay">▶</button>
              <button data-media-action="skip" data-value="10">↷<small>10</small></button>
            </div>
            <div class="browser-media-bottom" id="browserMediaBottom">
              <div class="media-time-row"><span id="browserMediaCurrent">0:00</span><span id="browserMediaDuration">0:00</span></div>
              <input id="browserMediaSeek" type="range" min="0" max="1000" value="0" aria-label="Seek" />
              <div class="media-volume-row">
                <button data-media-action="mute" id="browserMediaMute">◖</button>
                <input id="browserMediaVolume" type="range" min="0" max="100" value="100" aria-label="Media volume" />
                <button id="browserMediaRotate" aria-label="Landscape">↻</button>
              </div>
            </div>
          </div>
        </div>
        <nav class="browser-bottom-bar">
          <button id="browserBottomBack"><span>‹</span><small>Back</small></button>
          <button id="browserBottomForward"><span>›</span><small>Forward</small></button>
          <button id="browserBottomReload"><span>↻</span><small>Reload</small></button>
          <button id="browserBottomTabs"><span>▣</span><small>Tabs</small></button>
          <button id="browserBottomKeyboard"><span>⌨</span><small>Keyboard</small></button>
        </nav>
        <div class="browser-tabs-sheet" id="browserTabsSheet" hidden>
          <div class="browser-tabs-card">
            <header><div><strong>Tabs</strong><small>MRD Browser Engine</small></div><button id="browserTabsClose">×</button></header>
            <div id="browserTabsList"></div>
            <button class="browser-new-tab-wide" id="browserNewTabWide">＋ New tab</button>
          </div>
        </div>
        <textarea id="browserKeyboardTarget" class="browser-keyboard-target" rows="1" enterkeyhint="go" aria-label="Remote browser keyboard" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"></textarea>
      `;
    }

    const style = document.createElement('style');
    style.id = 'mrd-browser-engine-style';
    style.textContent = `
      .browser-layer .screen-topbar{gap:7px}.browser-layer .screen-heading{min-width:0}.browser-keyboard-button{width:42px;height:42px;border-radius:14px;font-size:17px}
      .browser-engine-shell{flex:1;min-height:0;display:flex;flex-direction:column;background:#020304;overflow:hidden}
      .browser-nav{min-height:60px;flex:none;display:flex;align-items:center;padding:7px 10px;border-bottom:1px solid var(--border);background:#0b0f15}
      .browser-address-form{height:46px;width:100%;min-width:0;border:1px solid var(--border);background:#070a0f;border-radius:15px;display:grid;grid-template-columns:22px 1fr 48px;align-items:center;gap:5px;padding:0 5px 0 10px}.browser-address-icon{color:var(--muted);font-size:16px}.browser-address-form input{min-width:0;width:100%;height:42px;border:0;outline:0;background:transparent;color:var(--text);font-size:15px}.browser-address-go{height:36px;border:0;border-radius:11px;background:var(--accent-soft);color:var(--accent-strong);font-size:13px;font-weight:800}
      .browser-stage{position:relative;flex:1;min-height:0;background:#000;overflow:hidden;touch-action:none}.browser-stage>img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;touch-action:none;-webkit-user-select:none;user-select:none}.browser-loading{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;background:#05070a}.browser-loading strong{font-size:14px}.browser-loading small{font-size:11px;color:var(--muted)}.browser-spinner{width:30px;height:30px;border:3px solid rgba(255,255,255,.1);border-top-color:var(--accent);border-radius:50%;animation:mrd-browser-spin .8s linear infinite}@keyframes mrd-browser-spin{to{transform:rotate(360deg)}}
      .browser-bottom-bar{height:calc(62px + env(safe-area-inset-bottom));padding:5px 4px env(safe-area-inset-bottom);display:grid;grid-template-columns:repeat(5,1fr);border-top:1px solid var(--border);background:rgba(7,9,13,.97);flex:none}.browser-bottom-bar button{border:0;background:transparent;border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px}.browser-bottom-bar span{font-size:19px;line-height:1}.browser-bottom-bar small{font-size:9px;color:var(--muted)}
      .browser-tabs-sheet{position:absolute;inset:0;z-index:40;background:rgba(0,0,0,.55);display:flex;align-items:flex-end}.browser-tabs-card{width:100%;max-height:72%;border-radius:24px 24px 0 0;background:var(--surface);border:1px solid var(--border);padding:16px 14px calc(env(safe-area-inset-bottom) + 16px);overflow:auto}.browser-tabs-card header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.browser-tabs-card header strong,.browser-tabs-card header small{display:block}.browser-tabs-card header small{color:var(--muted);font-size:10px;margin-top:2px}.browser-tabs-card header button{width:40px;height:40px;border:0;border-radius:13px;background:var(--surface-2);font-size:20px}.browser-tab-row{display:grid;grid-template-columns:1fr 38px;gap:8px;margin:8px 0}.browser-tab-open{min-width:0;text-align:left;border:1px solid var(--border);background:var(--surface-2);border-radius:15px;padding:11px}.browser-tab-open.active{border-color:rgba(103,162,255,.45);background:var(--accent-soft)}.browser-tab-open strong,.browser-tab-open small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.browser-tab-open strong{font-size:12px}.browser-tab-open small{font-size:9px;color:var(--muted);margin-top:3px}.browser-tab-close{border:0;border-radius:13px;background:var(--surface-2);font-size:18px}.browser-new-tab-wide{width:100%;height:48px;margin-top:10px;border:1px solid rgba(103,162,255,.25);border-radius:15px;background:var(--accent-soft);color:var(--accent-strong);font-weight:700}
      .browser-keyboard-target{position:fixed;left:50%;bottom:calc(66px + env(safe-area-inset-bottom));width:2px;height:2px;opacity:.01;z-index:99;border:0;padding:0;pointer-events:none}
      .browser-media-hud{position:absolute;left:10px;right:10px;bottom:10px;z-index:6}.browser-media-hud>button{width:100%;min-height:58px;border:1px solid rgba(103,162,255,.28);background:rgba(11,15,21,.92);backdrop-filter:blur(14px);border-radius:18px;display:grid;grid-template-columns:38px 1fr 24px;align-items:center;gap:8px;text-align:left;padding:8px 11px}.browser-media-hud strong,.browser-media-hud small{display:block}.browser-media-hud strong{font-size:12px}.browser-media-hud small{font-size:9px;color:var(--muted);margin-top:2px}
      .browser-media-mode{position:absolute;inset:0;z-index:12;background:transparent;display:flex;flex-direction:column;justify-content:space-between;padding:calc(env(safe-area-inset-top) + 12px) 16px calc(env(safe-area-inset-bottom) + 18px);touch-action:manipulation}.browser-media-mode.controls-hidden .browser-media-top,.browser-media-mode.controls-hidden .browser-media-center,.browser-media-mode.controls-hidden .browser-media-bottom{opacity:0;pointer-events:none}.browser-media-top,.browser-media-center,.browser-media-bottom{position:relative;z-index:2;transition:opacity .18s ease}.browser-media-top{display:grid;grid-template-columns:60px 1fr 46px;align-items:center;gap:8px}.browser-media-top strong{text-align:center;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.browser-media-top button{height:42px;border:0;border-radius:13px;background:rgba(255,255,255,.12)}.browser-media-center{display:flex;align-items:center;justify-content:center;gap:30px}.browser-media-center button{width:60px;height:60px;border:0;border-radius:50%;background:rgba(255,255,255,.13);font-size:22px}.browser-media-center button.media-play{width:78px;height:78px;font-size:30px;background:rgba(255,255,255,.2)}.browser-media-center button small{font-size:9px}.browser-media-bottom{background:rgba(12,15,20,.82);border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:13px}.media-time-row{display:flex;justify-content:space-between;font-size:9px;color:#ddd}.browser-media-bottom input[type=range]{width:100%;accent-color:var(--accent)}.media-volume-row{display:grid;grid-template-columns:42px 1fr 42px;align-items:center;gap:8px;margin-top:8px}.media-volume-row button{height:40px;border:0;border-radius:12px;background:rgba(255,255,255,.08)}
      body.mrd-browser-media .screen-topbar,body.mrd-browser-media .browser-nav,body.mrd-browser-media .browser-bottom-bar{display:none!important}body.mrd-browser-media .browser-engine-shell{height:100dvh}.browser-stage.media-expanded>img{z-index:13;object-fit:contain}.browser-stage.media-expanded .browser-media-mode{z-index:14}
      .dashboard-gpu-tooltip{font-size:9px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    `;
    document.head.appendChild(style);
  }

  function bindUi() {
    $('browserBtn')?.addEventListener('click', () => setTimeout(openBrowserEngine, 0));
    $('commandBrowser')?.addEventListener('click', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      void openBrowserEngine();
    }, true);

    view.querySelector('[data-close-view="browser"]')?.addEventListener('click', () => setTimeout(closeBrowserEngine, 0));
    $('browserBottomBack')?.addEventListener('click', () => send({ type:'back' }));
    $('browserBottomForward')?.addEventListener('click', () => send({ type:'forward' }));
    $('browserBottomReload')?.addEventListener('click', () => send({ type:'reload' }));
    $('browserNewTabWide')?.addEventListener('click', () => { send({ type:'new-tab' }); hideTabs(); });
    $('browserBottomTabs')?.addEventListener('click', showTabs);
    $('browserTabsClose')?.addEventListener('click', hideTabs);

    $('browserAddressForm')?.addEventListener('submit', event => {
      event.preventDefault();
      send({ type:'navigate', value:$('browserAddress')?.value || '' });
      $('browserAddress')?.blur();
    });

    $('browserKeyboardBtn')?.addEventListener('click', toggleKeyboard);
    $('browserBottomKeyboard')?.addEventListener('click', toggleKeyboard);

    const keyboard = $('browserKeyboardTarget');
    const sendRemoteEnter = () => {
      const now = Date.now();
      if (now - state.lastEnterAt < 120) return;
      state.lastEnterAt = now;
      send({ type:'key', key:'Enter' });
    };
    keyboard?.addEventListener('beforeinput', event => {
      if (!['insertLineBreak','insertParagraph'].includes(event.inputType)) return;
      event.preventDefault();
      sendRemoteEnter();
    });
    keyboard?.addEventListener('input', () => {
      if (!keyboard.value) return;
      const hasEnter = /[\r\n]/.test(keyboard.value);
      const text = keyboard.value.replace(/[\r\n]+/g, '');
      if (text) send({ type:'text', text });
      keyboard.value = '';
      if (hasEnter) sendRemoteEnter();
    });
    keyboard?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        sendRemoteEnter();
        return;
      }
      const special = new Set(['Backspace','Tab','Escape','ArrowLeft','ArrowUp','ArrowRight','ArrowDown','Delete','Home','End','PageUp','PageDown']);
      if (!special.has(event.key)) return;
      event.preventDefault();
      send({ type:'key', key:event.key });
    });
    keyboard?.addEventListener('focus', renderKeyboard);
    keyboard?.addEventListener('blur', renderKeyboard);

    const frame = $('browserFrame');
    frame?.addEventListener('contextmenu', event => event.preventDefault());
    frame?.addEventListener('pointerdown', pointerDown);
    frame?.addEventListener('pointermove', pointerMove);
    frame?.addEventListener('pointerup', pointerUp);
    frame?.addEventListener('pointercancel', pointerUp);

    $('browserMediaExpand')?.addEventListener('click', openMediaMode);
    $('browserMediaDone')?.addEventListener('click', closeMediaMode);
    $('browserMediaFullscreen')?.addEventListener('click', requestMediaFullscreen);
    $('browserMediaRotate')?.addEventListener('click', requestLandscape);
    $('browserMediaMode')?.addEventListener('click', event => {
      if (event.target.closest('button,input')) return;
      toggleMediaControls();
    });
    document.querySelectorAll('[data-media-action]').forEach(button => button.addEventListener('click', () => {
      send({ type:'media-action', action:button.dataset.mediaAction, value:Number(button.dataset.value || 0) });
    }));
    $('browserMediaSeek')?.addEventListener('change', event => {
      const duration = Number(state.media?.duration || 0);
      if (duration > 0) send({ type:'media-action', action:'seek', value:(Number(event.target.value) / 1000) * duration });
    });
    $('browserMediaVolume')?.addEventListener('input', event => send({ type:'media-action', action:'volume', value:Number(event.target.value) / 100 }));

    window.addEventListener('orientationchange', () => setTimeout(syncViewport, 250));
    window.visualViewport?.addEventListener('resize', () => {
      if (state.active) clearTimeout(syncViewport.timer), syncViewport.timer = setTimeout(syncViewport, 180);
    }, { passive:true });
  }

  async function openBrowserEngine() {
    if (state.active) {
      view.hidden = false;
      return;
    }
    state.active = true;
    view.hidden = false;
    $('browserLoading').hidden = false;
    document.body.style.overflow = 'hidden';
    try {
      await fetchJson('/api/audio', { method:'PUT', body:JSON.stringify({ activeMode:'browser' }) });
      const result = await fetchJson('/api/browser/session', { method:'POST' });
      if (!result.ok) throw new Error(result.error || 'Browser Engine could not start.');
      connectSocket(result.streamPath || '/api/browser/stream');
    } catch (error) {
      state.active = false;
      $('browserLoading').innerHTML = `<strong>Browser Engine unavailable</strong><small>${escapeHtml(error.message)}</small>`;
      toast(error.message);
    }
  }

  function connectSocket(path) {
    closeSocket();
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${scheme}//${location.host}${path}`);
    state.socket = socket;
    socket.binaryType = 'blob';
    socket.addEventListener('open', syncViewport);
    socket.addEventListener('message', event => {
      if (typeof event.data === 'string') return handleTextMessage(event.data);
      const previous = state.frameUrl;
      const url = URL.createObjectURL(event.data);
      state.frameUrl = url;
      const frame = $('browserFrame');
      frame.onload = () => { if (previous) URL.revokeObjectURL(previous); };
      frame.src = url;
      state.ready = true;
      $('browserLoading').hidden = true;
    });
    socket.addEventListener('close', () => {
      if (!state.active) return;
      state.ready = false;
      $('browserLoading').hidden = false;
      $('browserLoading').innerHTML = '<span class="browser-spinner"></span><strong>Reconnecting Browser Engine</strong><small>Waiting for Home PC</small>';
      setTimeout(() => { if (state.active) connectSocket(path); }, 1200);
    });
    socket.addEventListener('error', () => {});
  }

  function handleTextMessage(text) {
    let message;
    try { message = JSON.parse(text); } catch { return; }
    if (message.type === 'error') return toast(message.message || 'Browser Engine error');
    if (message.type === 'hello' || message.type === 'state') return renderState(message.state || {});
    if (message.type === 'media') return renderMedia(message.media || null);
  }

  function renderState(next) {
    state.targetId = next.activeTargetId || null;
    state.tabs = next.tabs || [];
    if (next.status?.viewport?.width && next.status?.viewport?.height) state.remoteViewport = next.status.viewport;
    if (next.active?.url && document.activeElement !== $('browserAddress')) $('browserAddress').value = displayAddress(next.active.url);
    const heading = view.querySelector('.screen-heading strong');
    if (heading) heading.textContent = next.active?.title || 'Browser Engine';
    const tabLabel = $('browserBottomTabs')?.querySelector('small');
    if (tabLabel) tabLabel.textContent = `Tabs · ${Math.max(1, state.tabs.length)}`;
    renderTabs();
    renderMedia(next.media || state.media);
  }

  function renderTabs() {
    const list = $('browserTabsList');
    if (!list) return;
    list.innerHTML = '';
    for (const tab of state.tabs) {
      const row = document.createElement('div');
      row.className = 'browser-tab-row';
      row.innerHTML = `<button class="browser-tab-open ${tab.id === state.targetId ? 'active' : ''}"><strong>${escapeHtml(tab.title || 'New Tab')}</strong><small>${escapeHtml(displayAddress(tab.url || ''))}</small></button><button class="browser-tab-close" aria-label="Close tab">×</button>`;
      row.querySelector('.browser-tab-open').addEventListener('click', () => { send({ type:'switch-tab', targetId:tab.id }); hideTabs(); });
      row.querySelector('.browser-tab-close').addEventListener('click', () => send({ type:'close-tab', targetId:tab.id }));
      list.appendChild(row);
    }
  }

  function showTabs() { renderTabs(); $('browserTabsSheet').hidden = false; }
  function hideTabs() { $('browserTabsSheet').hidden = true; }

  function renderMedia(media) {
    state.media = media || { hasMedia:false };
    const has = Boolean(state.media.hasMedia);
    $('browserMediaHud').hidden = !has;
    if (!has) {
      if (!$('browserMediaMode').hidden) closeMediaMode();
      return;
    }
    const current = Number(state.media.currentTime || 0);
    const duration = Number(state.media.duration || 0);
    const title = state.media.title || 'Media';
    $('browserMediaTitle').textContent = title;
    $('browserMediaModeTitle').textContent = title;
    $('browserMediaTime').textContent = `${formatTime(current)} / ${formatTime(duration)}`;
    $('browserMediaCurrent').textContent = formatTime(current);
    $('browserMediaDuration').textContent = formatTime(duration);
    $('browserMediaGlyph').textContent = state.media.playing ? '❚❚' : '▶';
    $('browserMediaPlay').textContent = state.media.playing ? '❚❚' : '▶';
    $('browserMediaMute').textContent = state.media.muted ? '⊘' : '◖';
    $('browserMediaSeek').value = duration > 0 ? String(Math.round((current / duration) * 1000)) : '0';
    $('browserMediaVolume').value = String(Math.round(Number(state.media.volume ?? 1) * 100));

  }

  function openMediaMode() {
    if (!state.media?.hasMedia) return;
    $('browserMediaMode').hidden = false;
    $('browserStage').classList.add('media-expanded');
    document.body.classList.add('mrd-browser-media');
    showMediaControlsTemporarily();
  }

  function closeMediaMode() {
    $('browserMediaMode').hidden = true;
    $('browserStage').classList.remove('media-expanded');
    document.body.classList.remove('mrd-browser-media');
    clearTimeout(state.controlsTimer);
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch {}
    try { screen.orientation?.unlock?.(); } catch {}
    setTimeout(syncViewport, 100);
  }

  function toggleMediaControls() {
    const mode = $('browserMediaMode');
    mode.classList.toggle('controls-hidden');
    if (!mode.classList.contains('controls-hidden')) showMediaControlsTemporarily();
  }

  function showMediaControlsTemporarily() {
    const mode = $('browserMediaMode');
    mode.classList.remove('controls-hidden');
    clearTimeout(state.controlsTimer);
    state.controlsTimer = setTimeout(() => mode.classList.add('controls-hidden'), 2800);
  }

  async function requestLandscape() {
    try { await screen.orientation?.lock?.('landscape'); } catch { toast('Rotate the iPhone for landscape Media Mode.'); }
    setTimeout(syncViewport, 300);
  }

  async function requestMediaFullscreen() {
    const stage = $('browserStage');
    try { if (stage?.requestFullscreen && !document.fullscreenElement) await stage.requestFullscreen(); } catch {}
  }

  function toggleKeyboard() {
    const target = $('browserKeyboardTarget');
    if (!state.ready || !target) return toast('Browser is still connecting.');
    if (document.activeElement === target) target.blur();
    else {
      target.value = '';
      try { target.focus({ preventScroll:true }); } catch { target.focus(); }
    }
    renderKeyboard();
  }

  function renderKeyboard() {
    const open = document.activeElement === $('browserKeyboardTarget');
    state.keyboardOpen = open;
    $('browserKeyboardBtn')?.setAttribute('aria-pressed', String(open));
    $('browserBottomKeyboard')?.classList.toggle('active', open);
  }

  function pointerDown(event) {
    if (!state.ready) return;
    event.preventDefault();
    const frame = $('browserFrame');
    frame.setPointerCapture?.(event.pointerId);
    const p = point(event);
    state.pointer = { id:event.pointerId, startX:event.clientX, startY:event.clientY, lastX:event.clientX, lastY:event.clientY, moved:false, start:p };
  }

  function pointerMove(event) {
    if (!state.ready || !state.pointer || state.pointer.id !== event.pointerId) return;
    event.preventDefault();
    const distance = Math.hypot(event.clientX - state.pointer.startX, event.clientY - state.pointer.startY);
    if (distance > 7) state.pointer.moved = true;
    if (!state.pointer.moved) return;
    const p = point(event);
    const deltaX = (state.pointer.lastX - event.clientX) * 1.35;
    const deltaY = (state.pointer.lastY - event.clientY) * 1.35;
    state.pointer.lastX = event.clientX;
    state.pointer.lastY = event.clientY;
    if (Math.abs(deltaX) >= 0.75 || Math.abs(deltaY) >= 0.75) send({ type:'wheel', deltaX:Math.round(deltaX), deltaY:Math.round(deltaY), ...p });
  }

  function pointerUp(event) {
    if (!state.pointer || state.pointer.id !== event.pointerId) return;
    event.preventDefault();
    const p = point(event);
    if (!state.pointer.moved) {
      send({ type:'mouse', event:'mouseMoved', button:'none', ...p });
      send({ type:'mouse', event:'mousePressed', button:'left', ...p });
      send({ type:'mouse', event:'mouseReleased', button:'left', ...p });
    }
    state.pointer = null;
  }

  function point(event) {
    const frame = $('browserFrame');
    const box = frame.getBoundingClientRect();
    const naturalWidth = frame.naturalWidth || Number(state.remoteViewport?.width) || 440;
    const naturalHeight = frame.naturalHeight || Number(state.remoteViewport?.height) || 956;
    const imageRatio = naturalWidth / Math.max(1, naturalHeight);
    const boxRatio = box.width / Math.max(1, box.height);
    let width = box.width, height = box.height, left = box.left, top = box.top;
    if (boxRatio > imageRatio) { width = box.height * imageRatio; left += (box.width - width) / 2; }
    else { height = box.width / imageRatio; top += (box.height - height) / 2; }
    return { x: clamp((event.clientX - left) / Math.max(1, width), 0, 1), y: clamp((event.clientY - top) / Math.max(1, height), 0, 1) };
  }

  function syncViewport() {
    if (!state.active || state.socket?.readyState !== WebSocket.OPEN) return;
    const viewport = currentViewport();
    send({ type:'viewport', width:viewport.width, height:viewport.height, deviceScaleFactor:Math.min(3, window.devicePixelRatio || 3) });
  }

  function currentViewport() {
    const rect = $('browserStage')?.getBoundingClientRect();
    const width = Math.round(Math.max(320, Math.min(956, rect?.width || 440)));
    const height = Math.round(Math.max(320, Math.min(956, rect?.height || 956)));
    return { width, height };
  }

  function send(value) {
    if (state.socket?.readyState !== WebSocket.OPEN) return;
    try { state.socket.send(JSON.stringify(value)); } catch {}
  }

  async function closeBrowserEngine() {
    if (!state.active) return;
    state.active = false;
    state.ready = false;
    closeMediaMode();
    closeSocket();
    $('browserKeyboardTarget')?.blur();
    try { await fetch('/api/browser/stop', { method:'POST', cache:'no-store' }); } catch {}
    const desktopActive = !$('sessionView')?.hidden;
    try {
      await fetchJson('/api/audio', { method:'PUT', body:JSON.stringify({ activeMode:desktopActive ? 'desktop' : 'none' }) });
    } catch {}
  }

  function closeSocket() {
    try { state.socket?.close(1000, 'Browser closed'); } catch {}
    state.socket = null;
    if (state.frameUrl) URL.revokeObjectURL(state.frameUrl);
    state.frameUrl = null;
    const frame = $('browserFrame');
    if (frame) frame.removeAttribute('src');
  }

  async function fetchJson(url, options={}) {
    const response = await fetch(url, {
      cache:'no-store', ...options,
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
    toast.timer = setTimeout(() => node.classList.remove('show'), 3600);
  }

  function displayAddress(url) {
    return String(url || '').replace(/^https?:\/\//i, '').replace(/\/$/, '');
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
})();
