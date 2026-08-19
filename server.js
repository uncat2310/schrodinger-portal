import http from 'http';
import fs from 'fs';
import path from 'path';
import dns from 'dns/promises';
import net from 'net';
import https from 'https';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { escapeHtml, escapeAttribute, safeJsonForHtmlScript } from './shared/escape.js';
import { getGreeting } from './shared/greeting.js';
import { getProjectNativeFavicon } from './shared/favicon.js';
import { parseHttpUrl } from './shared/url.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const DIST_DIR = path.join(__dirname, 'dist');
const INDEX_FILE = path.join(DIST_DIR, 'index.html');
const CORS_ORIGIN = (process.env.CORS_ORIGIN || '').trim();
const ALLOW_INSECURE_TLS = String(process.env.ALLOW_INSECURE_TLS || 'false').toLowerCase() === 'true';

const MAX_BODY_BYTES = 32 * 1024;
const MAX_BATCH_SIZE = 30;
const MAX_ID_LENGTH = 64;
const MAX_URL_LENGTH = 2048;
const PROBE_CONCURRENCY = 8;
const HEALTH_CACHE_MAX = 200;
const HEALTH_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_REDIRECTS = 3;

if (!fs.existsSync(INDEX_FILE)) {
  console.error('Production build not found. Run npm run build first.');
  process.exit(1);
}

/**
 * 开源公开演示 Demo 矩阵（无私有域名）
 */
const PUBLIC_DEMO_PROJECTS = [
  {
    id: 'p-github',
    categoryId: 'services',
    title: 'GitHub 代码中枢',
    customWanUrl: 'https://github.com',
    pingEnabled: true
  },
  {
    id: 'p-vercel',
    categoryId: 'services',
    title: 'Vercel 部署平台',
    customWanUrl: 'https://vercel.com',
    pingEnabled: true
  },
  {
    id: 'p-cloudflare',
    categoryId: 'services',
    title: 'Cloudflare 边缘网络',
    customWanUrl: 'https://cloudflare.com',
    pingEnabled: true
  }
];

function loadServerProjects() {
  const customConfigPath = path.join(__dirname, 'config', 'projects.json');
  if (fs.existsSync(customConfigPath)) {
    try {
      const content = fs.readFileSync(customConfigPath, 'utf-8');
      const data = JSON.parse(content);
      if (Array.isArray(data) && data.length > 0) {
        return data;
      }
    } catch {
      // 容错降级到公开 Demo
    }
  }
  return PUBLIC_DEMO_PROJECTS;
}

function getTrustedProjectMap() {
  const map = new Map();
  for (const project of loadServerProjects()) {
    if (project?.id && typeof project.id === 'string') {
      map.set(project.id, project);
    }
  }
  return map;
}

/* -------------------------------------------------------------------------- */
/* SSRF 防护：禁止探测内网 / loopback / metadata                               */
/* -------------------------------------------------------------------------- */

function normalizeIp(ip) {
  const value = String(ip || '').toLowerCase();
  if (value.startsWith('::ffff:')) {
    return value.slice(7);
  }
  return value;
}

function isBlockedIp(ip) {
  const normalized = normalizeIp(ip);
  const version = net.isIP(normalized);
  if (!version) return true;

  if (version === 4) {
    const parts = normalized.split('.').map(Number);
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 0) return true;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }

  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe80')) return true;
  if (normalized.startsWith('ff')) return true;
  return false;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata'
]);

async function validateProbeTarget(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > MAX_URL_LENGTH) {
    return { ok: false, error: 'INVALID_URL' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'INVALID_URL' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, error: 'INVALID_PROTOCOL' };
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    !hostname ||
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    return { ok: false, error: 'BLOCKED_HOST' };
  }

  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      return { ok: false, error: 'BLOCKED_IP' };
    }
    return { ok: true, url: parsed.href };
  }

  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    return { ok: false, error: 'DNS_FAILED' };
  }

  if (!addresses.length) {
    return { ok: false, error: 'DNS_FAILED' };
  }

  for (const entry of addresses) {
    if (isBlockedIp(entry.address)) {
      return { ok: false, error: 'BLOCKED_IP' };
    }
  }

  return { ok: true, url: parsed.href };
}

/* -------------------------------------------------------------------------- */
/* 健康探针                                                                   */
/* -------------------------------------------------------------------------- */

const HEALTH_CACHE = new Map();
let healthCheckRunning = false;

function pruneHealthCache() {
  const now = Date.now();
  for (const [key, value] of HEALTH_CACHE.entries()) {
    if (now - (value.lastChecked || 0) > HEALTH_CACHE_TTL_MS) {
      HEALTH_CACHE.delete(key);
    }
  }
  while (HEALTH_CACHE.size > HEALTH_CACHE_MAX) {
    const oldest = HEALTH_CACHE.keys().next().value;
    HEALTH_CACHE.delete(oldest);
  }
}

function setHealthCache(id, payload) {
  pruneHealthCache();
  if (HEALTH_CACHE.size >= HEALTH_CACHE_MAX && !HEALTH_CACHE.has(id)) {
    const oldest = HEALTH_CACHE.keys().next().value;
    HEALTH_CACHE.delete(oldest);
  }
  HEALTH_CACHE.set(id, payload);
}

function isValidId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH;
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => run());
  await Promise.all(runners);
  return results;
}

function probeHttpEndpoint(targetUrl, options = {}) {
  const {
    timeoutMs = 2800,
    redirectCount = 0,
    trusted = false
  } = options;

  return (async () => {
    if (!trusted) {
      const validation = await validateProbeTarget(targetUrl);
      if (!validation.ok) {
        return { alive: false, error: validation.error };
      }
      targetUrl = validation.url;
    } else {
      const parsed = parseHttpUrl(targetUrl, { maxLength: MAX_URL_LENGTH });
      if (!parsed) {
        return { alive: false, error: 'INVALID_URL' };
      }
      targetUrl = parsed.href;
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

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
            rejectUnauthorized: !ALLOW_INSECURE_TLS,
            headers: {
              'User-Agent': 'SchrodingerPortal/1.0 (+health-probe)',
              Accept: '*/*'
            }
          },
          (res) => {
            const status = res.statusCode || 0;
            const location = res.headers.location;

            if (
              status >= 300 &&
              status < 400 &&
              location &&
              redirectCount < MAX_REDIRECTS
            ) {
              res.resume();
              let nextUrl;
              try {
                nextUrl = new URL(location, parsed).href;
              } catch {
                finish({ alive: false, error: 'INVALID_REDIRECT', statusCode: status });
                return;
              }

              // 跳转目标一律重新校验，防止跳进内网
              probeHttpEndpoint(nextUrl, {
                timeoutMs,
                redirectCount: redirectCount + 1,
                trusted: false
              }).then(finish);
              return;
            }

            // 收到 headers 后即可丢弃 body，避免下载整页
            res.resume();
            const latency = Date.now() - startTime;

            // 2xx/3xx/4xx：服务可访问；5xx：异常但可达；其余视为离线
            if (status >= 200 && status < 500) {
              finish({ alive: true, latency, statusCode: status });
              return;
            }
            if (status >= 500 && status < 600) {
              finish({ alive: false, latency, statusCode: status, error: 'HTTP_5XX' });
              return;
            }
            finish({ alive: false, statusCode: status, error: 'HTTP_ERROR' });
          }
        );

        req.on('timeout', () => {
          req.destroy();
          finish({ alive: false, error: 'TIMEOUT' });
        });

        req.on('error', (err) => {
          const code = err?.code || '';
          if (code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
            finish({ alive: false, error: 'TLS_ERROR' });
            return;
          }
          finish({ alive: false, error: err.message || 'ERR_NETWORK' });
        });

        req.end();
      } catch {
        finish({ alive: false, error: 'INVALID_URL' });
      }
    });
  })();
}

async function runBackgroundHealthCheck() {
  if (healthCheckRunning) return;
  healthCheckRunning = true;
  try {
    const projects = loadServerProjects().filter((p) => p.customWanUrl && p.pingEnabled !== false);
    await mapPool(projects, PROBE_CONCURRENCY, async (proj) => {
      const res = await probeHttpEndpoint(proj.customWanUrl, {
        timeoutMs: 2500,
        trusted: true
      });
      setHealthCache(proj.id, {
        alive: Boolean(res.alive),
        latency: res.latency || null,
        statusCode: res.statusCode || null,
        error: res.error || null,
        lastChecked: Date.now()
      });
    });
  } finally {
    healthCheckRunning = false;
    pruneHealthCache();
  }
}

runBackgroundHealthCheck();
setInterval(() => {
  runBackgroundHealthCheck();
}, 12000);

/* -------------------------------------------------------------------------- */
/* SSR                                                                       */
/* -------------------------------------------------------------------------- */

function resolveFaviconForProject(project, targetUrl) {
  return getProjectNativeFavicon(targetUrl || project.customWanUrl);
}

function renderCardHtml(project) {
  const rawUrl = project.customWanUrl || '';
  const parsed = parseHttpUrl(rawUrl, { maxLength: MAX_URL_LENGTH });
  const targetUrl = parsed ? parsed.href : '#';
  const iconSrc = resolveFaviconForProject(project, parsed ? parsed.href : '');
  const title = project.title || '未命名服务';

  const health = HEALTH_CACHE.get(project.id);
  let statusClass = 'checking';
  let statusLabel = '检测中';
  if (health) {
    if (health.alive) {
      statusClass = 'online';
      statusLabel = health.latency ? `在线 ${health.latency}ms` : '在线';
    } else {
      statusClass = 'offline';
      statusLabel = '不可用';
    }
  }

  const safeId = escapeAttribute(project.id || '');
  const safeTitle = escapeHtml(title);
  const safeTitleAttr = escapeAttribute(title);
  const safeUrl = escapeAttribute(targetUrl);
  const safeIcon = escapeAttribute(iconSrc);

  return `
    <div class="project-card" data-id="${safeId}" data-url="${safeUrl}">
      <div class="card-top">
        <div class="card-identity">
          <div class="card-icon-box">
            <img src="${safeIcon}" alt="${safeTitleAttr}" class="card-favicon-img" loading="eager" decoding="async" onerror="this.onerror=null;this.src='/favicon.svg';" />
          </div>
          <div class="card-title" title="${safeTitleAttr}">${safeTitle}</div>
        </div>
        <div class="card-status-badge ${statusClass}" id="status-${safeId}">
          <span class="status-dot"></span>
          <span class="status-text">${escapeHtml(statusLabel)}</span>
        </div>
      </div>

      <div class="card-footer">
        <div class="card-manage-actions">
          <button class="card-action-btn copy-btn" data-url="${safeUrl}" title="复制直达链接">
            <svg class="btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
          <button class="card-action-btn edit-btn" data-id="${safeId}" title="编辑服务">
            <svg class="btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="card-action-btn delete-btn" data-id="${safeId}" title="删除服务">
            <svg class="btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
        <a href="${safeUrl}" target="_blank" rel="noreferrer" class="btn-launch" title="直达打开服务">
          <span>直达</span>
          <svg class="btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        </a>
      </div>
    </div>
  `;
}

function renderPageSSR(htmlTemplate) {
  const projects = loadServerProjects();

  let onlineCount = 0;
  let checkedCount = 0;
  projects.forEach((p) => {
    const h = HEALTH_CACHE.get(p.id);
    if (!h) return;
    checkedCount += 1;
    if (h.alive) onlineCount += 1;
  });
  const onlineDisplay = checkedCount === 0 ? '—' : String(onlineCount);

  const now = new Date();
  const hours = (now.getUTCHours() + 8) % 24;
  const { greeting, icon } = getGreeting(hours);
  const timeStr = `${String(hours).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${days[now.getDay()]}`;

  const poolHtml = `
    <div class="category-section">
      <div class="section-header">
        <div class="section-header-inline">
          <h2 class="sec-name">服务列表</h2>
          <button class="section-refresh-btn" id="refreshPingBtn" title="重新探测服务状态">
            <svg class="btn-svg spin-on-click" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6M1 20v-6h6"></path>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
          <div class="stat-badge">
            <span class="stat-label">服务总计</span>
            <span class="stat-num" id="metricTotal">${projects.length}</span>
          </div>
          <div class="stat-badge">
            <span class="stat-label">运行正常</span>
            <span class="stat-num online" id="metricOnline">${escapeHtml(onlineDisplay)}</span>
          </div>
        </div>
      </div>
      <div class="cards-grid">
        ${projects.map(renderCardHtml).join('')}
      </div>
    </div>
  `;

  const injectedScript = `<script id="initial-projects-data" type="application/json">${safeJsonForHtmlScript(projects)}</script>`;
  const poolReplacement = `<section class="project-pool" id="projectPool">${poolHtml}</section>${injectedScript}`;

  // 兼容 dist 中 CRLF / LF
  const normalized = htmlTemplate.replace(/\r\n/g, '\n');

  return normalized
    .replace('<span class="greeting-icon" id="greetingIcon">✨</span>', `<span class="greeting-icon" id="greetingIcon">${icon}</span>`)
    .replace('<span class="greeting-text" id="greetingText">欢迎回来</span>', `<span class="greeting-text" id="greetingText">${escapeHtml(greeting)}</span>`)
    .replace('<span class="clock-time" id="clockTime">00:00:00</span>', `<span class="clock-time" id="clockTime">${timeStr}</span>`)
    .replace('<span class="clock-date" id="clockDate">2026年8月14日 星期五</span>', `<span class="clock-date" id="clockDate">${escapeHtml(dateStr)}</span>`)
    .replace(
      /<section class="project-pool" id="projectPool">\s*(?:<!--\s*Rendered dynamically\s*-->\s*)?<\/section>/,
      poolReplacement
    );
}

/* -------------------------------------------------------------------------- */
/* HTTP 服务                                                                  */
/* -------------------------------------------------------------------------- */

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const COMPRESSIBLE_EXT = new Set(['.html', '.js', '.css', '.svg', '.json', '.txt', '.xml', '.ico']);
const fileCache = new Map();

function getCachedFile(filePath) {
  if (fileCache.has(filePath)) {
    return fileCache.get(filePath);
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const data = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const shouldCompress = COMPRESSIBLE_EXT.has(ext) && data.length > 256;
    const entry = {
      raw: data,
      gzip: shouldCompress ? zlib.gzipSync(data) : null,
      text: data.toString('utf-8')
    };
    fileCache.set(filePath, entry);
    return entry;
  }
  return null;
}

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  // 不强制 CSP，避免破坏现有 inline onerror / style 行为
}

function applyCors(req, res) {
  if (!CORS_ORIGIN) return false;
  const requestOrigin = req.headers.origin;
  if (CORS_ORIGIN === '*') {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (requestOrigin && requestOrigin === CORS_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
    res.setHeader('Vary', 'Origin');
  } else {
    return false;
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return true;
}

async function parseJsonBody(req, limitBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > limitBytes) {
      const err = new Error('BODY_TOO_LARGE');
      err.code = 'BODY_TOO_LARGE';
      throw err;
    }
    chunks.push(buf);
  }

  const body = Buffer.concat(chunks).toString('utf-8');
  if (!body) return {};
  return JSON.parse(body);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function resolveSafeStaticPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const normalized = path.normalize(decoded).replace(/^([/\\])+/, path.sep);
  const resolved = path.resolve(DIST_DIR, `.${normalized}`);
  const relative = path.relative(DIST_DIR, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return resolved;
}

function cacheControlFor(pathname, ext) {
  if (pathname.startsWith('/assets/')) {
    return 'public, max-age=31536000, immutable';
  }
  if (pathname === '/' || pathname === '/index.html' || ext === '.html') {
    return 'public, max-age=0, must-revalidate';
  }
  if (
    pathname === '/favicon.svg' ||
    pathname === '/favicon.ico' ||
    pathname === '/favicon.png' ||
    pathname === '/avatar.jpg'
  ) {
    return 'public, max-age=86400, must-revalidate';
  }
  if (ext === '.svg' || ext === '.ico' || ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
    return 'public, max-age=604800, must-revalidate';
  }
  return 'public, max-age=0, must-revalidate';
}

async function resolveProbeJobs(body) {
  const trustedMap = getTrustedProjectMap();
  const jobs = [];
  const seen = new Set();

  const pushJob = (id, url, trusted) => {
    if (!isValidId(id) || seen.has(id)) return;
    if (typeof url !== 'string' || url.length === 0 || url.length > MAX_URL_LENGTH) return;
    seen.add(id);
    jobs.push({ id, url, trusted });
  };

  if (Array.isArray(body.ids)) {
    for (const id of body.ids.slice(0, MAX_BATCH_SIZE)) {
      const project = trustedMap.get(id);
      if (project?.customWanUrl) {
        pushJob(id, project.customWanUrl, true);
      }
    }
  }

  if (Array.isArray(body.items)) {
    for (const item of body.items.slice(0, MAX_BATCH_SIZE)) {
      if (!item || typeof item !== 'object') continue;
      const id = item.id;
      if (!isValidId(id) || seen.has(id)) continue;

      const trusted = trustedMap.get(id);
      if (trusted?.customWanUrl) {
        pushJob(id, trusted.customWanUrl, true);
        continue;
      }

      if (typeof item.url === 'string') {
        pushJob(id, item.url, false);
      }
    }
  }

  return jobs.slice(0, MAX_BATCH_SIZE);
}

const server = http.createServer(async (req, res) => {
  applySecurityHeaders(res);
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    if (!CORS_ORIGIN) {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(204);
    res.end();
    return;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }

  const pathname = parsedUrl.pathname;

  try {
    if (pathname === '/api/info') {
      sendJson(res, 200, {
        status: 'ok',
        ssr: true,
        cachedCount: HEALTH_CACHE.size
      });
      return;
    }

    // 批量健康探针：优先使用服务端可信项目 ID，自定义 URL 必须经过 SSRF 校验
    if (pathname === '/api/ping-batch' && req.method === 'POST') {
      let body;
      try {
        body = await parseJsonBody(req);
      } catch (err) {
        if (err?.code === 'BODY_TOO_LARGE') {
          sendJson(res, 413, { error: 'BODY_TOO_LARGE' });
          return;
        }
        sendJson(res, 400, { error: 'INVALID_JSON' });
        return;
      }

      const jobs = await resolveProbeJobs(body || {});
      const results = {};

      await mapPool(jobs, PROBE_CONCURRENCY, async (job) => {
        const probeResult = await probeHttpEndpoint(job.url, {
          timeoutMs: 3000,
          trusted: job.trusted
        });
        const entry = {
          alive: Boolean(probeResult.alive),
          latency: probeResult.latency || null,
          statusCode: probeResult.statusCode || null,
          error: probeResult.error || null,
          lastChecked: Date.now()
        };
        results[job.id] = entry;
        if (job.trusted || entry.alive || entry.error !== 'BLOCKED_IP') {
          setHealthCache(job.id, entry);
        }
      });

      sendJson(res, 200, results);
      return;
    }

    if (pathname === '/api/ping-all' && req.method === 'GET') {
      pruneHealthCache();
      const output = {};
      for (const [key, value] of HEALTH_CACHE.entries()) {
        output[key] = value;
      }
      runBackgroundHealthCheck();
      sendJson(res, 200, output);
      return;
    }

    // 单服务探针：优先 id（可信配置）；url 参数必须通过 SSRF 校验
    if (pathname === '/api/ping' && req.method === 'GET') {
      const id = parsedUrl.searchParams.get('id');
      const targetUrl = parsedUrl.searchParams.get('url');

      if (id && isValidId(id)) {
        const project = getTrustedProjectMap().get(id);
        if (project?.customWanUrl) {
          const httpResult = await probeHttpEndpoint(project.customWanUrl, {
            timeoutMs: 3000,
            trusted: true
          });
          const entry = {
            alive: Boolean(httpResult.alive),
            latency: httpResult.latency || null,
            statusCode: httpResult.statusCode || null,
            error: httpResult.error || null,
            lastChecked: Date.now()
          };
          setHealthCache(id, entry);
          sendJson(res, 200, entry);
          return;
        }
      }

      if (targetUrl) {
        const httpResult = await probeHttpEndpoint(targetUrl, {
          timeoutMs: 3000,
          trusted: false
        });
        sendJson(res, 200, {
          alive: Boolean(httpResult.alive),
          latency: httpResult.latency || null,
          statusCode: httpResult.statusCode || null,
          error: httpResult.error || null,
          lastChecked: Date.now()
        });
        return;
      }

      sendJson(res, 400, { alive: false, error: 'MISSING_TARGET' });
      return;
    }

    if (pathname === '/' || pathname === '/index.html') {
      const indexEntry = getCachedFile(INDEX_FILE);
      if (!indexEntry) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Missing index.html');
        return;
      }

      const ssrHtml = renderPageSSR(indexEntry.text);
      const acceptEncoding = req.headers['accept-encoding'] || '';
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');

      if (acceptEncoding.includes('gzip')) {
        const gzipped = zlib.gzipSync(Buffer.from(ssrHtml, 'utf-8'));
        res.writeHead(200, {
          'Content-Encoding': 'gzip',
          Vary: 'Accept-Encoding'
        });
        res.end(gzipped);
      } else {
        res.writeHead(200);
        res.end(ssrHtml);
      }
      return;
    }

    let filePath = resolveSafeStaticPath(pathname);
    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      // SPA fallback 仅回退到 index.html，不暴露仓库根目录
      filePath = INDEX_FILE;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const fileEntry = getCachedFile(filePath);

    if (!fileEntry) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }

    res.setHeader('Cache-Control', cacheControlFor(pathname, ext));
    const acceptEncoding = req.headers['accept-encoding'] || '';

    if (acceptEncoding.includes('gzip') && fileEntry.gzip) {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Encoding': 'gzip',
        Vary: 'Accept-Encoding'
      });
      res.end(fileEntry.gzip);
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(fileEntry.raw);
    }
  } catch (err) {
    console.error('Request error:', err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'INTERNAL_ERROR' });
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Schrödinger's Portal listening on :${PORT}`);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
