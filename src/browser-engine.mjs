import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';

const DEFAULT_WIDTH = Number(process.env.MRD_BROWSER_WIDTH || 440);
const DEFAULT_HEIGHT = Number(process.env.MRD_BROWSER_HEIGHT || 956);
const DEFAULT_DPR = Number(process.env.MRD_BROWSER_DPR || 3);
const DEBUG_PORT = Number(process.env.MRD_BROWSER_DEBUG_PORT || 9223);
const SCREENCAST_QUALITY = Number(process.env.MRD_BROWSER_QUALITY || 72);
const GOOGLE = 'https://www.google.com/';

export class BrowserEngine {
  constructor(root) {
    this.root = root;
    this.runtimeDir = path.join(root, '.runtime', 'browser-engine');
    this.profileDir = path.join(this.runtimeDir, 'profile');
    this.chromePath = null;
    this.chrome = null;
    this.debugPort = DEBUG_PORT;
    this.activeTargetId = null;
    this.activeTarget = null;
    this.cdp = null;
    this.lastError = null;
    this.startedAt = null;
    this.viewport = { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, deviceScaleFactor: DEFAULT_DPR };
    this.lastMedia = emptyMedia();
    this.mediaTimer = null;

    this.wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
    this.wss.on('connection', ws => this.onClient(ws));
  }

  get status() {
    return {
      ready: Boolean(this.chromePath && this.cdp && this.activeTargetId),
      phase: this.chromePath ? (this.cdp ? 'ready' : 'starting') : 'chrome-required',
      chromeAvailable: Boolean(this.chromePath),
      chromePath: this.chromePath,
      running: Boolean(this.chrome),
      debugPort: this.debugPort,
      activeTargetId: this.activeTargetId,
      viewport: { ...this.viewport },
      clients: this.wss.clients.size,
      startedAt: this.startedAt,
      lastError: this.lastError
    };
  }

  async refreshStatus() {
    if (process.platform !== 'win32') {
      this.lastError = 'Browser Engine is available only on the Windows host.';
      return this.status;
    }
    this.chromePath = this.chromePath || findChrome();
    if (!this.chromePath) this.lastError = 'Google Chrome was not found on this PC.';
    return this.status;
  }

  async start() {
    await this.refreshStatus();
    if (!this.chromePath) throw new Error(this.lastError || 'Google Chrome is required for Browser Engine.');
    await fs.mkdir(this.profileDir, { recursive: true });

    if (!(await this.devtoolsReachable())) {
      await this.launchChrome();
      await this.waitForDevtools();
    }

    const tabs = await this.listTargets();
    let target = tabs.find(item => item.id === this.activeTargetId) || tabs.find(item => item.type === 'page');
    if (!target) target = await this.createTarget(GOOGLE);
    await this.attachTarget(target.id);
    this.startedAt ||= Date.now();
    this.startMediaPoll();
    return this.status;
  }

  async stop({ closeChrome = false } = {}) {
    this.stopMediaPoll();
    await this.detachTarget();
    this.activeTargetId = null;
    this.activeTarget = null;
    this.startedAt = null;
    this.lastMedia = emptyMedia();
    if (closeChrome && this.chrome) {
      const child = this.chrome;
      this.chrome = null;
      try { child.kill(); } catch {}
    }
    return this.status;
  }

  async shutdown() {
    for (const ws of this.wss.clients) {
      try { ws.close(1001, 'MRD shutting down'); } catch {}
    }
    await this.stop({ closeChrome: true });
  }

  handleUpgrade(req, socket, head) {
    this.wss.handleUpgrade(req, socket, head, ws => this.wss.emit('connection', ws, req));
  }

  async onClient(ws) {
    try {
      await this.start();
      ws.send(JSON.stringify({ type: 'hello', state: await this.stateSnapshot() }));
      ws.on('message', data => this.handleClientMessage(ws, data));
      ws.on('close', () => {
        if (this.wss.clients.size <= 1) setTimeout(() => {
          if (this.wss.clients.size === 0) this.stopMediaPoll();
        }, 1500).unref();
      });
    } catch (error) {
      this.lastError = error.message;
      try { ws.send(JSON.stringify({ type: 'error', message: error.message })); } catch {}
      try { ws.close(1011, 'Browser Engine unavailable'); } catch {}
    }
  }

  async handleClientMessage(ws, data) {
    let message;
    try { message = JSON.parse(data.toString('utf8')); } catch { return; }
    if (!message || typeof message !== 'object') return;

    try {
      switch (message.type) {
        case 'navigate':
          await this.navigate(message.value);
          break;
        case 'back':
          await this.goHistory(-1);
          break;
        case 'forward':
          await this.goHistory(1);
          break;
        case 'reload':
          await this.cdp?.send('Page.reload', { ignoreCache: false });
          break;
        case 'new-tab': {
          const target = await this.createTarget(normalizeAddress(message.value || GOOGLE));
          await this.attachTarget(target.id);
          break;
        }
        case 'switch-tab':
          await this.attachTarget(String(message.targetId || ''));
          break;
        case 'close-tab':
          await this.closeTarget(String(message.targetId || this.activeTargetId || ''));
          break;
        case 'viewport':
          await this.setViewport(message.width, message.height, message.deviceScaleFactor);
          break;
        case 'touch-start':
          await this.dispatchTouch('touchStart', message);
          break;
        case 'touch-move':
          await this.dispatchTouch('touchMove', message);
          break;
        case 'touch-end':
          await this.cdp?.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          break;
        case 'mouse':
          await this.dispatchMouse(message);
          break;
        case 'wheel':
          await this.dispatchWheel(message);
          break;
        case 'text':
          await this.cdp?.send('Input.insertText', { text: String(message.text || '').slice(0, 2048) });
          break;
        case 'key':
          await this.dispatchKey(String(message.key || ''));
          break;
        case 'media-action':
          await this.mediaAction(message);
          break;
        case 'media-state':
          await this.pushMediaState();
          break;
        default:
          return;
      }
      if (ws.readyState === WebSocket.OPEN && message.requestId) {
        ws.send(JSON.stringify({ type: 'ack', requestId: message.requestId }));
      }
    } catch (error) {
      this.lastError = error.message;
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'error', message: error.message, requestId: message.requestId || null }));
    }
  }

  async launchChrome() {
    const args = [
      `--remote-debugging-port=${this.debugPort}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${this.profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--autoplay-policy=no-user-gesture-required',
      `--window-size=${DEFAULT_WIDTH},${DEFAULT_HEIGHT}`,
      GOOGLE
    ];
    if (String(process.env.MRD_BROWSER_HEADLESS || 'true').toLowerCase() !== 'false') args.unshift('--headless=new');

    const child = spawn(this.chromePath, args, {
      cwd: this.root,
      windowsHide: true,
      detached: false,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    this.chrome = child;
    child.stderr.on('data', chunk => {
      const text = chunk.toString('utf8').trim();
      if (text && !/DevTools listening on/i.test(text)) console.error('[MRD browser]', text);
    });
    child.on('error', error => {
      this.lastError = error.message;
      if (this.chrome === child) this.chrome = null;
    });
    child.on('exit', code => {
      if (this.chrome === child) this.chrome = null;
      if (code && code !== 0) this.lastError = `Chrome Browser Engine exited with code ${code}`;
    });
  }

  async waitForDevtools() {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await this.devtoolsReachable()) return;
      await delay(250);
    }
    throw new Error('Chrome Browser Engine did not open its local DevTools endpoint.');
  }

  async devtoolsReachable() {
    try {
      const value = await httpJson(this.debugPort, '/json/version');
      return Boolean(value?.webSocketDebuggerUrl);
    } catch {
      return false;
    }
  }

  async listTargets() {
    const list = await httpJson(this.debugPort, '/json/list');
    return Array.isArray(list) ? list.filter(item => item.type === 'page') : [];
  }

  async createTarget(url) {
    const encoded = encodeURIComponent(normalizeAddress(url));
    return httpJson(this.debugPort, `/json/new?${encoded}`, 'PUT');
  }

  async closeTarget(targetId) {
    if (!targetId) return;
    try { await httpJson(this.debugPort, `/json/close/${encodeURIComponent(targetId)}`); } catch {}
    if (targetId === this.activeTargetId) {
      await this.detachTarget();
      const remaining = await this.listTargets();
      const next = remaining[0] || await this.createTarget(GOOGLE);
      await this.attachTarget(next.id);
    } else {
      await this.broadcastState();
    }
  }

  async attachTarget(targetId) {
    if (!targetId) throw new Error('Browser tab target is missing.');
    const targets = await this.listTargets();
    const target = targets.find(item => item.id === targetId);
    if (!target?.webSocketDebuggerUrl) throw new Error('Browser tab is no longer available.');
    if (this.activeTargetId === target.id && this.cdp?.open) {
      await this.broadcastState();
      return;
    }

    await this.detachTarget();
    const cdp = new CdpConnection(target.webSocketDebuggerUrl);
    await cdp.openConnection();
    this.cdp = cdp;
    this.activeTargetId = target.id;
    this.activeTarget = target;

    cdp.on('Page.screencastFrame', event => this.onScreencastFrame(event));
    cdp.on('Page.frameNavigated', () => this.scheduleStateBroadcast());
    cdp.on('Page.loadEventFired', () => this.scheduleStateBroadcast());
    cdp.on('Runtime.consoleAPICalled', () => {});
    cdp.on('close', () => {
      if (this.cdp === cdp) {
        this.cdp = null;
        this.activeTargetId = null;
      }
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await this.applyViewport();
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const ua = process.env.MRD_BROWSER_USER_AGENT;
    if (ua) await cdp.send('Emulation.setUserAgentOverride', { userAgent: ua });
    await this.startScreencast();
    await this.broadcastState();
    await this.pushMediaState();
  }

  async detachTarget() {
    if (!this.cdp) return;
    const cdp = this.cdp;
    this.cdp = null;
    try { await cdp.send('Page.stopScreencast'); } catch {}
    try { cdp.close(); } catch {}
  }

  async startScreencast() {
    if (!this.cdp) return;
    try { await this.cdp.send('Page.stopScreencast'); } catch {}
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: Math.max(35, Math.min(90, SCREENCAST_QUALITY)),
      maxWidth: this.viewport.width,
      maxHeight: this.viewport.height,
      everyNthFrame: 1,
      maxFramesInFlight: 2,
      sendLastFrame: true
    });
  }

  async onScreencastFrame(event) {
    const cdp = this.cdp;
    if (!cdp || !event?.data) return;
    const frame = Buffer.from(event.data, 'base64');
    for (const ws of this.wss.clients) {
      if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 1_500_000) ws.send(frame, { binary: true });
    }
    try { await cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }); } catch {}
  }

  async setViewport(width, height, deviceScaleFactor = DEFAULT_DPR) {
    const w = Math.round(Math.max(320, Math.min(1200, Number(width) || DEFAULT_WIDTH)));
    const h = Math.round(Math.max(320, Math.min(1200, Number(height) || DEFAULT_HEIGHT)));
    const dpr = Math.max(1, Math.min(3, Number(deviceScaleFactor) || DEFAULT_DPR));
    if (w === this.viewport.width && h === this.viewport.height && dpr === this.viewport.deviceScaleFactor) return;
    this.viewport = { width: w, height: h, deviceScaleFactor: dpr };
    await this.applyViewport();
    await this.startScreencast();
    await this.broadcastState();
  }

  async applyViewport() {
    if (!this.cdp) return;
    await this.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: this.viewport.width,
      height: this.viewport.height,
      deviceScaleFactor: this.viewport.deviceScaleFactor,
      mobile: true,
      screenWidth: this.viewport.width,
      screenHeight: this.viewport.height,
      positionX: 0,
      positionY: 0,
      dontSetVisibleSize: false
    });
  }

  async navigate(value) {
    if (!this.cdp) await this.start();
    await this.cdp.send('Page.navigate', { url: normalizeAddress(value) });
  }

  async goHistory(direction) {
    if (!this.cdp) return;
    const history = await this.cdp.send('Page.getNavigationHistory');
    const nextIndex = Math.max(0, Math.min(history.entries.length - 1, history.currentIndex + direction));
    const entry = history.entries[nextIndex];
    if (entry && nextIndex !== history.currentIndex) await this.cdp.send('Page.navigateToHistoryEntry', { entryId: entry.id });
  }

  async dispatchTouch(type, message) {
    if (!this.cdp) return;
    const x = clamp(Number(message.x) || 0, 0, 1) * this.viewport.width;
    const y = clamp(Number(message.y) || 0, 0, 1) * this.viewport.height;
    await this.cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: [{ x, y, radiusX: 2, radiusY: 2, force: 1, id: 1 }]
    });
  }

  async dispatchMouse(message) {
    if (!this.cdp) return;
    const x = clamp(Number(message.x) || 0, 0, 1) * this.viewport.width;
    const y = clamp(Number(message.y) || 0, 0, 1) * this.viewport.height;
    const kind = ['mouseMoved', 'mousePressed', 'mouseReleased'].includes(message.event) ? message.event : 'mouseMoved';
    const button = ['left', 'right', 'middle', 'none'].includes(message.button) ? message.button : 'none';
    await this.cdp.send('Input.dispatchMouseEvent', { type: kind, x, y, button, clickCount: kind === 'mousePressed' ? 1 : 0 });
  }

  async dispatchWheel(message) {
    if (!this.cdp) return;
    const x = clamp(Number(message.x) || 0.5, 0, 1) * this.viewport.width;
    const y = clamp(Number(message.y) || 0.5, 0, 1) * this.viewport.height;
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x, y,
      deltaX: Math.max(-1200, Math.min(1200, Number(message.deltaX) || 0)),
      deltaY: Math.max(-1200, Math.min(1200, Number(message.deltaY) || 0))
    });
  }

  async dispatchKey(key) {
    if (!this.cdp || !key) return;
    const map = {
      Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
      Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
      Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
      Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
      ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
      ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
      ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
      ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
      Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
      Home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
      End: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
      PageUp: { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 },
      PageDown: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 }
    };
    const spec = map[key] || { key: key.slice(0, 1), code: '', text: key.slice(0, 1) };
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...spec });
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...spec, text: undefined });
  }

  async mediaAction(message) {
    if (!this.cdp) return;
    const action = String(message.action || '');
    const value = Number(message.value);
    const script = `(() => {
      const media = Array.from(document.querySelectorAll('video,audio')).sort((a,b) => ((b.clientWidth||0)*(b.clientHeight||0))-((a.clientWidth||0)*(a.clientHeight||0)))[0];
      if (!media) return null;
      const action = ${JSON.stringify(action)};
      const value = ${Number.isFinite(value) ? value : 'null'};
      if (action === 'play-pause') { if (media.paused) media.play().catch(()=>{}); else media.pause(); }
      else if (action === 'seek') media.currentTime = Math.max(0, Math.min(Number.isFinite(media.duration) ? media.duration : value, value));
      else if (action === 'skip') media.currentTime = Math.max(0, media.currentTime + value);
      else if (action === 'mute') media.muted = !media.muted;
      else if (action === 'volume') media.volume = Math.max(0, Math.min(1, value));
      return true;
    })()`;
    await this.cdp.send('Runtime.evaluate', { expression: script, awaitPromise: true, returnByValue: true });
    await delay(100);
    await this.pushMediaState();
  }

  startMediaPoll() {
    if (this.mediaTimer) return;
    this.mediaTimer = setInterval(() => this.pushMediaState().catch(() => {}), 1000);
    this.mediaTimer.unref?.();
  }

  stopMediaPoll() {
    if (!this.mediaTimer) return;
    clearInterval(this.mediaTimer);
    this.mediaTimer = null;
  }

  async getMediaState() {
    if (!this.cdp) return emptyMedia();
    const expression = `(() => {
      const all = Array.from(document.querySelectorAll('video,audio'));
      const media = all.sort((a,b) => ((b.clientWidth||0)*(b.clientHeight||0))-((a.clientWidth||0)*(a.clientHeight||0)))[0];
      if (!media) return {hasMedia:false};
      return {
        hasMedia:true,
        kind:media.tagName.toLowerCase(),
        playing:!media.paused && !media.ended,
        paused:media.paused,
        ended:media.ended,
        currentTime:Number.isFinite(media.currentTime)?media.currentTime:0,
        duration:Number.isFinite(media.duration)?media.duration:0,
        volume:media.volume,
        muted:media.muted,
        title:document.title||location.hostname,
        src:media.currentSrc||media.src||''
      };
    })()`;
    try {
      const result = await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true });
      return { ...emptyMedia(), ...(result?.result?.value || {}) };
    } catch {
      return emptyMedia();
    }
  }

  async pushMediaState() {
    const media = await this.getMediaState();
    const json = JSON.stringify(media);
    if (json === JSON.stringify(this.lastMedia)) return;
    this.lastMedia = media;
    this.broadcastJson({ type: 'media', media });
  }

  async stateSnapshot() {
    const tabs = await this.listTargets().catch(() => []);
    let active = tabs.find(item => item.id === this.activeTargetId) || null;
    if (this.cdp) {
      try {
        const evaluated = await this.cdp.send('Runtime.evaluate', {
          expression: '({title:document.title,url:location.href})', returnByValue: true
        });
        if (active && evaluated?.result?.value) active = { ...active, ...evaluated.result.value };
      } catch {}
    }
    return {
      status: this.status,
      activeTargetId: this.activeTargetId,
      active: active ? { id: active.id, title: active.title || '', url: active.url || '' } : null,
      tabs: tabs.map(item => ({ id: item.id, title: item.title || 'New Tab', url: item.url || '' })),
      media: this.lastMedia
    };
  }

  async broadcastState() {
    this.broadcastJson({ type: 'state', state: await this.stateSnapshot() });
  }

  scheduleStateBroadcast() {
    clearTimeout(this.stateBroadcastTimer);
    this.stateBroadcastTimer = setTimeout(() => this.broadcastState().catch(() => {}), 250);
    this.stateBroadcastTimer.unref?.();
  }

  broadcastJson(value) {
    const text = JSON.stringify(value);
    for (const ws of this.wss.clients) if (ws.readyState === WebSocket.OPEN) ws.send(text);
  }
}

class CdpConnection {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.open = false;
  }

  openConnection() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url, { perMessageDeflate: false });
      this.ws = ws;
      ws.on('open', () => { this.open = true; resolve(); });
      ws.on('message', data => this.onMessage(data));
      ws.on('error', reject);
      ws.on('close', () => {
        this.open = false;
        for (const { reject: rejectPending } of this.pending.values()) rejectPending(new Error('Chrome DevTools connection closed.'));
        this.pending.clear();
        this.emit('close', {});
      });
    });
  }

  send(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Chrome DevTools connection is not open.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.reject(new Error(`Chrome DevTools command timed out: ${method}`));
      }, 8000).unref();
    });
  }

  on(event, handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event).add(handler);
  }

  emit(event, params) {
    for (const handler of this.handlers.get(event) || []) {
      try { handler(params); } catch {}
    }
  }

  onMessage(data) {
    let message;
    try { message = JSON.parse(data.toString('utf8')); } catch { return; }
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'Chrome DevTools error'));
      else pending.resolve(message.result || {});
      return;
    }
    if (message.method) this.emit(message.method, message.params || {});
  }

  close() {
    try { this.ws?.close(1000, 'Switching tabs'); } catch {}
    this.open = false;
  }
}

function findChrome() {
  if (process.platform !== 'win32') return null;
  const candidates = [
    process.env.MRD_CHROME,
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
  return candidates.find(candidate => fssync.existsSync(candidate)) || null;
}

function normalizeAddress(value) {
  const input = String(value || '').trim();
  if (!input) return GOOGLE;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) return input;
  if (/^localhost(?::\d+)?(?:\/|$)/i.test(input)) return `http://${input}`;
  if (/^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:\/.*)?$/i.test(input)) return `https://${input}`;
  return `https://www.google.com/search?q=${encodeURIComponent(input)}`;
}

function httpJson(port, requestPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: requestPath, method, timeout: 3000 }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        if ((res.statusCode || 500) >= 400) return reject(new Error(`Chrome DevTools HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (error) { reject(error); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Chrome DevTools request timed out.')));
    req.on('error', reject);
    req.end();
  });
}

function emptyMedia() {
  return { hasMedia: false, kind: null, playing: false, paused: true, ended: false, currentTime: 0, duration: 0, volume: 1, muted: false, title: '', src: '' };
}

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
