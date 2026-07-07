---
layout: home

hero:
  name: "Zhin.js"
  text: "跨平台 IM 机器人框架"
  tagline: TypeScript 原生 · 插件热重载 · 20+ 平台一套代码 · 可选 AI Agent（&lt;10MB IM 核心）
  image:
    src: /logo.svg
    alt: Zhin
  actions:
    - theme: brand
      text: 5 分钟上手 →
      link: /getting-started/
    - theme: alt
      text: 在线体验 Sandbox
      link: https://demo.zhin.dev
    - theme: alt
      text: GitHub
      link: https://github.com/zhinjs/zhin

features:
  - icon: 💬
    title: 一套代码，多端运行
    details: QQ、Discord、Telegram、飞书、钉钉、Slack、KOOK、邮件、GitHub……Adapter 抽象平台差异，插件逻辑可复用。

  - icon: ⚡
    title: 改完即生效
    details: 插件与配置热重载，保存后自动加载；语法错误自动回滚，不打断正在服务的会话。

  - icon: 📦
    title: 按需安装，体积可控
    details: IM 核心 production 依赖 &lt;10MB；需要 AI、MCP、富媒体时再叠加 @zhin.js/agent 等可选包。

  - icon: 🧠
    title: AI Agent（可选）
    details: 多模型编排、工具调用、会话压缩与安全沙箱；不装 Agent 也能完整使用命令与多平台收发。

  - icon: 🖥️
    title: Remote Console
    details: Host 只提供 API；在 console.zhin.dev 连接本地或 demo，Sandbox 里即时预览消息与卡片。

  - icon: 🛡️
    title: 可验证的架构约束
    details: 统一出站链路、分层依赖与 Harness 检查，减少「能跑但不可维护」的插件写法。
---

## 为什么选择 Zhin.js？

对标 [Karin](https://karin.deno.dev/)、[Koishi](https://koishi.chat/zh-CN/)、[NapCatQQ](https://napneko.github.io/) 等成熟方案，Zhin.js 的文档与产品叙事同样遵循 **先价值、后细节**：

| 叙事层次 | 成熟产品常见做法 | Zhin.js 对应 |
|----------|------------------|--------------|
| 首屏 | 一句话定位 + 主 CTA | 本页 Hero：跨平台框架 +「5 分钟上手」 |
| 第二屏 | 3～6 个利益点卡片 | 上方 Features：多端、热重载、体积、AI、Console、Harness |
| 第三屏 | 可复制的一条命令 | 下方「快速开始」代码块 |
| 深入阅读 | 分路径文档，不一次倾倒 | [学习路径](/essentials/learning-paths) L1→L4 |

若你只想 **先跑起来**：跟 [快速开始](/getting-started/) 走到底即可，不必先读架构。若你要 **接 QQ / NapCat**：见 [平台适配器](/adapters/) 与 [生态](/ecosystem)。

---

## 快速开始

```bash
npm create zhin-app my-bot -y
cd my-bot && pnpm dev
```

启动后打开 [console.zhin.dev](https://console.zhin.dev)，API Base 填 `http://127.0.0.1:8086`，Token 与 `.env` 中 `HTTP_TOKEN` 一致，在 Sandbox 发送 `hello`。

<div class="home-entry-grid">

| 入口 | 适合谁 | 下一步 |
|------|--------|--------|
| [demo.zhin.dev](https://demo.zhin.dev) | 零安装体验 | 直接发 `hello` / `card` |
| `npm create zhin-app` | 独立项目 | [5 分钟首跑](/getting-started/first-run) |
| [minimal-bot](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot) | 贡献者调试 | monorepo 内 `pnpm dev` |

</div>

---

## 三步上手

<div class="home-steps">

### 1 · 创建

脚手架生成 IM-only 黄金路径：Sandbox + Host API + Remote Console，**默认不要求** 云模型 Key。

### 2 · 连接 Console

Host 监听 `8086`（仅 API，无内置网页 UI）。Remote Console 负责聊天预览与配置。

### 3 · 发出第一条消息

Sandbox 发送 `hello` 收到回复即成功；再试 `card` 查看 JSX 卡片示例。

</div>

<p class="home-cta">
  <a class="VPButton brand" href="/getting-started/">继续：安装与首条插件 →</a>
</p>

---

## 10 行代码，一个能用的机器人

```typescript
import { usePlugin, MessageCommand } from 'zhin.js'

const { addCommand } = usePlugin()

addCommand(
  new MessageCommand('hello').desc('打招呼').action(() => '你好！我是 Zhin.js 机器人 🤖'),
)
```

保存后热重载生效。在 Sandbox 或已接入的平台发送 `hello` 即可收到回复。完整插件流程见 [插件开发](/guide/plugin-development)。

---

## 专为开发者打造

<div class="home-dev-grid">

| | 说明 | 文档 |
|---|------|------|
| **TypeScript 原生** | 命令参数、Adapter、AI 工具有完整类型提示 | [核心概念](/essentials/) |
| **消息链路单一出口** | 出站统一经 `Message.$reply` / `Adapter.sendMessage` | [消息如何流转](/essentials/message-flow) |
| **分层安装** | IM / AI / Provider / MCP 分档，控制 node_modules 体积 | [Install tiers](/getting-started/#install-tierszhinjs-4x) |
| **可观测与排错** | `zhin doctor`、内容链 stage 日志、L4 验收脚本 | [疑难排查](/troubleshooting/) |

</div>

---

## 平台与生态

<div class="home-platform-grid">

**IM 平台** — [Sandbox](/adapters/sandbox) · [ICQQ / QQ](/adapters/icqq) · [NapCat](/adapters/napcat) · [Discord](/adapters/discord) · [Telegram](/adapters/telegram) · [飞书](/adapters/lark) · [全部适配器 →](/adapters/)

**工具与扩展** — [插件市场](/plugins/) · [CLI 参考](/reference/cli) · [Remote Console](/console-remote) · [演练场](/playground)

**框架贡献** — [贡献指南](/contributing) · [架构深读](/architecture/) · [ADR 索引](/adr/)

</div>
