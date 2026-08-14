/**
 * 薛定谔的项目 · 纯净预设矩阵 (自动抓取图标 & 纯 URL 端到端探针)
 */
export const DEFAULT_CONFIG = {
  profile: {
    title: "薛定谔的项目",
    subtitle: "心之所向，触手可及",
    avatar: "🐱",
    wanDomain: "as4837.de"
  },
  settings: {
    theme: "light",
    activeHostMode: "wan",
    autoPing: true,
    pingIntervalSeconds: 20,
    openInNewTab: true
  },
  categories: [
    {
      id: "services",
      name: "服务列表",
      icon: "⚡"
    }
  ],
  projects: [
    {
      id: "p-traffic",
      categoryId: "services",
      title: "香港流量监控面板",
      customWanUrl: "https://traffic.as4837.de",
      pingEnabled: true
    },
    {
      id: "p-tz",
      categoryId: "services",
      title: "Komari 探针监控",
      customWanUrl: "https://tz.as4837.de",
      pingEnabled: true
    },
    {
      id: "p-blog",
      categoryId: "services",
      title: "个人独立博客",
      customWanUrl: "https://blog.as4837.de",
      pingEnabled: true
    },
    {
      id: "p-vault",
      categoryId: "services",
      title: "Vaultwarden 密码库",
      customWanUrl: "https://v.as4837.de",
      pingEnabled: true
    },
    {
      id: "p-clouddrive",
      categoryId: "services",
      title: "CloudDrive2 云盘中枢",
      customWanUrl: "https://cd2.as4837.de",
      pingEnabled: true
    },
    {
      id: "p-gallery",
      categoryId: "services",
      title: "Local Image Gallery",
      customWanUrl: "https://img.as4837.de/_gallery/",
      pingEnabled: true
    },
    {
      id: "p-catbox",
      categoryId: "services",
      title: "Catbox 图床与图像服务",
      customWanUrl: "https://catbox.as4837.de",
      pingEnabled: true
    },
    {
      id: "p-qb",
      categoryId: "services",
      title: "qBittorrent 离线下载",
      customWanUrl: "https://qb.as4837.de",
      pingEnabled: true
    }
  ]
};
