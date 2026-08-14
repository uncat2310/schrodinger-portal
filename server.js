import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import net from 'net';
import https from 'https';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const DIST_DIR = fs.existsSync(path.join(__dirname, 'dist'))
  ? path.join(__dirname, 'dist')
  : __dirname;

/**
 * TCP 端口轻量探测
 */
function probeTcpSocket(host = '127.0.0.1', port, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const socket = new net.Socket();
    let settled = false;

    const finalize = (alive, err = null) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve({
        alive,
        latency: alive ? Date.now() - startTime : null,
        error: err
      });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finalize(true));
    socket.once('timeout', () => finalize(false, 'TIMEOUT'));
    socket.once('error', (e) => finalize(false, e.code || 'ERR_CONN'));

    socket.connect(port, host);
  });
}

/**
 * 端到端 HTTP 服务健康探测
 */
function probeHttpEndpoint(targetUrl, timeoutMs = 2500) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(targetUrl);
      const isHttps = parsed.protocol === 'https:';
      const client = isHttps ? https : http;
      const startTime = Date.now();

      const req = client.request(
        parsed,
        {
          method: 'GET',
          timeout: timeoutMs,
          rejectUnauthorized: false,
          headers: {
            'User-Agent': 'Schrodinger-HealthProbe/2.0',
            'Accept': '*/*'
          }
        },
        (res) => {
          const latency = Date.now() - startTime;
          const status = res.statusCode;
          const isAlive = status >= 200 && status < 500;

          res.resume();
          resolve({
            alive: isAlive,
            latency: isAlive ? latency : null,
            statusCode: status
          });
        }
      );

      req.on('timeout', () => {
        req.destroy();
        resolve({ alive: false, error: 'TIMEOUT' });
      });

      req.on('error', (err) => {
        resolve({ alive: false, error: err.message || 'ERR_NETWORK' });
      });

      req.end();
    } catch {
      resolve({ alive: false, error: 'INVALID_URL' });
    }
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

// 内存级静态文件缓存，实现毫秒级响应
const fileCache = new Map();

function getCachedFile(filePath) {
  if (fileCache.has(filePath)) {
    return fileCache.get(filePath);
  }
  if (fs.existsSync(filePath)) {
    const data = fs.readFileSync(filePath);
    const gzipped = zlib.gzipSync(data);
    const entry = { raw: data, gzip: gzipped };
    fileCache.set(filePath, entry);
    return entry;
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // 系统健康 API
  if (pathname === '/api/info') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // 存活探针 API
  if (pathname === '/api/ping') {
    const targetUrl = parsedUrl.searchParams.get('url');
    const targetPort = parseInt(parsedUrl.searchParams.get('port'), 10);

    if (targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
      const httpResult = await probeHttpEndpoint(targetUrl);
      if (httpResult.alive) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
        res.end(JSON.stringify(httpResult));
        return;
      }
    }

    if (targetPort && !isNaN(targetPort)) {
      const tcpResult = await probeTcpSocket('127.0.0.1', targetPort);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
      res.end(JSON.stringify(tcpResult));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(JSON.stringify({ alive: false, error: 'OFFLINE' }));
    return;
  }

  // 静态资源秒开服务（带内存缓存与 Gzip 压缩）
  let filePath = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const fileEntry = getCachedFile(filePath);

  if (!fileEntry) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  // HTTP 高速缓存策略：静态哈希资源 1 年强缓存，HTML 协商缓存
  if (pathname.startsWith('/assets/') || ext === '.svg' || ext === '.ico') {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  }

  const acceptEncoding = req.headers['accept-encoding'] || '';

  if (acceptEncoding.includes('gzip')) {
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Encoding': 'gzip',
      'Vary': 'Accept-Encoding'
    });
    res.end(fileEntry.gzip);
  } else {
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(fileEntry.raw);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 High-Speed Schrödinger Matrix listening on :${PORT}`);
});
