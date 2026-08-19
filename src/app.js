import { DEFAULT_CONFIG } from './data/defaultConfig.js';
import { PingService } from './services/pingService.js';
import { escapeHtml, escapeAttribute } from '../shared/escape.js';
import { getGreeting } from '../shared/greeting.js';
import { getProjectNativeFavicon } from '../shared/favicon.js';
import { isValidHttpUrl, parseHttpUrl } from '../shared/url.js';

const STORAGE_KEY = 'SCHRODINGER_PORTAL';
const LEGACY_STORAGE_KEY = 'SCHRODINGER_PORTAL_V18';
const SCHEMA_VERSION = 1;

const faviconCache = new Map();

function cachedFavicon(url) {
  if (!url) return '/favicon.svg';
  if (faviconCache.has(url)) return faviconCache.get(url);
  const icon = getProjectNativeFavicon(url);
  faviconCache.set(url, icon);
  return icon;
}

export { getProjectNativeFavicon };

class App {
  constructor() {
    this.ssrProjects = null;
    this.trustedUrlById = new Map();
    this.loadState();
    this.searchQuery = '';
    this.selectedSearchResultIndex = 0;
    this.searchResults = [];
    this.poolDelegated = false;
    this.clockTimer = null;
    this.lastFocusedBeforeModal = null;
    this.subtitleRevealed = false;

    this.pingService = new PingService((statusMap) => {
      this.statusMap = statusMap;
      this.updateStatusBadges();
      this.updateMetrics();
    });

    this.statusMap = {};
    this.init();
  }

  /* -------------------------------------------------------------------------- */
  /* Persistence                                                                */
  /* -------------------------------------------------------------------------- */

  loadState() {
    let ssrProjects = null;
    const ssrEl = document.getElementById('initial-projects-data');
    if (ssrEl) {
      try {
        const parsed = JSON.parse(ssrEl.textContent);
        if (Array.isArray(parsed) && parsed.length > 0) {
          ssrProjects = parsed;
        }
      } catch {
        // ignore
      }
    }

    this.ssrProjects = ssrProjects;
    this.trustedUrlById = new Map();
    for (const project of ssrProjects || DEFAULT_CONFIG.projects) {
      if (project?.id && project?.customWanUrl) {
        const parsed = parseHttpUrl(project.customWanUrl);
        if (parsed) this.trustedUrlById.set(project.id, parsed.href);
      }
    }

    try {
      let saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) {
        const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacy) {
          saved = legacy;
          localStorage.setItem(STORAGE_KEY, legacy);
        }
      }

      if (saved) {
        this.config = JSON.parse(saved);
        if (!this.config.projects || this.config.projects.length === 0) {
          this.config.projects = ssrProjects || DEFAULT_CONFIG.projects;
        }
        if (!this.config.profile) this.config.profile = DEFAULT_CONFIG.profile;
        if (!this.config.settings) this.config.settings = DEFAULT_CONFIG.settings;
        this.config.categories = DEFAULT_CONFIG.categories;
        this.config.schemaVersion = SCHEMA_VERSION;
      } else {
        this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        this.config.schemaVersion = SCHEMA_VERSION;
        if (ssrProjects) this.config.projects = ssrProjects;
      }
    } catch {
      this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      this.config.schemaVersion = SCHEMA_VERSION;
      if (ssrProjects) this.config.projects = ssrProjects;
    }

    if (!this.config.settings.theme) {
      this.config.settings.theme = 'light';
    }
  }

  persistState() {
    this.config.schemaVersion = SCHEMA_VERSION;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.config));
  }

  isTrustedProject(project, url) {
    if (!project?.id || !url) return false;
    const canonical = this.trustedUrlById.get(project.id);
    if (!canonical) return false;
    const parsed = parseHttpUrl(url);
    return Boolean(parsed && parsed.href === canonical);
  }

  ssrDomMatchesConfig() {
    const existingCards = document.querySelectorAll('.project-card');
    const projects = this.config.projects;
    if (existingCards.length !== projects.length) return false;

    return [...existingCards].every((card, index) => {
      const project = projects[index];
      if (!project) return false;
      const expectedUrl = this.buildProjectUrl(project) || '';
      return card.getAttribute('data-id') === project.id && card.getAttribute('data-url') === expectedUrl;
    });
  }

  /* -------------------------------------------------------------------------- */
  /* Init                                                                       */
  /* -------------------------------------------------------------------------- */

  async init() {
    const themeParam = new URLSearchParams(window.location.search).get('theme');
    const bootstrapped = document.documentElement.getAttribute('data-theme');
    const initialTheme =
      themeParam && ['light', 'dark', 'auto'].includes(themeParam)
        ? themeParam
        : this.config.settings.theme || bootstrapped || 'light';
    this.applyTheme(initialTheme, { persist: false });

    await this.pingService.checkBackend();
    this.bindEvents();
    this.ensurePoolDelegation();
    this.startClock();
    this.setupVisibilityHandling();
    this.revealSubtitleOnce();
    this.updateSearchShortcutLabel();

    if (this.ssrDomMatchesConfig()) {
      this.bindRefreshBtn();
      this.renderMetrics();
      this.enhanceExistingCards();
    } else {
      this.renderProjectPool();
      this.renderHeader();
    }

    if (this.config.settings.autoPing) {
      this.pingService.start(
        () => this.config.projects,
        (project) => this.buildProjectUrl(project),
        this.config.settings.pingIntervalSeconds || 20,
        () => ({
          isTrusted: (project, url) => this.isTrustedProject(project, url)
        })
      );
    }
  }

  enhanceExistingCards() {
    document.querySelectorAll('.project-card').forEach((card, index) => {
      card.tabIndex = 0;
      card.setAttribute('role', 'link');
      card.style.animationDelay = `${Math.min(index * 28, 200)}ms`;
      if (!card.querySelector('.card-hostname')) {
        const project = this.config.projects.find((p) => p.id === card.getAttribute('data-id'));
        if (!project) return;
        const host = this.getHostname(this.buildProjectUrl(project));
        const titleEl = card.querySelector('.card-title');
        if (titleEl && host) {
          const wrap = document.createElement('div');
          wrap.className = 'card-text';
          titleEl.replaceWith(wrap);
          wrap.appendChild(titleEl);
          const hostEl = document.createElement('div');
          hostEl.className = 'card-hostname';
          hostEl.textContent = host;
          wrap.appendChild(hostEl);
        }
      }
    });
  }

  /* -------------------------------------------------------------------------- */
  /* Helpers                                                                    */
  /* -------------------------------------------------------------------------- */

  buildProjectUrl(project) {
    if (project.customWanUrl) {
      const parsed = parseHttpUrl(project.customWanUrl);
      return parsed ? parsed.href : '';
    }
    const host = this.config.profile.wanDomain || 'example.com';
    const protocol = project.protocol || 'https';
    if (protocol !== 'http' && protocol !== 'https') return '';
    const portPart = project.port ? `:${project.port}` : '';
    const pathPart = project.path || '/';
    const candidate = `${protocol}://${host}${portPart}${pathPart}`;
    return isValidHttpUrl(candidate) ? candidate : '';
  }

  getHostname(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  }

  openSafeUrl(url) {
    if (!isValidHttpUrl(url)) {
      this.showToast('链接无效，已拦截不安全地址', '⚠️');
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  applyTheme(theme, { persist = true } = {}) {
    document.documentElement.setAttribute('data-theme', theme);
    this.config.settings.theme = theme;
    document.querySelectorAll('.theme-option').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-theme-val') === theme);
    });
    if (persist) this.persistState();
  }

  showToast(message, icon = '✨') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    const iconSpan = document.createElement('span');
    iconSpan.textContent = icon;
    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;
    toast.append(iconSpan, document.createTextNode(' '), messageSpan);
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-8px)';
      toast.style.transition = 'opacity 0.22s ease, transform 0.22s ease';
      setTimeout(() => toast.remove(), 220);
    }, 2200);
  }

  prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  revealSubtitleOnce() {
    if (this.subtitleRevealed) return;
    const el = document.getElementById('headerSubtitle');
    if (!el) return;
    const text = el.textContent || '';
    if (this.prefersReducedMotion()) {
      this.subtitleRevealed = true;
      return;
    }
    el.textContent = '';
    [...text].forEach((ch, index) => {
      const span = document.createElement('span');
      span.className = 'reveal-char';
      span.textContent = ch === ' ' ? '\u00A0' : ch;
      span.style.animationDelay = `${index * 32}ms`;
      el.appendChild(span);
    });
    this.subtitleRevealed = true;
  }

  updateSearchShortcutLabel() {
    const kbd = document.querySelector('#searchTriggerBtn .kbd-badge');
    if (!kbd) return;
    const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
    kbd.textContent = isMac ? '⌘ K' : 'Ctrl K';
  }

  /* -------------------------------------------------------------------------- */
  /* Clock / Visibility                                                         */
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
        const { greeting, icon } = getGreeting(hours);
        greetingText.textContent = greeting;
        greetingIcon.textContent = icon;
      }
    };

    update();
    this.clockTimer = setInterval(update, 1000);
  }

  setupVisibilityHandling() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.pingService.pause();
        if (this.clockTimer) {
          clearInterval(this.clockTimer);
          this.clockTimer = null;
        }
      } else {
        const now = new Date();
        const clockTime = document.getElementById('clockTime');
        if (clockTime) clockTime.textContent = now.toTimeString().split(' ')[0];
        this.startClock();
        this.pingService.resume();
      }
    });
  }

  /* -------------------------------------------------------------------------- */
  /* Render                                                                     */
  /* -------------------------------------------------------------------------- */

  renderHeader() {
    const p = this.config.profile;
    const headerTitle = document.getElementById('headerTitle');
    const headerSubtitle = document.getElementById('headerSubtitle');
    if (headerTitle) headerTitle.textContent = p.title || '薛定谔的项目';
    if (headerSubtitle) {
      headerSubtitle.textContent = p.subtitle || '心之所向，触手可及';
      this.subtitleRevealed = false;
      this.revealSubtitleOnce();
    }
  }

  renderMetrics() {
    const total = this.config.projects.length;
    const pingable = this.config.projects.filter((p) => p.pingEnabled);
    const results = pingable.map((p) => this.statusMap[p.id]).filter(Boolean);
    const allDone =
      pingable.length === 0 ||
      (results.length === pingable.length && results.every((st) => !st.checking));

    let onlineCount = 0;
    if (allDone) onlineCount = results.filter((st) => st.alive).length;

    const metricTotal = document.getElementById('metricTotal');
    const metricOnline = document.getElementById('metricOnline');
    if (metricTotal) metricTotal.textContent = String(total);
    if (metricOnline) metricOnline.textContent = allDone ? String(onlineCount) : '—';
  }

  updateMetrics() {
    this.renderMetrics();
  }

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
            <button class="section-refresh-btn" id="refreshPingBtn" title="重新探测服务状态" type="button">
              <svg class="btn-svg spin-on-click" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M23 4v6h-6M1 20v-6h6"></path>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
            </button>
            <div class="stat-inline">
              <span class="stat-label">服务</span>
              <span class="stat-num" id="metricTotal">${projects.length}</span>
            </div>
            <div class="stat-inline">
              <span class="stat-label">在线</span>
              <span class="stat-num online" id="metricOnline">—</span>
            </div>
          </div>
        </div>
        <div class="cards-grid">
          ${projects.map((p, index) => this.renderProjectCard(p, index)).join('')}
        </div>
      </div>
    `;

    this.bindRefreshBtn();
    this.updateStatusBadges();
    this.renderMetrics();
  }

  bindRefreshBtn() {
    const refreshPingBtn = document.getElementById('refreshPingBtn');
    if (!refreshPingBtn || refreshPingBtn.dataset.bound === '1') return;
    refreshPingBtn.dataset.bound = '1';
    refreshPingBtn.addEventListener('click', () => {
      const svg = refreshPingBtn.querySelector('.spin-on-click');
      svg?.classList.add('spinning');
      this.showToast('正在同步服务状态...', '⚡');
      this.pingService
        .probeAll(this.config.projects, (p) => this.buildProjectUrl(p), {
          isTrusted: (project, url) => this.isTrustedProject(project, url)
        })
        .then(() => setTimeout(() => svg?.classList.remove('spinning'), 500));
    });
  }

  renderProjectCard(project, index = 0) {
    const targetUrl = this.buildProjectUrl(project);
    const href = targetUrl || '#';
    const nativeFaviconUrl = cachedFavicon(targetUrl);
    const title = project.title || '未命名服务';
    const host = this.getHostname(targetUrl);
    const delay = Math.min(index * 28, 200);

    return `
      <div class="project-card" data-id="${escapeAttribute(project.id)}" data-url="${escapeAttribute(href)}" tabindex="0" role="link" style="animation-delay:${delay}ms">
        <div class="card-top">
          <div class="card-identity">
            <div class="card-icon-box">
              <img src="${escapeAttribute(nativeFaviconUrl)}" alt="${escapeAttribute(title)}" width="28" height="28" class="card-favicon-img" onerror="this.onerror=null;this.src='/favicon.svg';" />
            </div>
            <div class="card-text">
              <div class="card-title" title="${escapeAttribute(title)}">${escapeHtml(title)}</div>
              ${host ? `<div class="card-hostname">${escapeHtml(host)}</div>` : ''}
            </div>
          </div>
          <div class="card-status-badge checking" id="status-${escapeAttribute(project.id)}">
            <span class="status-dot"></span>
            <span class="status-text">检测中</span>
          </div>
        </div>
        <div class="card-footer">
          <div class="card-manage-actions">
            <button class="card-action-btn copy-btn" data-url="${escapeAttribute(href)}" title="复制直达链接" type="button">
              <svg class="btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
            <button class="card-action-btn edit-btn" data-id="${escapeAttribute(project.id)}" title="编辑服务" type="button">
              <svg class="btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
            </button>
            <button class="card-action-btn delete-btn" data-id="${escapeAttribute(project.id)}" title="删除服务" type="button">
              <svg class="btn-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
          <a href="${escapeAttribute(href)}" target="_blank" rel="noreferrer" class="btn-launch" title="直达打开服务">
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
      const textEl = el.querySelector('.status-text');
      if (st.checking) {
        el.className = 'card-status-badge checking';
        if (textEl) textEl.textContent = '检测中';
      } else if (st.alive) {
        el.className = 'card-status-badge online';
        const msText = st.latency != null ? ` · ${st.latency} ms` : '';
        if (textEl) textEl.textContent = `在线${msText}`;
      } else {
        el.className = 'card-status-badge offline';
        if (textEl) textEl.textContent = '不可用';
      }
    });
  }

  /* -------------------------------------------------------------------------- */
  /* Events                                                                     */
  /* -------------------------------------------------------------------------- */

  ensurePoolDelegation() {
    if (this.poolDelegated) return;
    const pool = document.getElementById('projectPool');
    if (!pool) return;
    this.poolDelegated = true;

    pool.addEventListener('click', (e) => {
      const copyBtn = e.target.closest('.copy-btn');
      if (copyBtn) {
        e.preventDefault();
        e.stopPropagation();
        const url = copyBtn.getAttribute('data-url');
        if (url && isValidHttpUrl(url)) {
          navigator.clipboard.writeText(url).then(() => this.showToast('已复制直达链接', '📋'));
        } else {
          this.showToast('链接无效，无法复制', '⚠️');
        }
        return;
      }

      const editBtn = e.target.closest('.edit-btn');
      if (editBtn) {
        e.preventDefault();
        e.stopPropagation();
        this.openProjectModal(editBtn.getAttribute('data-id'));
        return;
      }

      const deleteBtn = e.target.closest('.delete-btn');
      if (deleteBtn) {
        e.preventDefault();
        e.stopPropagation();
        const id = deleteBtn.getAttribute('data-id');
        const proj = this.config.projects.find((p) => p.id === id);
        if (confirm(`确定要移除服务「${proj ? proj.title : id}」吗？`)) {
          this.config.projects = this.config.projects.filter((p) => p.id !== id);
          delete this.statusMap[id];
          this.persistState();
          this.renderProjectPool();
          this.showToast('服务已移除', '🗑️');
        }
        return;
      }

      if (e.target.closest('a, button')) return;

      const card = e.target.closest('.project-card');
      if (!card) return;
      const url = card.getAttribute('data-url');
      if (url && url !== '#') this.openSafeUrl(url);
    });

    pool.addEventListener('keydown', (e) => {
      const card = e.target.closest('.project-card');
      if (!card || e.target.closest('a, button')) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const url = card.getAttribute('data-url');
        if (url && url !== '#') this.openSafeUrl(url);
      }
    });
  }

  bindEvents() {
    const themeBtn = document.getElementById('themeBtn');
    const themeMenu = document.getElementById('themeMenu');
    themeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      themeMenu.classList.toggle('show');
    });

    document.addEventListener('click', () => themeMenu?.classList.remove('show'));

    document.querySelectorAll('.theme-option').forEach((opt) => {
      opt.addEventListener('click', () => {
        const t = opt.getAttribute('data-theme-val');
        this.applyTheme(t);
        this.showToast(`已切换主题为「${opt.textContent.trim()}」`, '🎨');
      });
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        this.openSearchModal();
      }
      if (e.key === 'Escape') this.closeAllModals();
    });

    document.querySelectorAll('.modal-overlay').forEach((overlay) => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.closeAllModals();
      });
    });

    document.getElementById('searchTriggerBtn')?.addEventListener('click', () => this.openSearchModal());
    document.getElementById('closeSearchKbdBtn')?.addEventListener('click', () => this.closeSearchModal());
    document.getElementById('addProjectBtn')?.addEventListener('click', () => this.openProjectModal());
    document.getElementById('closeProjectModalBtn')?.addEventListener('click', () => this.closeProjectModal());
    document.getElementById('cancelProjectBtn')?.addEventListener('click', () => this.closeProjectModal());
    document.getElementById('settingsBtn')?.addEventListener('click', () => this.openSettingsModal());
    document.getElementById('closeSettingsModalBtn')?.addEventListener('click', () => this.closeSettingsModal());
    document.getElementById('cancelSettingsBtn')?.addEventListener('click', () => this.closeSettingsModal());
    document.getElementById('saveSettingsBtn')?.addEventListener('click', () => this.saveSettings());

    document.getElementById('projectForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleProjectFormSubmit();
    });

    const searchInput = document.getElementById('paletteSearchInput');
    searchInput?.addEventListener('input', (e) => this.handleSearchInput(e.target.value));
    searchInput?.addEventListener('keydown', (e) => this.handleSearchKeydown(e));
  }

  /* -------------------------------------------------------------------------- */
  /* Modals                                                                     */
  /* -------------------------------------------------------------------------- */

  getFocusable(container) {
    if (!container) return [];
    return [...container.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((el) => el.offsetParent !== null || el === document.activeElement);
  }

  bindFocusTrap(overlay) {
    if (!overlay || overlay.dataset.focusTrapBound === '1') return;
    overlay.dataset.focusTrapBound = '1';
    overlay.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || !overlay.classList.contains('active')) return;
      const panel = overlay.querySelector('.modal-card, .search-palette-box') || overlay;
      const nodes = this.getFocusable(panel);
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  openOverlay(overlayId, focusSelector) {
    this.lastFocusedBeforeModal = document.activeElement;
    const modal = document.getElementById(overlayId);
    if (!modal) return;
    this.bindFocusTrap(modal);
    modal.classList.add('active');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('role', 'dialog');
    setTimeout(() => {
      const focusEl = modal.querySelector(focusSelector) || this.getFocusable(modal)[0];
      focusEl?.focus();
    }, 30);
  }

  closeOverlay(overlayId) {
    document.getElementById(overlayId)?.classList.remove('active');
    if (this.lastFocusedBeforeModal && typeof this.lastFocusedBeforeModal.focus === 'function') {
      this.lastFocusedBeforeModal.focus();
    }
  }

  openProjectModal(projectId = null) {
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
    this.openOverlay('projectModalOverlay', '#formTitle');
  }

  closeProjectModal() {
    this.closeOverlay('projectModalOverlay');
  }

  handleProjectFormSubmit() {
    const id = document.getElementById('formProjectId').value || `proj-${Date.now()}`;
    const title = document.getElementById('formTitle').value.trim();
    const customWanUrlRaw = document.getElementById('formCustomWan').value.trim();
    const pingEnabled = document.getElementById('formPing').checked;

    if (!title) {
      this.showToast('请填写服务名称', '⚠️');
      return;
    }

    const parsedUrl = parseHttpUrl(customWanUrlRaw);
    if (!parsedUrl) {
      this.showToast('请输入有效的 http:// 或 https:// 链接', '⚠️');
      return;
    }

    const projectData = {
      id,
      title,
      categoryId: 'services',
      customWanUrl: parsedUrl.href,
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
    this.persistState();
    this.renderProjectPool();

    this.pingService.probeService(projectData, parsedUrl.href).then((res) => {
      this.statusMap[id] = { checking: false, ...res };
      this.updateStatusBadges();
      this.updateMetrics();
    });
  }

  openSearchModal() {
    this.openOverlay('searchModalOverlay', '#paletteSearchInput');
    const input = document.getElementById('paletteSearchInput');
    if (input) input.value = '';
    this.handleSearchInput('');
  }

  closeSearchModal() {
    this.closeOverlay('searchModalOverlay');
  }

  handleSearchInput(query) {
    this.searchQuery = query.toLowerCase().trim();
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
          没有找到匹配「${escapeHtml(this.searchQuery)}」的服务
        </div>
      `;
      return;
    }

    list.innerHTML = this.searchResults
      .map((proj, idx) => {
        const isSelected = idx === this.selectedSearchResultIndex;
        const targetUrl = this.buildProjectUrl(proj);
        const nativeFaviconUrl = cachedFavicon(targetUrl);
        const title = proj.title || '未命名服务';
        const host = this.getHostname(targetUrl);
        return `
          <div class="search-result-item ${isSelected ? 'selected' : ''}" data-idx="${idx}">
            <div class="search-result-left">
              <img src="${escapeAttribute(nativeFaviconUrl)}" alt="" width="20" height="20" style="width:20px;height:20px;object-fit:contain;border-radius:4px;" onerror="this.onerror=null;this.src='/favicon.svg';" />
              <div>
                <div class="search-result-title">${escapeHtml(title)}</div>
                ${host ? `<div class="search-result-host">${escapeHtml(host)}</div>` : ''}
              </div>
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

  updateSearchSelection(nextIndex) {
    const list = document.getElementById('searchResultsList');
    if (!list || this.searchResults.length === 0) return;
    const items = list.querySelectorAll('.search-result-item');
    items[this.selectedSearchResultIndex]?.classList.remove('selected');
    this.selectedSearchResultIndex = nextIndex;
    const selected = items[this.selectedSearchResultIndex];
    selected?.classList.add('selected');
    selected?.scrollIntoView({ block: 'nearest' });
  }

  handleSearchKeydown(e) {
    if (this.searchResults.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.updateSearchSelection((this.selectedSearchResultIndex + 1) % this.searchResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.updateSearchSelection(
        (this.selectedSearchResultIndex - 1 + this.searchResults.length) % this.searchResults.length
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.launchSearchResult(this.selectedSearchResultIndex);
    }
  }

  launchSearchResult(index) {
    const proj = this.searchResults[index];
    if (!proj) return;
    this.openSafeUrl(this.buildProjectUrl(proj));
    this.closeSearchModal();
  }

  openSettingsModal() {
    const p = this.config.profile;
    const cfgTitle = document.getElementById('cfgTitle');
    const cfgSubtitle = document.getElementById('cfgSubtitle');
    if (cfgTitle) cfgTitle.value = p.title || '薛定谔的项目';
    if (cfgSubtitle) cfgSubtitle.value = p.subtitle || '心之所向，触手可及';
    this.openOverlay('settingsModalOverlay', '#cfgTitle');
  }

  closeSettingsModal() {
    this.closeOverlay('settingsModalOverlay');
  }

  saveSettings() {
    const cfgTitle = document.getElementById('cfgTitle');
    const cfgSubtitle = document.getElementById('cfgSubtitle');
    if (cfgTitle) this.config.profile.title = cfgTitle.value.trim() || '薛定谔的项目';
    if (cfgSubtitle) this.config.profile.subtitle = cfgSubtitle.value.trim() || '心之所向，触手可及';
    this.persistState();
    this.renderHeader();
    this.closeSettingsModal();
    this.showToast('设置已成功保存', '💾');
  }

  closeAllModals() {
    this.closeProjectModal();
    this.closeSearchModal();
    this.closeSettingsModal();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.schrodingerPortal = new App();
});
