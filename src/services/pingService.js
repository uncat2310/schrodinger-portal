/**
 * 服务存活探测引擎
 * 负责与服务端双核探针交互，实时同步服务在线状态与延迟
 */
export class PingService {
  constructor(onStatusUpdate) {
    this.onStatusUpdate = onStatusUpdate;
    this.statusMap = {};
    this.timer = null;
    this.hasBackend = true;
  }

  async checkBackend() {
    try {
      const res = await fetch('/api/info', { signal: AbortSignal.timeout(1500) });
      this.hasBackend = res.ok;
    } catch {
      this.hasBackend = false;
    }
  }

  /**
   * 极速全量批量探针 (1 次 HTTP 请求获取全部状态)
   */
  async probeBatchAll() {
    if (!this.hasBackend) return false;
    try {
      const res = await fetch('/api/ping-all', { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const batchData = await res.json();
        for (const [id, st] of Object.entries(batchData)) {
          this.statusMap[id] = {
            checking: false,
            alive: Boolean(st.alive),
            latency: st.latency || null,
            lastChecked: st.lastChecked || Date.now()
          };
        }
        this.onStatusUpdate({ ...this.statusMap });
        return true;
      }
    } catch {
      // 降级回单服务探测
    }
    return false;
  }

  async probeService(project, targetUrl) {
    if (!project.pingEnabled) {
      return { alive: null, latency: null };
    }

    // 1. 服务端高精度探针
    if (this.hasBackend) {
      try {
        const params = new URLSearchParams();
        if (targetUrl) params.set('url', targetUrl);

        const res = await fetch(`/api/ping?${params.toString()}`, {
          signal: AbortSignal.timeout(2500)
        });

        if (res.ok) {
          const data = await res.json();
          return {
            alive: Boolean(data.alive),
            latency: data.latency || null,
            lastChecked: Date.now()
          };
        }
      } catch {
        // 网络抖动时降级
      }
    }

    // 2. 浏览器客户端降级探测
    const start = performance.now();
    try {
      await fetch(targetUrl || '/', {
        method: 'HEAD',
        mode: 'no-cors',
        signal: AbortSignal.timeout(2000)
      });
      return {
        alive: true,
        latency: Math.round(performance.now() - start),
        lastChecked: Date.now()
      };
    } catch {
      return {
        alive: false,
        latency: null,
        lastChecked: Date.now()
      };
    }
  }

  async probeAll(projects, getUrlCallback) {
    // 优先使用 1 次并发批处理
    const batchSuccess = await this.probeBatchAll();
    if (batchSuccess) return;

    const active = projects.filter((p) => p.pingEnabled);
    const tasks = active.map(async (project) => {
      this.statusMap[project.id] = { checking: true, ...this.statusMap[project.id] };
      this.onStatusUpdate({ ...this.statusMap });

      const url = getUrlCallback(project);
      const result = await this.probeService(project, url);
      this.statusMap[project.id] = { checking: false, ...result };
    });

    await Promise.allSettled(tasks);
    this.onStatusUpdate({ ...this.statusMap });
  }

  start(getProjectsCallback, getUrlCallback, intervalSec = 15) {
    this.stop();
    const tick = () => {
      const projects = getProjectsCallback();
      this.probeAll(projects, getUrlCallback);
    };

    tick();
    this.timer = setInterval(tick, Math.max(8, intervalSec) * 1000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
