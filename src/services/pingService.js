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

  async probeService(project, targetUrl) {
    if (!project.pingEnabled) {
      return { alive: null, latency: null };
    }

    // 1. 服务端高精度探针
    if (this.hasBackend) {
      try {
        const params = new URLSearchParams();
        if (targetUrl) params.set('url', targetUrl);
        if (project.port) params.set('port', project.port);

        const res = await fetch(`/api/ping?${params.toString()}`, {
          signal: AbortSignal.timeout(3000)
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

  start(getProjectsCallback, getUrlCallback, intervalSec = 20) {
    this.stop();
    const tick = () => {
      const projects = getProjectsCallback();
      this.probeAll(projects, getUrlCallback);
    };

    tick();
    this.timer = setInterval(tick, Math.max(10, intervalSec) * 1000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
