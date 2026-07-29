# IM Bot 路径（无 AI，约 1 小时）

目标：一个响应命令、能发通知的聊天机器人。不碰任何 AI 概念。

想先确认「框架能不能跑」？仓库里的 [single-file-bot](../examples/index.md#single-file-bot-一个-botts-就是机器人) 一个 `bot.ts` 就能在 Console Sandbox 里回 `/hello`。

## 1. 创建项目（2 分钟）

```bash
npm create zhin-app my-bot -y
cd my-bot
pnpm dev
```

`-y` 走 IM-only 黄金路径：Sandbox 适配器（本地调试）+ Remote Console，**不需要任何云 Key**。
看到启动日志后，打开 [console.zhin.dev](https://console.zhin.dev)，
Host 填 `http://127.0.0.1:8086`，token 在 `.env` 的 `HTTP_TOKEN`。Sandbox 里发 **`/hello`** 应有回复。

## 2. 写第一个命令（5 分钟）

项目里已有一个 `hello` 命令。照它再写一个——在 `commands/` 新建 `roll.ts`：

```ts
import { defineCommand } from '@zhin.js/command'

export default defineCommand({
  description: '掷骰子',
  execute: () => `🎲 ${1 + Math.floor(Math.random() * 6)}`,
})
```

保存即热重载。在 Console 的 Sandbox 里发 `roll` 就有回应。

**规则只有一条**：`commands/` 下的文件路径就是命令名（`commands/gh/issue.ts` → 命令 `gh issue`）。

## 3. 定时通知（10 分钟）

需要"每天 9 点往群里发一句"？用 schedule host——在 `plugin.ts` 的 `setup()` 里：

```ts
import { definePlugin, scheduleHostToken } from '@zhin.js/plugin-runtime'

export default definePlugin({
  name: 'my-bot',
  setup(ctx) {
    if (ctx.resources.has(scheduleHostToken)) {
      const schedule = ctx.resources.use(scheduleHostToken)
      schedule.register({
        id: 'my-bot/morning',
        cron: '0 0 9 * * *',
        description: '早安推送',
        async execute() { /* 通过 outbound host 发消息 */ },
      })
    }
  },
})
```

## 4. 接真实平台（20 分钟）

```bash
npx zhin setup    # 交互向导：选平台 → 填凭据（敏感信息自动写 .env）
```

向导支持全部 20 个平台（QQ 官方 / icqq / 微信 / Discord / Slack / Telegram…），
QQ 官方和微信 iLink 还能**扫码绑定**，不用手动找 token。

生成的配置长这样（凭据只占位，真实值在 `.env`）：

```yaml
plugins:
  qq:
    mode: websocket
    endpoints:
      - name: my-bot
        appid: ${QQ_APPID}
        secret: ${QQ_SECRET}
```

重启即上线。**一个 bot 要挂多个账号**？`endpoints` 数组再加一项就行。

## 5. 你现在已经会的

- 命令 = `commands/` 下的文件
- 配置 = `zhin.config.yml`（平台）+ `.env`（凭据）
- 管理 = Remote Console（发消息 / 改配置 / 看日志 / 管定时任务）

## 下一步

- 想要 AI 对话 → [AI Agent 路径](./ai-agent.md)
- 想管多个账号/平台 → [Console 管理路径](./console.md)
- 想写复杂插件 → [插件开发](../authoring/define-plugin.md)
