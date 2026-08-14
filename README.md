<div align="center">

# 🐱 薛定谔的项目 (Schrödinger's Portal)

**极简 Apple 风格个人服务器导航与服务健康探针面板**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/Node.js-18%2B-brightgreen.svg)](https://nodejs.org)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ed.svg)](https://www.docker.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/uncat2310/schrodinger-portal/pulls)

*心之所向，触手可及。*

</div>

---

## 📖 项目简介

**薛定谔的项目 (Schrödinger's Portal)** 是一款专注于**极致视觉美学**与**高性能秒开**的现代服务器项目主页与服务聚合中枢。

摒弃了传统 Dashboard 繁复臃肿的图表堆叠，采用类 Apple 原生视觉规范，提供轻巧、纯粹、端正的服务直达与健康状态探测体验。

---

## ✨ 核心特性

- 🍎 **Apple 极简设计规范**：精心调校的卡片圆角、柔和微弥散阴影与高斯模糊毛玻璃（Frosted Glass）质感。
- 🌓 **双模主题自动适配**：原生支持明亮白（Apple Light）与极简暗黑（Apple Dark），支持一键跟随系统偏好切换。
- ⚡ **秒开级极致加载性能**：首屏纯净打包压缩，服务端内存缓存，零外部字体渲染阻塞（0ms FOIT），瞬时秒开。
- 🔍 **Spotlight 聚焦全局搜索**：支持快捷键 `Ctrl + K` / `Cmd + K` 唤起全键盘导航搜索，支持上下键选择与回车直达。
- 💓 **多端健康探测与毫秒时延**：内置零外部依赖的异步健康探针，自动判断服务状态并在卡片上显示实时连通性与时延。
- 📱 **深度移动端适配**：针对 iOS 与 Android 移动设备专门优化，适配灵动岛、刘海屏与底部手势安全区。
- 💾 **无感数据持久化与即时编辑**：支持前端直接添加、修改或删除服务条目，即时同步保存。
- 🐳 **多环境一键部署**：支持 Docker、Docker Compose、Node.js、PM2 或反向代理快速上线。

---

## 🚀 快速开始

### 方式一：Docker Compose（推荐）

1. 克隆代码仓库：
```bash
git clone https://github.com/uncat2310/schrodinger-portal.git
cd schrodinger-portal
```

2. 一键启动容器：
```bash
docker compose up -d
```

3. 打开浏览器访问 `http://localhost:3000` 即可！

---

### 方式二：Node.js 本地 / 服务器运行

#### 运行环境要求
- **Node.js**: 18.0.0 或更高版本
- **NPM** 或 **PNPM** / **Yarn**

#### 步骤
1. 安装依赖并构建：
```bash
npm install
npm run build
```

2. 启动生产服务：
```bash
npm start
```

3. （可选）使用 PM2 在后台常驻运行：
```bash
npm install -g pm2
pm2 start server.js --name "schrodinger-portal"
pm2 save
```

---

## 🛠️ 项目结构

```text
schrodinger-portal/
├── public/                 # 静态资源与矢量图标
│   ├── avatar.jpg          # 默认小猫头像
│   └── favicon.png         # 浏览器标签 Favicon
├── src/
│   ├── data/
│   │   └── defaultConfig.js # 初始默认服务配置
│   ├── services/
│   │   └── pingService.js   # 连通性探针服务
│   ├── app.js              # 前端交互与状态逻辑
│   └── style.css           # 纯 Vanilla CSS 设计系统
├── index.html              # 应用骨架
├── server.js               # 高性能轻量 Node.js 服务端与探针 API
├── Dockerfile              # Docker 多阶段构建文件
├── docker-compose.yml      # 一键容器编排
└── README.md
```

---

## ⌨️ 快捷键支持

| 快捷键 | 功能 |
| :--- | :--- |
| `Ctrl + K` / `Cmd + K` | 呼出 Spotlight 全局服务搜索弹窗 |
| `↑` / `↓` | 在搜索结果中上下切换选项 |
| `Enter` | 直接在当前/新标签页打开所选服务 |
| `ESC` | 关闭当前弹窗或退出搜索 |

---

## 🤝 参与贡献

欢迎提交 Issue 与 Pull Request 共同完善本项目！

1. Fork 本仓库
2. 创建您的功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交您的修改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 协议开源。
