import fssync from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { WebSocketServer, WebSocket } from 'ws';

const execFileAsync = promisify(execFile);
const SOURCE_WIDTH = Number(process.env.MRD_SECRET_WIDTH || 880);
const SOURCE_HEIGHT = Number(process.env.MRD_SECRET_HEIGHT || 1912);
const STREAM_WIDTH = Number(process.env.MRD_SECRET_STREAM_WIDTH || 440);
const STREAM_HEIGHT = Number(process.env.MRD_SECRET_STREAM_HEIGHT || 956);
const FPS = Number(process.env.MRD_SECRET_FPS || 20);

export class SecretTransport {
  constructor(root) {
    this.root = root;
    this.ffmpegPath = null;
    this.display = null;
    this.capture = null;
    this.inputWorker = null;
    this.frameBuffer = Buffer.alloc(0);
    this.lastError = null;
    this.startedAt = null;
    this.lastStatusCheck = 0;

    this.videoWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
    this.inputWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

    this.videoWss.on('connection', async ws => {
      try {
        const status = await this.refreshStatus(true);
        if (!status.ready) {
          ws.send(JSON.stringify({ type: 'error', message: status.error || 'Secret transport is not ready.' }));
          ws.close(1011, 'Secret transport unavailable');
          return;
        }
        ws.send(JSON.stringify({ type: 'display', ...this.publicDisplay() }));
        await this.start();
      } catch (error) {
        ws.send(JSON.stringify({ type: 'error', message: error.message }));
        ws.close(1011, 'Secret transport failed');
      }
    });

    this.videoWss.on('connection', ws => {
      ws.on('close', () => this.scheduleIdleStop());
    });

    this.inputWss.on('connection', async ws => {
      try {
        const status = await this.refreshStatus(true);
        if (!status.ready) {
          ws.send(JSON.stringify({ type: 'error', message: status.error || 'Secret transport is not ready.' }));
          ws.close(1011, 'Secret input unavailable');
          return;
        }
        await this.ensureInputWorker();
        ws.send(JSON.stringify({ type: 'display', ...this.publicDisplay() }));
        ws.on('message', data => this.handleInputMessage(data));
      } catch (error) {
        ws.send(JSON.stringify({ type: 'error', message: error.message }));
        ws.close(1011, 'Secret input failed');
      }
    });
  }

  get status() {
    const ready = process.platform === 'win32' && Boolean(this.ffmpegPath) && Boolean(this.display);
    return {
      ready,
      phase: ready ? 'ready' : 'setup-required',
      ffmpegAvailable: Boolean(this.ffmpegPath),
      ffmpegPath: this.ffmpegPath,
      displayDetected: Boolean(this.display),
      display: this.publicDisplay(),
      streaming: Boolean(this.capture),
      videoClients: this.videoWss.clients.size,
      inputClients: this.inputWss.clients.size,
      startedAt: this.startedAt,
      lastError: this.lastError,
      error: ready ? null : this.lastError || this.readinessMessage()
    };
  }

  publicDisplay() {
    if (!this.display) return null;
    return {
      x: this.display.x,
      y: this.display.y,
      width: this.display.width,
      height: this.display.height,
      streamWidth: STREAM_WIDTH,
      streamHeight: STREAM_HEIGHT,
      fps: FPS,
      deviceName: this.display.deviceName || null
    };
  }

  readinessMessage() {
    if (process.platform !== 'win32') return 'Secret transport is available only on the Windows host.';
    if (!this.ffmpegPath) return 'FFmpeg is not installed for Secret transport. Run scripts/setup-secret-transport.ps1 as Administrator.';
    if (!this.display) return `MRD virtual display ${SOURCE_WIDTH}x${SOURCE_HEIGHT} was not detected. Run scripts/setup-secret-transport.ps1 as Administrator.`;
    return 'Secret transport is not ready.';
  }

  async refreshStatus(force = false) {
    const now = Date.now();
    if (!force && now - this.lastStatusCheck < 3000) return this.status;
    this.lastStatusCheck = now;
    this.lastError = null;

    if (process.platform !== 'win32') return this.status;

    try {
      this.ffmpegPath = await findFfmpeg();
    } catch (error) {
      this.ffmpegPath = null;
      this.lastError = error.message;
    }

    try {
      this.display = await findSecretDisplay(SOURCE_WIDTH, SOURCE_HEIGHT);
    } catch (error) {
      this.display = null;
      this.lastError = this.lastError || error.message;
    }

    return this.status;
  }

  async start() {
    const status = await this.refreshStatus(true);
    if (!status.ready) throw new Error(status.error || 'Secret transport is not ready.');
    await this.ensureInputWorker();
    this.ensureCapture();
    if (!this.startedAt) this.startedAt = Date.now();
    return this.status;
  }

  async stop() {
    this.stopCapture();
    this.stopInputWorker();
    this.startedAt = null;
    for (const ws of this.videoWss.clients) {
      try { ws.close(1000, 'Secret session ended'); } catch {}
    }
    for (const ws of this.inputWss.clients) {
      try { ws.close(1000, 'Secret session ended'); } catch {}
    }
    return this.status;
  }

  async shutdown() {
    await this.stop();
  }

  handleUpgrade(kind, req, socket, head) {
    const target = kind === 'video' ? this.videoWss : this.inputWss;
    target.handleUpgrade(req, socket, head, ws => target.emit('connection', ws, req));
  }

  ensureCapture() {
    if (this.capture || !this.ffmpegPath || !this.display) return;
    this.frameBuffer = Buffer.alloc(0);
    const d = this.display;
    const args = [
      '-hide_banner', '-loglevel', 'warning',
      '-f', 'gdigrab',
      '-framerate', String(FPS),
      '-draw_mouse', '1',
      '-offset_x', String(d.x),
      '-offset_y', String(d.y),
      '-video_size', `${d.width}x${d.height}`,
      '-i', 'desktop',
      '-vf', `scale=${STREAM_WIDTH}:${STREAM_HEIGHT}:flags=fast_bilinear`,
      '-an',
      '-q:v', '5',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      'pipe:1'
    ];

    const child = spawn(this.ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.capture = child;
    child.stdout.on('data', chunk => this.consumeJpegBytes(chunk));
    child.stderr.on('data', chunk => {
      const text = chunk.toString('utf8').trim();
      if (text) console.error('[MRD secret video]', text);
    });
    child.on('error', error => {
      this.lastError = error.message;
      if (this.capture === child) this.capture = null;
    });
    child.on('exit', code => {
      if (this.capture === child) this.capture = null;
      if (code && code !== 0) this.lastError = `Secret video capture exited with code ${code}`;
    });
  }

  stopCapture() {
    if (!this.capture) return;
    const child = this.capture;
    this.capture = null;
    try { child.kill(); } catch {}
    this.frameBuffer = Buffer.alloc(0);
  }

  scheduleIdleStop() {
    setTimeout(() => {
      if (this.videoWss.clients.size === 0) this.stopCapture();
    }, 3000).unref();
  }

  consumeJpegBytes(chunk) {
    this.frameBuffer = this.frameBuffer.length ? Buffer.concat([this.frameBuffer, chunk]) : Buffer.from(chunk);
    const SOI = Buffer.from([0xff, 0xd8]);
    const EOI = Buffer.from([0xff, 0xd9]);

    while (this.frameBuffer.length > 4) {
      const start = this.frameBuffer.indexOf(SOI);
      if (start < 0) {
        this.frameBuffer = this.frameBuffer.subarray(Math.max(0, this.frameBuffer.length - 2));
        return;
      }
      const end = this.frameBuffer.indexOf(EOI, start + 2);
      if (end < 0) {
        if (start > 0) this.frameBuffer = this.frameBuffer.subarray(start);
        return;
      }
      const frame = this.frameBuffer.subarray(start, end + 2);
      this.frameBuffer = this.frameBuffer.subarray(end + 2);
      for (const ws of this.videoWss.clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(frame, { binary: true });
      }
    }
  }

  async ensureInputWorker() {
    if (this.inputWorker) return;
    const script = path.join(this.root, 'scripts', 'secret-input-worker.ps1');
    if (!fssync.existsSync(script)) throw new Error('Secret input worker script is missing.');

    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script
    ], { cwd: this.root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.inputWorker = child;
    child.stdout.on('data', () => {});
    child.stderr.on('data', chunk => {
      const text = chunk.toString('utf8').trim();
      if (text) console.error('[MRD secret input]', text);
    });
    child.on('error', error => {
      this.lastError = error.message;
      if (this.inputWorker === child) this.inputWorker = null;
    });
    child.on('exit', code => {
      if (this.inputWorker === child) this.inputWorker = null;
      if (code && code !== 0) this.lastError = `Secret input worker exited with code ${code}`;
    });
  }

  stopInputWorker() {
    if (!this.inputWorker) return;
    const child = this.inputWorker;
    this.inputWorker = null;
    try { child.stdin.end(); } catch {}
    try { child.kill(); } catch {}
  }

  handleInputMessage(data) {
    if (!this.inputWorker || !this.display) return;
    let message;
    try { message = JSON.parse(data.toString('utf8')); } catch { return; }
    const allowed = new Set(['move', 'down', 'up', 'wheel', 'text', 'key']);
    if (!allowed.has(message.type)) return;

    const payload = { type: message.type };
    if (['move', 'down', 'up', 'wheel'].includes(message.type)) {
      payload.x = this.display.x + Math.round(clamp01(Number(message.x)) * Math.max(1, this.display.width - 1));
      payload.y = this.display.y + Math.round(clamp01(Number(message.y)) * Math.max(1, this.display.height - 1));
    }
    if (message.type === 'down' || message.type === 'up') payload.button = ['left', 'right', 'middle'].includes(message.button) ? message.button : 'left';
    if (message.type === 'wheel') payload.delta = Math.max(-1200, Math.min(1200, Math.round(Number(message.delta) || 0)));
    if (message.type === 'text') payload.text = String(message.text || '').slice(0, 512);
    if (message.type === 'key') payload.key = String(message.key || '').slice(0, 32);

    try { this.inputWorker.stdin.write(`${JSON.stringify(payload)}\n`); } catch {}
  }

  async moveForegroundToDisplay() {
    if (!this.display) return;
    await this.ensureInputWorker();
    try {
      this.inputWorker.stdin.write(`${JSON.stringify({
        type: 'move-foreground',
        x: this.display.x,
        y: this.display.y,
        width: this.display.width,
        height: this.display.height
      })}\n`);
    } catch {}
  }
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

async function findFfmpeg() {
  const override = process.env.MRD_FFMPEG;
  if (override && fssync.existsSync(override)) return override;

  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'ffmpeg', 'bin', 'ffmpeg.exe')
  ].filter(Boolean);
  for (const candidate of candidates) if (fssync.existsSync(candidate)) return candidate;

  try {
    const { stdout } = await execFileAsync('where.exe', ['ffmpeg.exe'], { windowsHide: true, timeout: 3000 });
    const found = stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean);
    if (found && fssync.existsSync(found)) return found;
  } catch {}
  return null;
}

async function findSecretDisplay(width, height) {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$screen = [System.Windows.Forms.Screen]::AllScreens |
  Where-Object { $_.Bounds.Width -eq ${width} -and $_.Bounds.Height -eq ${height} } |
  Select-Object -First 1
if ($screen) {
  [pscustomobject]@{
    x = $screen.Bounds.X
    y = $screen.Bounds.Y
    width = $screen.Bounds.Width
    height = $screen.Bounds.Height
    deviceName = $screen.DeviceName
    primary = $screen.Primary
  } | ConvertTo-Json -Compress
}
`;
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-Command', script
  ], { windowsHide: true, timeout: 5000 });
  const text = stdout.trim();
  if (!text) return null;
  const value = JSON.parse(text);
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
  return value;
}
