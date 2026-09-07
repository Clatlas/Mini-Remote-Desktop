import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const HOST = process.env.PC_REMOTE_HOST || '127.0.0.1';
const PORT = Number(process.env.PC_REMOTE_PORT || 8787);
const PC_NAME = process.env.PC_REMOTE_NAME || os.hostname();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

const clients = new Set();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/api/config') {
      return sendJson(res, 200, {
        pcName: PC_NAME,
        powerControlsEnabled: false,
        desktop: { enabled: false, path: '/guacamole/' },
        browser: { enabled: false, phase: 'browser-engine-next' }
      });
    }

    if (url.pathname === '/api/status') {
      return sendJson(res, 200, getStatus());
    }

    if (url.pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive'
      });
      res.write(`event: status\ndata: ${JSON.stringify(getStatus())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (url.pathname.startsWith('/api/power/')) {
      return sendJson(res, 501, { ok: false, error: 'Power controls are disabled in the repository baseline.' });
    }

    if (url.pathname === '/api/browser/session') {
      return sendJson(res, 501, { ok: false, error: 'PC-powered Chromium transport is the next implementation milestone.' });
    }

    return serveStatic(url.pathname, req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`MRD baseline listening on http://${HOST}:${PORT}`);
});

setInterval(() => {
  const payload = `event: status\ndata: ${JSON.stringify(getStatus())}\n\n`;
  for (const client of clients) client.write(payload);
}, 2500).unref();

function getStatus() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return {
    name: PC_NAME,
    state: 'onlineUnlocked',
    locked: false,
    online: true,
    at: Date.now(),
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      uptimeSeconds: Math.floor(os.uptime())
    },
    metrics: {
      cpuPercent: 0,
      memoryPercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
      memoryUsedGb: roundGb(totalMem - freeMem),
      memoryTotalGb: roundGb(totalMem)
    },
    detector: 'repository baseline',
    powerControlsEnabled: false
  };
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
      'Referrer-Policy': 'no-referrer'
    });
    if (req.method !== 'HEAD') res.end(data); else res.end();
  } catch {
    const data = await fs.readFile(path.join(PUBLIC_DIR, 'index.html'));
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
    res.end(data);
  }
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
