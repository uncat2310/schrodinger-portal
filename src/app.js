import { DEFAULT_CONFIG } from './data/defaultConfig.js';
import { PingService } from './services/pingService.js';

const STORAGE_KEY = 'SCHRODINGER_PORTAL_V15';

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
 * 抓取各目标网站自身的原生标签栏 Favicon 图标
 */
export function getProjectNativeFavicon(targetUrl) {
  if (!targetUrl) return '/favicon.png';
  try {
    const parsed = new URL(targetUrl);
    const origin = parsed.origin;
    const hostname = parsed.hostname;

    // 1. 针对已知子服务的原生 Favicon 路径
    if (hostname.includes('traffic')) return `${origin}/favicon.svg`;
    if (hostname.includes('tz.')) return `${origin}/favicon.ico`;
    if (hostname.includes('blog.')) return `${origin}/favicon.ico`;
    if (hostname.includes('v.')) return `${origin}/images/favicon-32x32.png`;
    if (hostname.includes('cd2.')) return `${origin}/public/favicon.png`;
    if (hostname.includes('img.')) return `${origin}/favicon.ico`;
    if (hostname.includes('catbox.')) return `${origin}/static/favicon.svg`;
    if (hostname.includes('qb.')) return `${origin}/icons/qbittorrent-tray.svg`;

    // 2. 针对外部公开网站
    return `https://icons.duckduckgo.com/ip3/${hostname}.ico`;
  } catch {
    return '/favicon.png';
  }
}

/**
 * 薛定谔的项目 · 主应用逻辑中枢
 */
class App {
  constructor() {
    this.loadState();
    this.searchQuery = '';
    this.selectedSearchResultIndex = 0;
    this.searchResults = [];

    this.pingService = new PingService((statusMap) => {
      this.statusMap = statusMap;
      this.updateStatusBadges();
      this.updateMetrics();
    });

    this.statusMap = {};
    this.init();
  }

  /* -------------------------------------------------------------------------- */
  /* 数据持久化与状态管理                                                        */
  /* -------------------------------------------------------------------------- */

  loadState() {
    const isOwnerDomain = window.location.hostname.includes('as4837.de');

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        this.config = JSON.parse(saved);
        if (!this.config.projects || this.config.projects.length === 0) {
          this.config.projects = isOwnerDomain ? SERVER_EXCLUSIVE_PROJECTS : DEFAULT_CONFIG.projects;
        }
        if (!this.config.profile) this.config.profile = DEFAULT_CONFIG.profile;
        if (!this.config.settings) this.config.settings = DEFAULT_CONFIG.settings;
        this.config.categories = DEFAULT_CONFIG.categories;
      } else {
        this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        if (isOwnerDomain) {
          this.config.projects = SERVER_EXCLUSIVE_PROJECTS;
        }
      }
    } catch {
      this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      if (isOwnerDomain) {
        this.config.projects = SERVER_EXCLUSIVE_PROJECTS;
      }
    }

    if (!this.config.settings.theme) {
      this.config.settings.theme = 'light';
    }
  }

  saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
    this.render();
  }

  /* -------------------------------------------------------------------------- */
  /* 应用初始化 (无缝接管 SSR 预渲染 DOM)                                       */
  /* -------------------------------------------------------------------------- */

  async init() {
    this.applyTheme(this.config.settings.theme || 'light');
    await this.pingService.checkBackend();

    this.bindEvents();
    this.startClock();
    
    // 如果 SSR 已经预渲染了服务列表，直接绑定事件并探针，避免闪烁
    const existingCards = document.querySelectorAll('.project-card');
    if (existingCards.length === this.config.projects.length) {
      this.bindCardEvents();
      this.bindRefreshBtn();
      this.renderMetrics();
    } else {
      this.render();
    }

    // 启动后台定时健康探测
    if (this.config.settings.autoPing) {
      this.pingService.start(
        () => this.config.projects,
        (project) => this.buildProjectUrl(project),
        this.config.settings.pingIntervalSeconds || 20
      );
    }
  }

  /* -------------------------------------------------------------------------- */
  /* 路由与工具方法                                                             */
  /* -------------------------------------------------------------------------- */

  buildProjectUrl(project) {
    if (project.customWanUrl) {
      return project.customWanUrl;
    }
    const host = this.config.profile.wanDomain || 'example.com';
    const protocol = project.protocol || 'https';
    const portPart = project.port ? `:${project.port}` : '';
    const pathPart = project.path || '/';
    return `${protocol}://${host}${portPart}${pathPart}`;
  }

  applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    this.config.settings.theme = theme;
    document.querySelectorAll('.theme-option').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-theme-val') === theme);
    });
  }

  showToast(message, icon = '✨') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-8px)';
      toast.style.transition = 'all 0.22s ease';
      setTimeout(() => toast.remove(), 220);
    }, 2200);
  }

  /* -------------------------------------------------------------------------- */
  /* 动态时钟与全时段精准问候 (清晨/上午/午间/下午/晚上/夜深)                    */
  /* -------------------------------------------------------------------------- */

  startClock() {
    const update = () => {
      const now = new Date();
      const hours = now.getHours();
      const timeStr = now.toTimeString().split(' ')[0];
      const clockTime = document.getElementById('clockTime');
      const clockDate = document.getElementById('clockDate');
      const greetingText = document.getElementById('greetingText');
      const greetingIcon = document.getElementById('greetingIcon');

      if (clockTime) clockTime.textContent = timeStr;
      if (clockDate) {
        const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        clockDate.textContent = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${days[now.getDay()]}`;
      }

      if (greetingText && greetingIcon) {
        let greeting = '欢迎回来';
        let icon = '✨';
        if (hours >= 5 && hours < 9) {
          greeting = '清晨好，新的一天';
          icon = '🌅';
        } else if (hours >= 9 && hours < 12) {
          greeting = '上午好，专注当下';
          icon = '☀️';
        } else if (hours >= 12 && hours < 14) {
          greeting = '午间好，享受静谧时光';
          icon = '☕';
        } else if (hours >= 14 && hours < 18) {
          greeting = '下午好，保持高效';
          icon = '💻';
        } else if (hours >= 18 && hours < 23) {
          greeting = '晚上好，一切安然有序';
          icon = '🌙';
        } else {
          greeting = '夜深了，系统持续守护';
          icon = '🌌';
        }
        greetingText.textContent = greeting;
        greetingIcon.textContent = icon;
      }
    };

    update();
    setInterval(update, 1000);
  }

  /* -------------------------------------------------------------------------- */
  /* 界面渲染引擎                                                               */
  /* -------------------------------------------------------------------------- */

  render() {
    this.renderHeader();
    this.renderProjectPool();
    this.renderMetrics();
  }

  renderHeader() {
    const p = this.config.profile;
    const headerTitle = document.getElementById('headerTitle');
    const headerSubtitle = document.getElementById('headerSubtitle');

    if (headerTitle) headerTitle.textContent = p.title || '薛定谔的项目';
    if (headerSubtitle) headerSubtitle.textContent = p.subtitle || '心之所向，触手可及';
  }

  renderMetrics() {
    const total = this.config.projects.length;
    let onlineCount = 0;

    this.config.projects.forEach((proj) => {
      const st = this.statusMap[proj.id];
      if (st && st.alive) onlineCount++;
    });

    const metricTotal = document.getElementById('metricTotal');
    const metricOnline = document.getElementById('metricOnline');
    if (metricTotal) metricTotal.textContent = total;
    if (metricOnline) metricOnline.textContent = onlineCount || total;
  }

  updateMetrics() {
    this.renderMetrics();
  }

  /* -------------------------------------------------------------------------- */
  /* 服务列表头部：标题、刷新、总计与正常运行全部同排紧凑居左                   */
  /* -------------------------------------------------------------------------- */

  renderProjectPool() {
    const pool = document.getElementById('projectPool');
    if (!pool) return;

    if (this.config.projects.length === 0) {
      pool.innerHTML = `
        <div class="empty-category-notice">
          <p>当前暂无服务，点击右上角「添加服务」开始创建。</p>
        </div>
      `;
      return;
    }

    const projects = this.config.projects;

    pool.innerHTML = `
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
          ${projects.map((p) => this.renderProjectCard(p)).join('')}
        </div>
      </div>
    `;

    this.bindCardEvents();
    this.bindRefreshBtn();
    this.updateStatusBadges();
    this.renderMetrics();
  }

  bindRefreshBtn() {
    const refreshPingBtn = document.getElementById('refreshPingBtn');
    refreshPingBtn?.addEventListener('click', () => {
      const svg = refreshPingBtn.querySelector('.spin-on-click');
      svg?.classList.add('spinning');
      this.showToast('正在探测各服务可用性...', '⚡');
      this.pingService.probeAll(this.config.projects, (p) => this.buildProjectUrl(p)).then(() => {
        setTimeout(() => svg?.classList.remove('spinning'), 500);
      });
    });
  }

  /* -------------------------------------------------------------------------- */
  /* Apple 质感极简卡片渲染 (直接使用目标网站自身的原生 Favicon)                */
  /* -------------------------------------------------------------------------- */

  renderProjectCard(project) {
    const targetUrl = this.buildProjectUrl(project);
    const nativeFaviconUrl = getProjectNativeFavicon(targetUrl);

    return `
      <div class="project-card" data-id="${project.id}" data-url="${targetUrl}">
        <div class="card-top">
          <div class="card-identity">
            <div class="card-icon-box">
              <img src="${nativeFaviconUrl}" alt="${project.title}" class="card-favicon-img" onerror="this.onerror=null;this.src='/favicon.png';" />
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

  updateStatusBadges() {
    this.config.projects.forEach((proj) => {
      const el = document.getElementById(`status-${proj.id}`);
      if (!el) return;

      const st = this.statusMap[proj.id];
      if (!st || !proj.pingEnabled) {
        el.className = 'card-status-badge';
        el.style.display = 'none';
        return;
      }

      el.style.display = 'flex';
      if (st.checking) {
        el.className = 'card-status-badge checking';
        el.querySelector('.status-text').textContent = '检测中';
      } else if (st.alive) {
        el.className = 'card-status-badge online';
        const msText = st.latency ? ` ${st.latency}ms` : '';
        el.querySelector('.status-text').textContent = `在线${msText}`;
      } else {
        el.className = 'card-status-badge offline';
        el.querySelector('.status-text').textContent = '未启动';
      }
    });
  }

  /* -------------------------------------------------------------------------- */
  /* 事件绑定与用户交互                                                         */
  /* -------------------------------------------------------------------------- */

  bindEvents() {
    // 主题下拉
    const themeBtn = document.getElementById('themeBtn');
    const themeMenu = document.getElementById('themeMenu');
    themeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      themeMenu.classList.toggle('show');
    });

    document.addEventListener('click', () => {
      themeMenu?.classList.remove('show');
    });

    document.querySelectorAll('.theme-option').forEach((opt) => {
      opt.addEventListener('click', () => {
        const t = opt.getAttribute('data-theme-val');
        this.applyTheme(t);
        this.saveState();
        this.showToast(`已切换主题为「${opt.textContent.trim()}」`, '🎨');
      });
    });

    // 快捷键监听
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.openSearchModal();
      }
      if (e.key === 'Escape') {
        this.closeAllModals();
      }
    });

    // 点击弹窗遮罩外部任意区域直接退出
    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          this.closeAllModals();
        }
      });
    });

    // 搜索入口
    document.getElementById('searchTriggerBtn')?.addEventListener('click', () => {
      this.openSearchModal();
    });
    document.getElementById('closeSearchKbdBtn')?.addEventListener('click', () => {
      this.closeSearchModal();
    });

    // 添加服务弹窗
    document.getElementById('addProjectBtn')?.addEventListener('click', () => this.openProjectModal());
    document.getElementById('closeProjectModalBtn')?.addEventListener('click', () => this.closeProjectModal());
    document.getElementById('cancelProjectBtn')?.addEventListener('click', () => this.closeProjectModal());

    // 设置弹窗
    document.getElementById('settingsBtn')?.addEventListener('click', () => this.openSettingsModal());
    document.getElementById('closeSettingsModalBtn')?.addEventListener('click', () => this.closeSettingsModal());
    document.getElementById('cancelSettingsBtn')?.addEventListener('click', () => this.closeSettingsModal());
    document.getElementById('saveSettingsBtn')?.addEventListener('click', () => this.saveSettings());

    // 表单提交
    document.getElementById('projectForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleProjectFormSubmit();
    });

    // 搜索输入
    const searchInput = document.getElementById('paletteSearchInput');
    searchInput?.addEventListener('input', (e) => {
      this.handleSearchInput(e.target.value);
    });
    searchInput?.addEventListener('keydown', (e) => {
      this.handleSearchKeydown(e);
    });
  }

  bindCardEvents() {
    document.querySelectorAll('.project-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.card-manage-actions')) return;
        const url = card.getAttribute('data-url');
        if (url) window.open(url, '_blank');
      });
    });

    document.querySelectorAll('.copy-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = btn.getAttribute('data-url');
        if (url) {
          navigator.clipboard.writeText(url).then(() => {
            this.showToast('已复制直达链接', '📋');
          });
        }
      });
    });

    document.querySelectorAll('.edit-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        this.openProjectModal(id);
      });
    });

    document.querySelectorAll('.delete-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const proj = this.config.projects.find((p) => p.id === id);
        if (confirm(`确定要移除服务「${proj ? proj.title : id}」吗？`)) {
          this.config.projects = this.config.projects.filter((p) => p.id !== id);
          delete this.statusMap[id];
          this.saveState();
          this.showToast('服务已移除', '🗑️');
        }
      });
    });
  }

  /* -------------------------------------------------------------------------- */
  /* 服务添加与编辑弹窗                                                         */
  /* -------------------------------------------------------------------------- */

  openProjectModal(projectId = null) {
    const modal = document.getElementById('projectModalOverlay');
    const titleEl = document.getElementById('projectModalTitle');

    if (projectId) {
      const proj = this.config.projects.find((p) => p.id === projectId);
      if (!proj) return;

      titleEl.textContent = '编辑服务';
      document.getElementById('formProjectId').value = proj.id;
      document.getElementById('formTitle').value = proj.title || '';
      document.getElementById('formCustomWan').value = proj.customWanUrl || '';
      document.getElementById('formPing').checked = Boolean(proj.pingEnabled);
    } else {
      titleEl.textContent = '添加新服务';
      document.getElementById('formProjectId').value = '';
      document.getElementById('formTitle').value = '';
      document.getElementById('formCustomWan').value = '';
      document.getElementById('formPing').checked = true;
    }

    modal.classList.add('active');
  }

  closeProjectModal() {
    document.getElementById('projectModalOverlay')?.classList.remove('active');
  }

  handleProjectFormSubmit() {
    const id = document.getElementById('formProjectId').value || `proj-${Date.now()}`;
    const title = document.getElementById('formTitle').value.trim();
    const customWanUrl = document.getElementById('formCustomWan').value.trim();
    const pingEnabled = document.getElementById('formPing').checked;

    const projectData = {
      id,
      title,
      categoryId: 'services',
      customWanUrl: customWanUrl || undefined,
      pingEnabled
    };

    const existingIndex = this.config.projects.findIndex((p) => p.id === id);
    if (existingIndex >= 0) {
      this.config.projects[existingIndex] = projectData;
      this.showToast(`服务「${title}」修改已保存`, '💾');
    } else {
      this.config.projects.unshift(projectData);
      this.showToast(`新服务「${title}」已添加`, '✨');
    }

    this.closeProjectModal();
    this.saveState();

    const targetUrl = this.buildProjectUrl(projectData);
    this.pingService.probeService(projectData, targetUrl).then((res) => {
      this.statusMap[id] = res;
      this.updateStatusBadges();
      this.updateMetrics();
    });
  }

  /* -------------------------------------------------------------------------- */
  /* 全局快速检索 (Ctrl + K)                                                    */
  /* -------------------------------------------------------------------------- */

  openSearchModal() {
    const modal = document.getElementById('searchModalOverlay');
    const input = document.getElementById('paletteSearchInput');
    modal.classList.add('active');
    input.value = '';
    this.handleSearchInput('');
    setTimeout(() => input.focus(), 50);
  }

  closeSearchModal() {
    document.getElementById('searchModalOverlay')?.classList.remove('active');
  }

  handleSearchInput(query) {
    this.searchQuery = query.toLowerCase().trim();
    const list = document.getElementById('searchResultsList');
    if (!list) return;

    if (!this.searchQuery) {
      this.searchResults = [...this.config.projects];
    } else {
      this.searchResults = this.config.projects.filter((p) => {
        const matchTitle = p.title?.toLowerCase().includes(this.searchQuery);
        const matchUrl = p.customWanUrl?.toLowerCase().includes(this.searchQuery);
        return matchTitle || matchUrl;
      });
    }

    this.selectedSearchResultIndex = 0;
    this.renderSearchResults();
  }

  renderSearchResults() {
    const list = document.getElementById('searchResultsList');
    if (!list) return;

    if (this.searchResults.length === 0) {
      list.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
          没有找到匹配「${this.searchQuery}」的服务
        </div>
      `;
      return;
    }

    list.innerHTML = this.searchResults
      .map((proj, idx) => {
        const isSelected = idx === this.selectedSearchResultIndex;
        const targetUrl = this.buildProjectUrl(proj);
        const nativeFaviconUrl = getProjectNativeFavicon(targetUrl);

        return `
          <div class="search-result-item ${isSelected ? 'selected' : ''}" data-idx="${idx}">
            <div class="search-result-left">
              <img src="${nativeFaviconUrl}" alt="${proj.title}" style="width: 20px; height: 20px; object-fit: contain; border-radius: 4px;" onerror="this.onerror=null;this.src='/favicon.png';" />
              <div class="search-result-title">${proj.title}</div>
            </div>
            <span class="kbd-badge">↵ 打开</span>
          </div>
        `;
      })
      .join('');

    list.querySelectorAll('.search-result-item').forEach((item) => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.getAttribute('data-idx'), 10);
        this.launchSearchResult(idx);
      });
    });
  }

  handleSearchKeydown(e) {
    if (this.searchResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedSearchResultIndex = (this.selectedSearchResultIndex + 1) % this.searchResults.length;
      this.renderSearchResults();
      this.scrollSelectedResultIntoView();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedSearchResultIndex =
        (this.selectedSearchResultIndex - 1 + this.searchResults.length) % this.searchResults.length;
      this.renderSearchResults();
      this.scrollSelectedResultIntoView();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.launchSearchResult(this.selectedSearchResultIndex);
    }
  }

  scrollSelectedResultIntoView() {
    const list = document.getElementById('searchResultsList');
    const selected = list?.querySelector('.search-result-item.selected');
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' });
    }
  }

  launchSearchResult(index) {
    const proj = this.searchResults[index];
    if (!proj) return;
    const url = this.buildProjectUrl(proj);
    window.open(url, '_blank');
    this.closeSearchModal();
  }

  /* -------------------------------------------------------------------------- */
  /* 个性化设置                                                                 */
  /* -------------------------------------------------------------------------- */

  openSettingsModal() {
    const modal = document.getElementById('settingsModalOverlay');
    const p = this.config.profile;

    const cfgTitle = document.getElementById('cfgTitle');
    const cfgSubtitle = document.getElementById('cfgSubtitle');

    if (cfgTitle) cfgTitle.value = p.title || '薛定谔的项目';
    if (cfgSubtitle) cfgSubtitle.value = p.subtitle || '心之所向，触手可及';

    modal?.classList.add('active');
  }

  closeSettingsModal() {
    document.getElementById('settingsModalOverlay')?.classList.remove('active');
  }

  saveSettings() {
    const cfgTitle = document.getElementById('cfgTitle');
    const cfgSubtitle = document.getElementById('cfgSubtitle');

    if (cfgTitle) this.config.profile.title = cfgTitle.value.trim() || '薛定谔的项目';
    if (cfgSubtitle) this.config.profile.subtitle = cfgSubtitle.value.trim() || '心之所向，触手可及';

    this.saveState();
    this.closeSettingsModal();
    this.showToast('设置已成功保存', '💾');
  }

  closeAllModals() {
    this.closeProjectModal();
    this.closeSearchModal();
    this.closeSettingsModal();
  }
}

// 启动客户端
window.addEventListener('DOMContentLoaded', () => {
  window.aetherHub = new App();
});
