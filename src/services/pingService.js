/**
 * 服务健康探针客户端
 * 主路径：服务端 /api/ping-batch 与 /api/ping
 * 降级：浏览器 no-cors HEAD（仅作连通性 fallback，不是精确测速）
 */
export class PingService {
  constructor(onStatusUpdate) {
    this.onStatusUpdate = onStatusUpdate;
    this.statusMap = {};
    this.timer = null;
    this.hasBackend = true;
    this.probing = false;
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
   * 批量探针：优先提交服务端可信项目 ID；自定义服务附带 URL（服务端会做 SSRF 校验）
   */
  async probeBatchProjects(items) {
    if (!this.hasBackend || items.length === 0) return false;
    try {
      const ids = [];
      const customItems = [];

      for (const item of items) {
        if (!item?.id) continue;
        if (item.trusted) {
          ids.push(item.id);
        } else if (item.url) {
          customItems.push({ id: item.id, url: item.url });
        } else {
          ids.push(item.id);
        }
      }

      const res = await fetch('/api/ping-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: ids.slice(0, 30),
          items: customItems.slice(0, 30)
        }),
        signal: AbortSignal.timeout(8000)
      });

      if (res.ok) {
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
      }
    } catch {
      // 降级到逐个探测
    }
    return false;
  }

  /**
   * 单项目探测：服务端为主，no-cors 仅作受限 fallback
   */
  async probeService(project, targetUrl) {
    if (!project.pingEnabled) {
      return { alive: null, latency: null };
    }

    if (this.hasBackend) {
      try {
        const params = new URLSearchParams();
        if (project.id) params.set('id', project.id);
        if (targetUrl) params.set('url', targetUrl);

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
        // 网络抖动时降级
      }
    }

    // 浏览器 no-cors fallback：opaque 响应只能说明请求发出，不能当作精确时延
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
    if (this.probing) return;
    this.probing = true;

    try {
      const active = projects.filter((p) => p.pingEnabled);
      if (active.length === 0) return;

      active.forEach((p) => {
        this.statusMap[p.id] = { checking: true, ...this.statusMap[p.id] };
      });
      this.onStatusUpdate({ ...this.statusMap });

      const ssrIds = options.trustedIds instanceof Set ? options.trustedIds : null;

      const items = active.map((p) => ({
        id: p.id,
        url: getUrlCallback(p),
        trusted: ssrIds ? ssrIds.has(p.id) : false
      }));

      const batchSuccess = await this.probeBatchProjects(items);
      if (batchSuccess) return;

      const tasks = active.map(async (project) => {
        const url = getUrlCallback(project);
        const result = await this.probeService(project, url);
        this.statusMap[project.id] = { checking: false, ...result };
      });

      await Promise.allSettled(tasks);
      this.onStatusUpdate({ ...this.statusMap });
    } finally {
      this.probing = false;
    }
  }

  start(getProjectsCallback, getUrlCallback, intervalSec = 15, optionsFactory = null) {
    this.stop();
    const tick = () => {
      if (this.probing) return;
      const projects = getProjectsCallback();
      const options = typeof optionsFactory === 'function' ? optionsFactory() : {};
      this.probeAll(projects, getUrlCallback, options);
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
