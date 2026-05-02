# Vibebud

[English](./README.md) | 中文

**一个面向 Codex、Claude Code 和其他智能体的漂浮 AI 小伙伴。**

Vibebud 会给你的编程智能体一个可见的存在感：它是一个漂浮虚拟角色，可以陪你在桌面、网页和 Android 上工作。你可以把它连接到多个 Codex 或 Claude Code 智能体，拖动它、停靠它、和它聊天、把智能体组织成团队、分配任务，并在需要你介入时收到提醒。

[GitHub](https://github.com/shellishack/vibebud) · [Discord](https://discord.gg/9tPu9SQhVz)

## 演示

**把 VibeBud 连接到 Codex 和 Claude Code**

![把 VibeBud 连接到 Codex 和 Claude Code](https://cdn.palmos.ai/assets/VibeBud_0.1_en_under5mb.gif)

**用 Codex 生成新的动画小伙伴形象**

![用 Codex 生成新的动画小伙伴形象](https://cdn.palmos.ai/assets/vibebud_generated_under5mb.gif)

![Vibebud 漂浮小伙伴预览](./assets/buds.png)

## 可以用它做什么

Vibebud 适合正在探索 AI 编程智能体、桌面陪伴应用和更有趣开发工作流的开发者。

| 平台 | 状态 |
| --- | --- |
| Web 预览 (`core/`) | 可用 |
| Electron 桌面端 - Windows | 可用，NSIS 安装包可完整构建 |
| Electron 桌面端 - macOS / Linux | 可用 |
| Android (Capacitor 8) | 已搭建 overlay shell，通过 `OverlayService` 漂浮 |
| iOS | 暂不支持 |

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

## 技术栈

- **`core/`** - Next.js 16 App Router、React 19、Tailwind v4、TypeScript 5、lottie-react。配置为静态导出，方便桌面端从本地文件加载。
- **`desktop/`** - Electron 33 和 electron-builder。透明、始终置顶的窗口覆盖工作区域；默认点击穿透，当鼠标悬停在小伙伴或聊天气泡上时才接收交互。
- **`mobile/`** - Capacitor 8，加上 Android 原生 overlay 模块，可通过前台服务把小伙伴作为 `WindowManager` overlay 运行。

## 自带 LLM Key

聊天功能可以从前端直接调用 OpenAI、Anthropic 或 OpenRouter。你可以在小伙伴设置面板中输入 API key；它会保存在 `localStorage`，除了调用你选择的模型供应商外，不会离开本机。

## 为什么开源？

AI 编程智能体正在进入日常开发，但围绕它们的界面还很早期。Vibebud 是一次开源实验，想让智能体工作更容易跟进，也更有一点个人陪伴感。

欢迎围绕 UI 打磨、智能体集成、小伙伴行为、桌面/移动端外壳、可访问性、文档和产品想法参与贡献。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=shellishack/vibebud&type=Date)](https://www.star-history.com/#shellishack/vibebud&Date)

## 名字

这个应用叫 **Vibebud**：你在氛围编程时的小伙伴。
