import http from 'node:http';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { AudioRouter } from './audio-router.mjs';
import {
  getAppCatalog,
  launchWindowsApp,
  restartDockerDesktop,
  restartGuacamole,
  restartTailscale
} from './windows-apps.mjs';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const RUNTIME_DIR = path.join(ROOT, '.runtime');
const STATE_FILE = path.join(RUNTIME_DIR, 'state.json');
const GUAC_CONNECTION_ID_FILE = path.join(RUNTIME_DIR, 'guacamole-connection-id.txt');

loadDotEnv(path.join(ROOT, '.env'));

const HOST = process.env.PC_REMOTE_HOST || '127.0.0.1';
const PORT = Number(process.env.PC_REMOTE_PORT || 8787);
const PC_NAME = process.env.PC_REMOTE_NAME || os.hostname();
const GUACAMOLE_ORIGIN = new URL(process.env.GUACAMOLE_ORIGIN || 'http://127.0.0.1:8080');
const GUACAMOLE_DATASOURCE = process.env.GUACAMOLE_DATASOURCE || 'postgresql';
const ALLOW_POWER_CONTROLS = String(process.env.ALLOW_POWER_CONTROLS || 'false').toLowerCase() === 'true';
const DEMO_STATE = process.env.PC_REMOTE_DEMO_STATE || '';
const AUDIO_DESTINATIONS = new Set(['desktop', 'mobile', 'both', 'muted']);
const AUDIO_ACTIVE_MODES = new Set(['desktop', 'browser', 'none']);
const PRIVACY_MODES = new Set(['secret', 'not-secret']);

await fs.mkdir(RUNTIME_DIR, { recursive: true });

const clients = new Set();
let lastStatusJson = '';
let cpuPrevious = sampleCpu();
let runtimeState = normalizeRuntimeState(await readRuntimeState());
const audioRouter = new AudioRouter(ROOT);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname.startsWith('/guacamole/')) return proxyHttp(req, res, url);

    if (url.pathname === '/api/status' && req.method === 'GET') {
      return sendJson(res, 200, await getStatus());
    }

    if (url.pathname === '/api/config' && req.method === 'GET') {
      return sendJson(res, 200, {
        pcName: PC_NAME,
        powerControlsEnabled: ALLOW_POWER_CONTROLS,
        desktop: {
          enabled: true,
          path: await getDesktopPath(),
          privacy: {
            defaultMode: runtimeState.session.privacyMode,
            secretSupported: false,
            notSecretSupported: true,
            secretPhase: 'console-transport-required'
          }
        },
        browser: { enabled: false, phase: 'browser-engine-next' },
        audio: {
          destinations: ['desktop', 'mobile', 'both', 'muted'],
          defaultDestination: 'mobile',
          ...audioRouter.status
        }
      });
    }

    if (url.pathname === '/api/session' && req.method === 'GET') {
      return sendJson(res, 200, getSessionState());
    }

    if (url.pathname === '/api/session/prepare' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const result = await prepareSession(body);
      return sendJson(res, result.ok ? 200 : (result.code || 400), result);
    }

    if (url.pathname === '/api/apps' && req.method === 'GET') {
      return sendJson(res, 200, { apps: getAppCatalog() });
    }

    const appLaunchMatch = url.pathname.match(/^\/api\/apps\/([^/]+)\/launch$/);
    if (appLaunchMatch && req.method === 'POST') {
      const result = await launchWindowsApp(decodeURIComponent(appLaunchMatch[1]));
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/admin/action' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const result = await handleAdminAction(body?.action);
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/audio' && req.method === 'GET') {
      return sendJson(res, 200, getAudioState());
    }

    if (url.pathname === '/api/audio' && req.method === 'PUT') {
      const body = await readJsonBody(req);
      const result = await updateAudioState(body);
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (url.pathname.startsWith('/api/power/') && req.method === 'POST') {
      if (!ALLOW_POWER_CONTROLS) {
        return sendJson(res, 403, { ok: false, error: 'Power controls are disabled. Set ALLOW_POWER_CONTROLS=true after setup.' });
      }
      const action = url.pathname.split('/').pop();
      const result = await handlePowerAction(action);
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (url.pathname === '/api/browser/session' && req.method === 'POST') {
      return sendJson(res, 501, {
        ok: false,
        error: 'PC-powered Chromium transport is the next implementation milestone. Use Desktop → Browser to open a dedicated Chrome window now.'
      });
    }

    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(url.pathname, req, res);

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' });
    else res.end();
  }
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/audio/stream') {
    audioRouter.handleUpgrade(req, socket, head);
    return;
  }
  if (!url.pathname.startsWith('/guacamole/')) {
    socket.destroy();
    return;
  }
  proxyWebSocket(req, socket, head, url);
});

server.listen(PORT, HOST, () => {
  console.log(`MRD listening on http://${HOST}:${PORT}`);
  console.log(`Guacamole proxy target: ${GUACAMOLE_ORIGIN.origin}`);
  console.log(`Power controls: ${ALLOW_POWER_CONTROLS ? 'ENABLED' : 'disabled'}`);
  console.log(`Audio router: ${audioRouter.available ? 'available' : 'not installed'}`);
});

setInterval(async () => {
  try {
    const status = await getStatus();
    const json = JSON.stringify(status);
    if (json !== lastStatusJson) {
      lastStatusJson = json;
      broadcast('status', status);
    } else {
      broadcast('heartbeat', { at: Date.now() });
    }
  } catch (error) {
    console.error('status poll failed', error);
  }
}, 2500).unref();

async function getDesktopPath() {
  try {
    const connectionId = (await fs.readFile(GUAC_CONNECTION_ID_FILE, 'utf8')).trim();
    if (!connectionId) return '/guacamole/';
    const encoded = Buffer.from(`${connectionId}\0c\0${GUACAMOLE_DATASOURCE}`, 'utf8').toString('base64url');
    return `/guacamole/#/client/${encoded}`;
  } catch {
    return '/guacamole/';
  }
}

function getSessionState() {
  return {
    privacyMode: runtimeState.session.privacyMode,
    transport: runtimeState.session.privacyMode === 'not-secret' ? 'rdp' : 'console',
    secretSupported: false,
    notSecretSupported: true,
    preparedAt: runtimeState.session.preparedAt || null
  };
}

async function prepareSession(body) {
  const privacyMode = body?.privacyMode || runtimeState.session.privacyMode || 'not-secret';
  if (!PRIVACY_MODES.has(privacyMode)) return { ok: false, error: 'privacyMode must be secret or not-secret.' };

  runtimeState.session.privacyMode = privacyMode;
  runtimeState.session.preparedAt = Date.now();
  await writeRuntimeState(runtimeState);

  if (privacyMode === 'secret') {
    return {
      ok: false,
      code: 409,
      privacyMode,
      secretSupported: false,
      error: 'Secret mode needs MRD console/virtual-display transport. Standard Windows RDP always locks the local console, so MRD will not fake this mode with RDP.'
    };
  }

  return {
    ok: true,
    privacyMode,
    transport: 'rdp',
    desktopPath: await getDesktopPath()
  };
}

async function handleAdminAction(action) {
  if (!action) return { ok: false, error: 'Admin action required.' };
  if (action === 'restart-guacamole') return restartGuacamole(ROOT);
  if (action === 'restart-docker') return restartDockerDesktop();
  if (action === 'restart-tailscale') return restartTailscale();
  if (action === 'open-services') return launchWindowsApp('services');
  if (action === 'open-task-manager') return launchWindowsApp('task-manager');
  if (action === 'restart-mrd') return scheduleMrdRestart();
  return { ok: false, error: 'Unsupported MRD admin action.' };
}

function scheduleMrdRestart() {
  if (process.platform !== 'win32') return { ok: false, error: 'MRD restart is Windows-only.' };
  const launcher = path.join(ROOT, 'Start-MRD.cmd');
  if (!fssync.existsSync(launcher)) return { ok: false, error: 'Start-MRD.cmd was not found.' };

  const escaped = launcher.replace(/'/g, "''");
  const child = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
    `Start-Sleep -Seconds 2; Start-Process -FilePath '${escaped}'`
  ], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  setTimeout(() => shutdown(), 500).unref();
  return { ok: true, action: 'restart-mrd', reconnectInSeconds: 8 };
}

async function getStatus() {
  const now = Date.now();
  const demo = normalizeDemoState(DEMO_STATE);
  const locked = demo ? demo === 'onlineLocked' : await detectWindowsLocked();
  const state = demo || (locked ? 'onlineLocked' : 'onlineUnlocked');
  const cpu = getCpuPercent();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  runtimeState.lastSeenAt = now;
  runtimeState.lastKnownState = state;
  if (state.startsWith('online')) runtimeState.lastPowerIntent = null;
  await writeRuntimeState(runtimeState);

  return {
    name: PC_NAME,
    state,
    locked: state === 'onlineLocked',
    online: state.startsWith('online'),
    at: now,
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      uptimeSeconds: Math.floor(os.uptime())
    },
    metrics: {
      cpuPercent: cpu,
      memoryPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
      memoryUsedGb: roundGb(totalMem - freeMem),
      memoryTotalGb: roundGb(totalMem)
    },
    detector: process.platform === 'win32' ? 'Windows LogonUI process' : (demo ? 'demo override' : 'non-Windows development fallback'),
    powerControlsEnabled: ALLOW_POWER_CONTROLS
  };
}

function getAudioState() {
  const audio = runtimeState.audio;
  const effectiveDestination = audio.activeMode === 'desktop'
    ? audio.desktopMode
    : audio.activeMode === 'browser'
      ? audio.browserMode
      : null;
  const routerStatus = audioRouter.status;

  return {
    desktopMode: audio.desktopMode,
    browserMode: audio.browserMode,
    activeMode: audio.activeMode,
    effectiveDestination,
    routingApplied: routerStatus.routingApplied && routerStatus.appliedDestination === effectiveDestination,
    transportPhase: audio.activeMode === 'desktop' ? 'guacamole-rdp-audio' : (routerStatus.helperAvailable ? 'native-router' : 'helper-required'),
    router: routerStatus
  };
}

async function updateAudioState(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'JSON body required.' };

  if (body.activeMode != null) {
    if (!AUDIO_ACTIVE_MODES.has(body.activeMode)) return { ok: false, error: 'activeMode must be desktop, browser, or none.' };
    runtimeState.audio.activeMode = body.activeMode;
  }

  if (body.mode != null || body.destination != null) {
    if (!['desktop', 'browser'].includes(body.mode)) return { ok: false, error: 'mode must be desktop or browser.' };
    if (!AUDIO_DESTINATIONS.has(body.destination)) return { ok: false, error: 'destination must be desktop, mobile, both, or muted.' };
    runtimeState.audio[body.mode === 'desktop' ? 'desktopMode' : 'browserMode'] = body.destination;
  }

  await writeRuntimeState(runtimeState);
  const policy = getAudioState();
  await audioRouter.apply(policy.effectiveDestination, { capture: runtimeState.audio.activeMode === 'browser' });
  const state = getAudioState();
  broadcast('audio', state);
  return { ok: true, ...state };
}

async function readJsonBody(req, maxBytes = 16 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Request body too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('Invalid JSON body.');
  }
}

async function detectWindowsLocked() {
  if (process.platform !== 'win32') return false;
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      "if (Get-Process -Name LogonUI -ErrorAction SilentlyContinue) { 'LOCKED' } else { 'UNLOCKED' }"
    ], { windowsHide: true, timeout: 2000 });
    return stdout.trim() === 'LOCKED';
  } catch {
    return false;
  }
}

async function handlePowerAction(action) {
  if (process.platform !== 'win32') return { ok: false, error: 'Power actions are available only on the Windows host.' };

  const commandMap = {
    lock: ['rundll32.exe', ['user32.dll,LockWorkStation']],
    restart: ['shutdown.exe', ['/r', '/t', '0']],
    shutdown: ['shutdown.exe', ['/s', '/t', '0']],
    sleep: ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend',$false,$false) | Out-Null"]]
  };

  const command = commandMap[action];
  if (!command) return { ok: false, error: `Unsupported power action: ${action}` };

  if (action === 'sleep') {
    runtimeState.lastPowerIntent = 'asleep';
    runtimeState.lastPowerIntentAt = Date.now();
    await writeRuntimeState(runtimeState);
    broadcast('status', { ...(await getStatus()), state: 'asleep', online: false, locked: true, at: Date.now() });
    await new Promise(resolve => setTimeout(resolve, 400));
  }

  try {
    await execFileAsync(command[0], command[1], { windowsHide: true, timeout: 2500 });
    return { ok: true, action };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function sampleCpu() {
  return os.cpus().map(cpu => ({
    idle: cpu.times.idle,
    total: Object.values(cpu.times).reduce((a, b) => a + b, 0)
  }));
}

function getCpuPercent() {
  const current = sampleCpu();
  let idleDelta = 0;
  let totalDelta = 0;
  for (let i = 0; i < current.length; i++) {
    idleDelta += current[i].idle - cpuPrevious[i].idle;
    totalDelta += current[i].total - cpuPrevious[i].total;
  }
  cpuPrevious = current;
  if (totalDelta <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100)));
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) client.write(payload);
}

async function serveStatic(requestPath, req, res) {
  let pathname = decodeURIComponent(requestPath);
  if (pathname === '/') pathname = '/index.html';
  const safePath = path.normalize(pathname).replace(/^([.][.][/\\])+/, '');
  let filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 403, 'Forbidden');

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html');
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src 'self'; media-src 'self' blob:;"
    });
    if (req.method !== 'HEAD') res.end(data); else res.end();
  } catch {
    const data = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'));
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
    res.end(data);
  }
}

function proxyHttp(req, res, url) {
  const targetPath = url.pathname + url.search;
  const headers = { ...req.headers, host: GUACAMOLE_ORIGIN.host };
  const proxyReq = http.request({
    hostname: GUACAMOLE_ORIGIN.hostname,
    port: GUACAMOLE_ORIGIN.port || 80,
    method: req.method,
    path: targetPath,
    headers
  }, proxyRes => {
    const responseHeaders = { ...proxyRes.headers };
    delete responseHeaders['x-frame-options'];
    delete responseHeaders['content-security-policy'];
    res.writeHead(proxyRes.statusCode || 502, responseHeaders);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', error => sendJson(res, 502, { error: 'Guacamole is not reachable', detail: error.message }));
  req.pipe(proxyReq);
}

function proxyWebSocket(req, clientSocket, head, url) {
  const upstream = net.connect(Number(GUACAMOLE_ORIGIN.port || 80), GUACAMOLE_ORIGIN.hostname, () => {
    const lines = [`${req.method} ${url.pathname}${url.search} HTTP/${req.httpVersion}`];
    for (const [key, value] of Object.entries(req.headers)) {
      if (value == null) continue;
      if (key.toLowerCase() === 'host') lines.push(`host: ${GUACAMOLE_ORIGIN.host}`);
      else if (Array.isArray(value)) for (const item of value) lines.push(`${key}: ${item}`);
      else lines.push(`${key}: ${value}`);
    }
    lines.push('', '');
    upstream.write(lines.join('\r\n'));
    if (head?.length) upstream.write(head);
    clientSocket.pipe(upstream).pipe(clientSocket);
  });
  upstream.on('error', () => clientSocket.destroy());
  clientSocket.on('error', () => upstream.destroy());
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function roundGb(bytes) {
  return Math.round((bytes / 1024 / 1024 / 1024) * 10) / 10;
}

function normalizeDemoState(value) {
  return ['offline', 'asleep', 'onlineUnlocked', 'onlineLocked'].includes(value) ? value : '';
}

function normalizeRuntimeState(value = {}) {
  return {
    lastPowerIntent: value.lastPowerIntent ?? null,
    lastPowerIntentAt: value.lastPowerIntentAt ?? null,
    lastSeenAt: value.lastSeenAt ?? null,
    lastKnownState: value.lastKnownState ?? null,
    session: {
      privacyMode: PRIVACY_MODES.has(value.session?.privacyMode) ? value.session.privacyMode : 'not-secret',
      preparedAt: value.session?.preparedAt ?? null
    },
    audio: {
      desktopMode: AUDIO_DESTINATIONS.has(value.audio?.desktopMode) ? value.audio.desktopMode : 'mobile',
      browserMode: AUDIO_DESTINATIONS.has(value.audio?.browserMode) ? value.audio.browserMode : 'mobile',
      activeMode: AUDIO_ACTIVE_MODES.has(value.audio?.activeMode) ? value.audio.activeMode : 'none'
    }
  };
}

async function readRuntimeState() {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
  } catch {
    return {
      lastPowerIntent: null,
      lastPowerIntentAt: null,
      lastSeenAt: null,
      lastKnownState: null,
      session: { privacyMode: 'not-secret', preparedAt: null },
      audio: { desktopMode: 'mobile', browserMode: 'mobile', activeMode: 'none' }
    };
  }
}

async function writeRuntimeState(value) {
  try { await fs.writeFile(STATE_FILE, JSON.stringify(value, null, 2)); } catch {}
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { await audioRouter.shutdown(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function loadDotEnv(file) {
  if (!fssync.existsSync(file)) return;
  const text = fssync.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}
