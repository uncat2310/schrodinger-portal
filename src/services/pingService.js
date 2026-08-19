/**
 * 健康状态客户端
 * - 服务端可信项目：只读取 /api/ping-all（后台 daemon 写入 HEALTH_CACHE）
 * - 浏览器自定义项目：走 /api/ping-batch，服务端做 SSRF 校验
 */
export class PingService {
  constructor(onStatusUpdate) {
    this.onStatusUpdate = onStatusUpdate;
    this.statusMap = {};
    this.timer = null;
    this.hasBackend = true;
    this.probing = false;
    this.paused = false;
    this.getProjects = null;
    this.getUrl = null;
    this.isTrusted = null;
    this.intervalSec = 15;
  }

  async checkBackend() {
    try {
      const res = await fetch('/api/info', { signal: AbortSignal.timeout(1500) });
      this.hasBackend = res.ok;
    } catch {
      this.hasBackend = false;
    }
  }

  /** 拉取服务端 HEALTH_CACHE（不触发外连探测） */
  async fetchServerCache() {
    if (!this.hasBackend) return false;
    try {
      const res = await fetch('/api/ping-all', { signal: AbortSignal.timeout(4000) });
      if (!res.ok) return false;
      const batchData = await res.json();
      for (const [id, st] of Object.entries(batchData)) {
        this.statusMap[id] = {
          checking: false,
          alive: Boolean(st.alive),
          latency: st.latency || null,
          lastChecked: st.lastChecked || Date.now(),
          error: st.error || null
        };
      }
      this.onStatusUpdate({ ...this.statusMap });
      return true;
    } catch {
      return false;
    }
  }

  async probeCustomBatch(items) {
    if (!this.hasBackend || items.length === 0) return false;
    try {
      const res = await fetch('/api/ping-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.slice(0, 30).map((item) => ({ id: item.id, url: item.url }))
        }),
        signal: AbortSignal.timeout(8000)
      });
      if (!res.ok) return false;
      const batchData = await res.json();
      for (const [id, st] of Object.entries(batchData)) {
        this.statusMap[id] = {
          checking: false,
          alive: Boolean(st.alive),
          latency: st.latency || null,
          lastChecked: st.lastChecked || Date.now(),
          error: st.error || null
        };
      }
      this.onStatusUpdate({ ...this.statusMap });
      return true;
    } catch {
      return false;
    }
  }

  async probeService(project, targetUrl) {
    if (!project.pingEnabled) {
      return { alive: null, latency: null };
    }

    if (this.hasBackend && targetUrl) {
      try {
        const params = new URLSearchParams();
        if (project.id) params.set('id', project.id);
        params.set('url', targetUrl);
        const res = await fetch(`/api/ping?${params.toString()}`, {
          signal: AbortSignal.timeout(4000)
        });
        if (res.ok) {
          const data = await res.json();
          return {
            alive: Boolean(data.alive),
            latency: data.latency || null,
            lastChecked: Date.now(),
            error: data.error || null
          };
        }
      } catch {
        // fallback below
      }
    }

    const start = performance.now();
    try {
      await fetch(targetUrl || '/', {
        method: 'HEAD',
        mode: 'no-cors',
        signal: AbortSignal.timeout(3000)
      });
      return {
        alive: true,
        latency: Math.round(performance.now() - start),
        lastChecked: Date.now(),
        approximate: true
      };
    } catch {
      return {
        alive: false,
        latency: null,
        lastChecked: Date.now()
      };
    }
  }

  async probeAll(projects, getUrlCallback, options = {}) {
    if (this.probing || this.paused) return;
    this.probing = true;

    try {
      const active = projects.filter((p) => p.pingEnabled);
      if (active.length === 0) return;

      const isTrusted =
        typeof options.isTrusted === 'function'
          ? options.isTrusted
          : () => false;

      const trusted = [];
      const custom = [];
      for (const project of active) {
        const url = getUrlCallback(project);
        if (isTrusted(project, url)) trusted.push(project);
        else custom.push({ project, url });
      }

      active.forEach((p) => {
        this.statusMap[p.id] = { checking: true, ...this.statusMap[p.id] };
      });
      this.onStatusUpdate({ ...this.statusMap });

      if (trusted.length > 0) {
        await this.fetchServerCache();
        // 缓存未覆盖的 trusted 项保持 checking→不可用语义由 UI 处理
        for (const project of trusted) {
          if (!this.statusMap[project.id] || this.statusMap[project.id].checking) {
            this.statusMap[project.id] = {
              checking: false,
              alive: false,
              latency: null,
              lastChecked: Date.now(),
              error: 'NO_CACHE'
            };
          }
        }
      }

      if (custom.length > 0) {
        const ok = await this.probeCustomBatch(
          custom.map(({ project, url }) => ({ id: project.id, url }))
        );
        if (!ok) {
          await Promise.allSettled(
            custom.map(async ({ project, url }) => {
              const result = await this.probeService(project, url);
              this.statusMap[project.id] = { checking: false, ...result };
            })
          );
        }
      }

      this.onStatusUpdate({ ...this.statusMap });
    } finally {
      this.probing = false;
    }
  }

  start(getProjectsCallback, getUrlCallback, intervalSec = 15, optionsFactory = null) {
    this.stop();
    this.getProjects = getProjectsCallback;
    this.getUrl = getUrlCallback;
    this.optionsFactory = optionsFactory;
    this.intervalSec = Math.max(8, intervalSec);
    this.paused = false;

    const tick = () => {
      if (this.paused || this.probing) return;
      if (document.visibilityState === 'hidden') return;
      const projects = this.getProjects();
      const options = typeof this.optionsFactory === 'function' ? this.optionsFactory() : {};
      this.probeAll(projects, this.getUrl, options);
    };

    tick();
    this.timer = setInterval(tick, this.intervalSec * 1000);
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    if (this.getProjects && this.getUrl) {
      const options = typeof this.optionsFactory === 'function' ? this.optionsFactory() : {};
      this.probeAll(this.getProjects(), this.getUrl, options);
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
