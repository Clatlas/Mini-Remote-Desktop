import fssync from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { WebSocketServer, WebSocket } from 'ws';

const execFileAsync = promisify(execFile);
const FRAME_BYTES = 4; // 16-bit stereo

export class AudioRouter {
  constructor(root) {
    this.root = root;
    this.helperPath = process.env.MRD_AUDIO_HELPER || path.join(root, 'bin', 'mrd-audio-router.exe');
    this.capture = null;
    this.baselineMuted = null;
    this.lastError = null;
    this.appliedDestination = null;
    this.captureEnabled = false;
    this.remainder = Buffer.alloc(0);
    this.wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
    this.wss.on('connection', ws => {
      ws.send(JSON.stringify({ type: 'format', codec: 'pcm_s16le', sampleRate: 48000, channels: 2 }));
      if (!this.available) {
        ws.send(JSON.stringify({ type: 'error', message: 'MRD Audio Router helper is not installed.' }));
        ws.close(1011, 'Audio router unavailable');
      }
    });
  }

  get available() {
    return process.platform === 'win32' && fssync.existsSync(this.helperPath);
  }

  get status() {
    return {
      helperAvailable: this.available,
      helperPath: this.helperPath,
      routingApplied: this.available && this.lastError == null && this.appliedDestination != null,
      appliedDestination: this.appliedDestination,
      streaming: Boolean(this.capture),
      captureEnabled: this.captureEnabled,
      clients: this.wss.clients.size,
      lastError: this.lastError,
      format: { codec: 'pcm_s16le', sampleRate: 48000, channels: 2 }
    };
  }

  handleUpgrade(req, socket, head) {
    this.wss.handleUpgrade(req, socket, head, ws => this.wss.emit('connection', ws, req));
  }

  async apply(destination, { capture = true } = {}) {
    this.lastError = null;
    this.captureEnabled = Boolean(capture);
    if (!this.available) {
      this.stopCapture();
      this.appliedDestination = null;
      return this.status;
    }

    try {
      if (destination == null) {
        this.stopCapture();
        if (this.baselineMuted != null) await this.setMuted(this.baselineMuted);
        this.baselineMuted = null;
        this.appliedDestination = null;
        this.captureEnabled = false;
        return this.status;
      }

      if (this.baselineMuted == null) this.baselineMuted = await this.getMuted();

      if (destination === 'desktop') {
        this.stopCapture();
        await this.setMuted(false);
      } else if (destination === 'mobile') {
        if (capture) this.startCapture(); else this.stopCapture();
        await this.setMuted(true);
      } else if (destination === 'both') {
        if (capture) this.startCapture(); else this.stopCapture();
        await this.setMuted(false);
      } else if (destination === 'muted') {
        this.stopCapture();
        await this.setMuted(true);
      } else {
        throw new Error(`Unsupported audio destination: ${destination}`);
      }

      this.appliedDestination = destination;
    } catch (error) {
      this.lastError = error.message;
      this.appliedDestination = null;
      this.stopCapture();
    }
    return this.status;
  }

  async shutdown() {
    this.stopCapture();
    if (this.available && this.baselineMuted != null) {
      try { await this.setMuted(this.baselineMuted); } catch {}
    }
    this.baselineMuted = null;
    this.appliedDestination = null;
    this.captureEnabled = false;
    for (const ws of this.wss.clients) {
      try { ws.close(1001, 'MRD shutting down'); } catch {}
    }
  }

  async getMuted() {
    const { stdout } = await execFileAsync(this.helperPath, ['get-mute'], { windowsHide: true, timeout: 4000 });
    const value = stdout.trim();
    if (value !== '0' && value !== '1') throw new Error(`Unexpected audio helper response: ${value}`);
    return value === '1';
  }

  async setMuted(muted) {
    await execFileAsync(this.helperPath, ['mute', muted ? '1' : '0'], { windowsHide: true, timeout: 4000 });
  }

  startCapture() {
    if (this.capture || !this.available) return;
    this.remainder = Buffer.alloc(0);
    const child = spawn(this.helperPath, ['capture'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.capture = child;

    child.stdout.on('data', chunk => this.broadcastPcm(chunk));
    child.stderr.on('data', chunk => {
      const message = chunk.toString('utf8').trim();
      if (message) console.error('[MRD audio]', message);
    });
    child.on('error', error => {
      this.lastError = error.message;
      if (this.capture === child) this.capture = null;
    });
    child.on('exit', code => {
      if (this.capture === child) this.capture = null;
      if (code && code !== 0) this.lastError = `Audio capture exited with code ${code}`;
    });
  }

  stopCapture() {
    if (!this.capture) return;
    const child = this.capture;
    this.capture = null;
    try { child.kill(); } catch {}
    this.remainder = Buffer.alloc(0);
  }

  broadcastPcm(chunk) {
    let data = this.remainder.length ? Buffer.concat([this.remainder, chunk]) : chunk;
    const aligned = data.length - (data.length % FRAME_BYTES);
    if (aligned <= 0) {
      this.remainder = Buffer.from(data);
      return;
    }
    const pcm = data.subarray(0, aligned);
    this.remainder = aligned < data.length ? Buffer.from(data.subarray(aligned)) : Buffer.alloc(0);
    for (const ws of this.wss.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(pcm, { binary: true });
    }
  }
}
