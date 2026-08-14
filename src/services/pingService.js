/**
 * 服务存活与真实网络时延探测引擎
 * 负责与服务端真实 WAN 探针交互，实时同步服务在线状态与真实端到端毫秒延迟
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
   * 全量动态并发真实网络延迟探测 (支持预设服务及用户自添加的任意服务如 Cloudflare)
   */
  async probeBatchProjects(items) {
    if (!this.hasBackend || items.length === 0) return false;
    try {
      const res = await fetch('/api/ping-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
        signal: AbortSignal.timeout(4000)
      });

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
      // 降级到逐个探测
    }
    return false;
  }

  /**
   * 单项目降级探测 (真实浏览器端到端网络测速)
   */
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
        signal: AbortSignal.timeout(3000)
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
    if (active.length === 0) return;

    // 标为检测中
    active.forEach((p) => {
      this.statusMap[p.id] = { checking: true, ...this.statusMap[p.id] };
    });
    this.onStatusUpdate({ ...this.statusMap });

    const items = active.map((p) => ({
      id: p.id,
      url: getUrlCallback(p)
    }));

    // 优先 1 次 POST 批量请求并发测速全部服务（包括 Cloudflare 等用户自建卡片）
    const batchSuccess = await this.probeBatchProjects(items);
    if (batchSuccess) return;

    // 降级并发探测
    const tasks = active.map(async (project) => {
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
