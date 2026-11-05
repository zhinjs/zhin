---
layout: home
---

<ZhinHero tagline="用 TypeScript 写一次，让你的 Bot 同时跑在 QQ、微信、飞书、钉钉、Discord、Telegram 等 20+ 平台。文件即能力、跨平台 JSX 互动卡片、Generation 热重载、按需 AI Agent —— 浏览器里一站管理。" />

<ZhinTerminal>
<b>$</b> npm create zhin-app my-bot -y && cd my-bot && pnpm dev<br>
<span>✔ Bot 已启动 —— 打开 http://127.0.0.1:8068/sandbox 立即开聊（无需平台账号或模型 Key）</span>
</ZhinTerminal>

<ZhinRolePaths heading="你想从哪里开始？" intro="无需先读完整套架构。挑一个眼下的目标，每条路径都能在一次会话内走完。" :items="[
  { eyebrow: 'STEP 1 · 30s RUN', title: '跑通第一个 Bot', description: '不需要平台账号和模型 Key，在本地 /sandbox 或 Remote Console 收到第一条回复。', href: '/getting-started/', action: '10 分钟快速开始' },
  { eyebrow: 'STEP 2 · BUILD', title: '编写命令、卡片与 AI 工具', description: '命令、跨平台 JSX 按钮卡片、中间件、定时任务、AI 工具——放进约定目录即刻热重载生效。', href: '/authoring/define-plugin', action: '进入插件开发' },
  { eyebrow: 'STEP 3 · SHIP', title: '接入真实平台并上线', description: '用 npx zhin setup --adapters 接入 QQ / 微信 / 飞书 / Discord 等平台，完成生产部署。', href: '/adapters/', action: '选择平台适配器' },
  { eyebrow: 'NO-CODE · OPERATE', title: '运营与群主（无代码）', description: '在浏览器 Console 里收发消息、表单化改配置、配置群欢迎与提醒、审批高风险动作。', href: '/customer/', action: '打开运营指南' },
]" />

<ZhinFeatureGrid />

<ZhinDuo heading="直观感受 Zhin.js 开发体验">
<template #left>

**文件即命令 + 跨平台 JSX 互动卡片**（`commands/poll/index.tsx`）：支持按钮的平台渲染原生按钮，纯文本平台自动降级为数字选项。

```tsx
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: '发起快速投票',
  params: { topic: { type: 'text', default: '今天发版吗？' } },
  execute: ({ params }) => (
    <card title={`📊 ${params.topic}`}>
      <text>点击按钮（或回复对应序号）：</text>
      <button label="👍 赞成" onClick={(m) => `${m.$sender.name} 投了赞成`} />
      <button label="🤔 再议" onClick={(m) => `${m.$sender.name} 投了再议`} />
    </card>
  ),
});
```

**约定目录自动发现**：无需手写注册样板，保存文件即热重载。

```text
my-bot/
├── plugin.ts                 # Root 插件入口：definePlugin()
├── commands/poll/index.tsx   # /poll 命令（自动发现）
├── middlewares/…             # 每条消息经过的拦截器
├── tools/weather/index.ts    # 给 AI 调用的工具（可选）
└── zhin.config.yml           # configVersion: 2（插件与平台配置）
```

</template>
<template #right>

**3 步跑通本地开发**（无需任何平台账号或模型 Key）：

```bash
npm create zhin-app my-bot -y
cd my-bot && pnpm dev
```

1. **直接开聊**：打开 `http://127.0.0.1:8068/sandbox` 发送 `/hello`
2. **完整后台**：或打开 [console.zhin.dev](https://console.zhin.dev)，填入 `http://127.0.0.1:8068` 与 `.env` 中的 `HTTP_TOKEN`
3. **热重载扩展**：修改 `commands/` 下的文件并保存，无需重启即刻生效

**接下来读哪里**

- 第一次接触，想弄懂核心名词？→ [核心概念速览](/getting-started/concepts)
- 在项目里加命令、卡片、AI 工具 → [快速开始（含 1→2 进阶）](/getting-started/)
- 抽离可复用的独立子插件包 → [编写第一个插件](/getting-started/first-plugin)
- 接入 QQ / 微信 / Discord 等平台 → [平台适配器](/adapters/)
- 接入大模型与工具 → [AI 总览](/ai/)
- 群主 / 运营无代码管理 → [运营与群管指南](/customer/)

</template>
</ZhinDuo>
