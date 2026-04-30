# Vibebud

[English](./README.md) | 中文

**一个在你氛围编程时陪着你的 AI 小伙伴。**

Vibebud 会给你的 AI 编程智能体一个可见的存在感：它可以作为漂浮在桌面、网页或手机上的小伙伴，和你聊天、显示状态，并在需要你介入时轻轻提醒。

```text
       你的代码编辑器                  Vibebud
  +------------------------+        +-------------+
  | issue、分支、测试      |  <-->  |  漂浮伙伴   |
  | AI 智能体正在工作      |        |  状态展示   |
  | commit、PR、review     |        |  快速聊天   |
  +------------------------+        +-------------+
```

AI 智能体的工作不应该只藏在终端、日志和后台进程里。Vibebud 想让这些工作变得更可见、更容易跟进，也更有陪伴感。

![Vibebud 漂浮小伙伴预览](./assets/buds.png)

## 核心想法

氛围编程更好玩的时候，是工具也有一点“活着”的感觉。

Vibebud 是一个面向 AI 辅助开发的轻量陪伴层。它不替代编辑器、终端、GitHub 或智能体框架，而是给这些工作流一个更友好的入口：

- 一眼看到智能体正在做什么
- 不切换上下文就能和小伙伴聊天
- 任务完成或需要输入时收到轻量提醒
- 按不同头像分配简单待办
- 让多个智能体人格在工作时保持可见

## 使用体验

```text
智能体开始任务      -> 小伙伴进入活跃状态
智能体需要决策      -> 小伙伴发出轻量提醒
智能体完成工作      -> 小伙伴显示简短状态
你想快速回复        -> 打开小聊天气泡
你需要专注          -> 把小伙伴停靠或移到一边
```

目标很简单：让 AI 协作者更容易被监督，同时不让你的工作空间变得更重。

## 可以用它做什么

Vibebud 适合正在探索 AI 编程智能体、桌面陪伴应用和更有趣开发工作流的开发者。

| 平台 | 状态 |
| --- | --- |
| Web 预览 (`core/`) | 可用 |
| Electron 桌面端 - Windows | 可用，NSIS 安装包可完整构建 |
| Electron 桌面端 - macOS / Linux | 计划中，尚未接入 |
| Android (Capacitor 8) | 已搭建 overlay shell，通过 `OverlayService` 漂浮 |
| iOS | 暂不支持 |
| 可选后端 | 账号、同步、备份、订阅状态和托管 AI 调用 |

## 人格与分组

每个小伙伴都有名字、角色和自己的 system prompt。内置六种人格：

- **Helper** - 通用助手
- **Tactician** - 规划和优先级判断
- **Researcher** - 查找资料、参考和先例
- **Skeptic** - 批判性审查，追问假设
- **Cheerleader** - 积极鼓励
- **Empath** - 先倾听、理解，再给建议

把两个小伙伴拖到一起，它们会组成一个小团队。界面会显示一个柔和的团队背景，每个成员也会知道自己的队友是谁，以便在合适时交给更擅长的角色处理。

## 快速开始

```bash
# 安装 core 和 desktop 的依赖
npm run install-all

# Web 预览：http://localhost:3060
npm run web-dev
```

运行桌面端：

```bash
# Electron 会连接正在运行的 web dev server
# 需要和 npm run web-dev 分别在两个终端中运行
npm run desktop-dev
```

可选后端：

```bash
# 运行在 http://localhost:3070
npm run server-dev
```

构建命令：

```bash
# 构建 core，复制到 desktop，并用静态导出运行 Electron
npm run desktop-run

# Windows 安装包 -> desktop/dist/vibebud-desktop-setup.exe
npm run desktop-build

# 在已连接设备或模拟器上构建 Android debug APK
npm run android-dev

# Android release APK
npm run android-build
```

开发服务器运行在 **3060 端口**，不是 3000。桌面窗口会加载 `/buddy` 路由，该页面使用透明背景，所以屏幕上只会显示小伙伴本身。

## 项目结构

```text
vibebud/
├── core/        # 共享 Next.js UI：Web 应用和桌面端打包 UI
├── desktop/     # Electron 外壳
└── mobile/      # Capacitor 外壳
```

能放在 `core/` 里的代码都应该放在那里。平台外壳保持尽量薄。

可选后端位于当前包的 `../server/`。

## 技术栈

- **`core/`** - Next.js 16 App Router、React 19、Tailwind v4、TypeScript 5、lottie-react。配置为静态导出，方便桌面端从本地文件加载。
- **`desktop/`** - Electron 33 和 electron-builder。透明、始终置顶的窗口覆盖工作区域；默认点击穿透，当鼠标悬停在小伙伴或聊天气泡上时才接收交互。
- **`mobile/`** - Capacitor 8，加上 Android 原生 overlay 模块，可通过前台服务把小伙伴作为 `WindowManager` overlay 运行。
- **`../server/`** - 可选的轻量 Node.js 后端，用于登录、同步快照、备份、订阅状态和托管 AI 代理调用。

## 自带 LLM Key

聊天功能可以从前端直接调用 OpenAI、Anthropic 或 OpenRouter。你可以在小伙伴设置面板中输入 API key；它会保存在 `localStorage`，除了调用你选择的模型供应商外，不会离开本机。

如果要做托管产品模式，`../server/` 可以提供账号、同步、备份、订阅状态，以及通过服务端 key 发起的托管 AI 调用。详见 [`../server/README.md`](../server/README.md)。

## 为什么开源？

AI 编程智能体正在进入日常开发，但围绕它们的界面还很早期。Vibebud 是一次实验，想让智能体工作变得：

- 更可见
- 更容易接近
- 更容易监督
- 更有一点个人陪伴感

欢迎围绕 UI 打磨、智能体集成、小伙伴行为、桌面/移动端外壳、可访问性、文档和产品想法参与贡献。

## 名字

这个应用叫 **Vibebud**：你在氛围编程时的小伙伴。
