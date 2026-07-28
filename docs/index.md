---
layout: home

hero:
  name: Zhin.js
  text: TypeScript 多通道 IM Bot 框架
  tagline: 插件化 · 热重载 · Remote Console · 可选 AI Agent 栈——为生活/工作助手 Bot 而生
  image:
    src: /logo.svg
    alt: Zhin.js
  actions:
    - theme: brand
      text: 快速开始
      link: /getting-started/
    - theme: alt
      text: 示例速览
      link: /examples/
    - theme: alt
      text: GitHub
      link: https://github.com/zhinjs/zhin

features:
  - title: 插件化内核
    details: 一个 package.json#zhin 清单 + 一个 plugin.ts 即是一个可运行插件；命令、组件、适配器走约定目录，改文件即热重载。
  - title: 多平台适配器
    details: Sandbox、QQ、OneBot、Discord、Telegram、Slack、KOOK、钉钉、飞书、企业微信、LINE 等适配器按需挂载，统一消息链路。
  - title: Remote Console
    details: Host 只暴露 API，浏览器打开 console.zhin.dev 即可管理插件、查看实例与日志，无需本地部署前端。
  - title: AI 按需加装
    details: 默认安装仅 IM 核心（库包 <10MB）；需要 AI 时再装 @zhin.js/agent + zod + ai + 所选 @ai-sdk/*。
  - title: 插件即应用
    details: 插件目录里放一个 zhin.config.yml，zhin runtime start 直接启动——不需要额外宿主代码。
  - title: 分层架构
    details: basic → kernel → ai → core → agent → zhin 单向依赖，每一层可独立使用（kernel 可作纯插件引擎，ai 可作 LLM 引擎）。
---

## 一分钟跑起来

```bash
npm create zhin-app my-bot
cd my-bot
pnpm dev
```

`-y` 走 IM 黄金路径：无需任何模型 Key 即可启动。

## 一个插件长这样

`plugin.ts`：

```ts
import { definePlugin } from 'zhin.js/plugin-runtime';

export default definePlugin({
  name: 'minimal-bot',
  metadata: { displayName: 'Minimal Bot' },
});
```

`commands/hello.ts`：

```ts
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: 'Stable IM command smoke',
  execute: () => 'Hello from minimal-bot.',
});
```

启动后在终端输入 `/hello`，Bot 即回复。以上代码来自仓库内可直接运行的
[minimal-bot 示例](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot)。

## 下一步

- [安装与启动](/getting-started/)：环境要求、三种启动路径、安装分层
- [编写第一个插件](/getting-started/first-plugin)：从空目录到可运行插件
- [示例速览](/examples/)：minimal-bot / capabilities-bot / full-bot / test-bot 的定位与跑法
