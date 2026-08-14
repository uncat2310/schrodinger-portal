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
 * 用户专属 8 大自建服务矩阵 (直接抓取各网站自身原生 Favicon)
 */
const SERVER_EXCLUSIVE_PROJECTS = [
  {
    id: 'p-traffic',
    categoryId: 'services',
    title: '香港流量监控面板',
    customWanUrl: 'https://traffic.as4837.de',
    pingEnabled: true
  },
  {
    id: 'p-tz',
    categoryId: 'services',
    title: 'Komari 探针监控',
    customWanUrl: 'https://tz.as4837.de',
    pingEnabled: true
  },
  {
    id: 'p-blog',
    categoryId: 'services',
    title: '个人独立博客',
    customWanUrl: 'https://blog.as4837.de',
    pingEnabled: true
  },
  {
    id: 'p-vault',
    categoryId: 'services',
    title: 'Vaultwarden 密码库',
    customWanUrl: 'https://v.as4837.de',
    pingEnabled: true
  },
  {
    id: 'p-clouddrive',
    categoryId: 'services',
    title: 'CloudDrive2 云盘中枢',
    customWanUrl: 'https://cd2.as4837.de',
    pingEnabled: true
  },
  {
    id: 'p-gallery',
    categoryId: 'services',
    title: 'Local Image Gallery',
    customWanUrl: 'https://img.as4837.de/_gallery/',
    pingEnabled: true
  },
  {
    id: 'p-catbox',
    categoryId: 'services',
    title: 'Catbox 图床与图像服务',
    customWanUrl: 'https://catbox.as4837.de',
    pingEnabled: true
  },
  {
    id: 'p-qb',
    categoryId: 'services',
    title: 'qBittorrent 离线下载',
    customWanUrl: 'https://qb.as4837.de',
    pingEnabled: true
  }
];

/**
 * 开源公开演示 Demo 矩阵 (用于脱敏环境)
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

/**
 * 提取目标网站原生标签栏 Favicon 地址
 */
function getProjectNativeFavicon(targetUrl) {
  if (!targetUrl) return '/favicon.png';
  try {
    const parsed = new URL(targetUrl);
    const origin = parsed.origin;
    const hostname = parsed.hostname;

    if (hostname.includes('traffic')) return `${origin}/favicon.svg`;
    if (hostname.includes('tz.')) return `${origin}/favicon.ico`;
    if (hostname.includes('blog.')) return `${origin}/favicon.ico`;
    if (hostname.includes('v.')) return `${origin}/images/favicon-32x32.png`;
    if (hostname.includes('cd2.')) return `${origin}/public/favicon.png`;
    if (hostname.includes('img.')) return `${origin}/favicon.ico`;
    if (hostname.includes('catbox.')) return `${origin}/static/favicon.svg`;
    if (hostname.includes('qb.')) return `${origin}/icons/qbittorrent-tray.svg`;

    return `https://icons.duckduckgo.com/ip3/${hostname}.ico`;
  } catch {
    return '/favicon.png';
  }
}

/**
 * 服务端渲染助手函数 (SSR Engine)
 */
function getGreeting(hours) {
  if (hours >= 5 && hours < 9) return { greeting: '清晨好，新的一天', icon: '🌅' };
  if (hours >= 9 && hours < 12) return { greeting: '上午好，专注当下', icon: '☀️' };
  if (hours >= 12 && hours < 14) return { greeting: '午间好，享受静谧时光', icon: '☕' };
  if (hours >= 14 && hours < 18) return { greeting: '下午好，保持高效', icon: '💻' };
  if (hours >= 18 && hours < 23) return { greeting: '晚上好，一切安然有序', icon: '🌙' };
  return { greeting: '夜深了，系统持续守护', icon: '🌌' };
}

function renderCardHtml(project) {
  const targetUrl = project.customWanUrl || '#';
  const iconSrc = getProjectNativeFavicon(targetUrl);

  return `
    <div class="project-card" data-id="${project.id}" data-url="${targetUrl}">
      <div class="card-top">
        <div class="card-identity">
          <div class="card-icon-box">
            <img src="${iconSrc}" alt="${project.title}" class="card-favicon-img" onerror="this.onerror=null;this.src='/favicon.png';" />
          </div>
          <div class="card-title" title="${project.title}">${project.title}</div>
        </div>
        <div class="card-status-badge checking" id="status-${project.id}">
          <span class="status-dot"></span>
          <span class="status-text">探针中</span>
        </div>
      </div>

      <div class="card-footer">
        <div class="card-manage-actions">
          <button class="card-action-btn copy-btn" data-url="${targetUrl}" title="复制直达链接">
            <svg class="btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
          <button class="card-action-btn edit-btn" data-id="${project.id}" title="编辑服务">
            <svg class="btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="card-action-btn delete-btn" data-id="${project.id}" title="删除服务">
            <svg class="btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
        <a href="${targetUrl}" target="_blank" rel="noreferrer" class="btn-launch" title="直达打开服务">
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

function renderPageSSR(htmlTemplate, host = '') {
  const isOwner = host.includes('as4837.de');
  const projects = isOwner ? SERVER_EXCLUSIVE_PROJECTS : PUBLIC_DEMO_PROJECTS;

  const now = new Date();
  const hours = (now.getUTCHours() + 8) % 24; // CST 北京时间
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
            <span class="stat-num online" id="metricOnline">${projects.length}</span>
          </div>
        </div>
      </div>
      <div class="cards-grid">
        ${projects.map(renderCardHtml).join('')}
      </div>
    </div>
  `;

  return htmlTemplate
    .replace('<span class="greeting-icon" id="greetingIcon">✨</span>', `<span class="greeting-icon" id="greetingIcon">${icon}</span>`)
    .replace('<span class="greeting-text" id="greetingText">欢迎回来</span>', `<span class="greeting-text" id="greetingText">${greeting}</span>`)
    .replace('<span class="clock-time" id="clockTime">00:00:00</span>', `<span class="clock-time" id="clockTime">${timeStr}</span>`)
    .replace('<span class="clock-date" id="clockDate">2026年8月14日 星期五</span>', `<span class="clock-date" id="clockDate">${dateStr}</span>`)
    .replace(
      '<section class="project-pool" id="projectPool">\n        <!-- Rendered dynamically -->\n      </section>',
      `<section class="project-pool" id="projectPool">${poolHtml}</section>`
    )
    .replace(
      '<section class="project-pool" id="projectPool"></section>',
      `<section class="project-pool" id="projectPool">${poolHtml}</section>`
    );
}

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
    const entry = { raw: data, gzip: gzipped, text: data.toString('utf-8') };
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
    res.end(JSON.stringify({ status: 'ok', ssr: true }));
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

  // 服务端渲染 SSR 路由 (GET / 或 GET /index.html)
  if (pathname === '/' || pathname === '/index.html') {
    const indexPath = path.join(DIST_DIR, 'index.html');
    const indexEntry = getCachedFile(indexPath);

    if (indexEntry) {
      const ssrHtml = renderPageSSR(indexEntry.text, req.headers.host || '');
      const acceptEncoding = req.headers['accept-encoding'] || '';

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');

      if (acceptEncoding.includes('gzip')) {
        const gzipped = zlib.gzipSync(Buffer.from(ssrHtml, 'utf-8'));
        res.writeHead(200, {
          'Content-Encoding': 'gzip',
          'Vary': 'Accept-Encoding'
        });
        res.end(gzipped);
      } else {
        res.writeHead(200);
        res.end(ssrHtml);
      }
      return;
    }
  }

  // 静态资源秒开服务（带内存缓存与 Gzip 压缩）
  let filePath = path.join(DIST_DIR, pathname);
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

  // HTTP 高速缓存策略：静态哈希资源 1 年强缓存
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
  console.log(`🚀 High-Speed SSR Schrödinger Matrix listening on :${PORT}`);
});
