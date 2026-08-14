/**
 * 薛定谔的项目 (Schrödinger's Portal) · 开源初始预设配置
 * 
 * 首次启动时的默认服务示例，用户可在网页端随时添加、编辑或删除。
 */
export const DEFAULT_CONFIG = {
  profile: {
    title: "薛定谔的项目",
    subtitle: "心之所向，触手可及",
    avatar: "🐱",
    wanDomain: "example.com"
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
      id: "p-monitor",
      categoryId: "services",
      title: "系统探针监控",
      icon: "📊",
      port: 8080,
      customWanUrl: "https://status.example.com",
      pingEnabled: true
    },
    {
      id: "p-vault",
      categoryId: "services",
      title: "Vaultwarden 密码库",
      icon: "🔐",
      port: 3000,
      customWanUrl: "https://vault.example.com",
      pingEnabled: true
    },
    {
      id: "p-cloud",
      categoryId: "services",
      title: "云盘存储中枢",
      icon: "☁️",
      port: 5244,
      customWanUrl: "https://cloud.example.com",
      pingEnabled: true
    },
    {
      id: "p-blog",
      categoryId: "services",
      title: "个人独立博客",
      icon: "📝",
      port: 80,
      customWanUrl: "https://blog.example.com",
      pingEnabled: true
    },
    {
      id: "p-git",
      categoryId: "services",
      title: "代码与版本管理",
      icon: "🐙",
      port: 3000,
      customWanUrl: "https://git.example.com",
      pingEnabled: true
    },
    {
      id: "p-media",
      categoryId: "services",
      title: "影音媒体中枢",
      icon: "🎬",
      port: 8096,
      customWanUrl: "https://media.example.com",
      pingEnabled: true
    }
  ]
};
