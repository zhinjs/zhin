# 交付一个无 AI 的 IM Bot

目标：完成“接收消息 → 执行业务 → 回复或主动通知”的闭环。预计 45–60 分钟，不涉及模型、Prompt 或 Agent。

## 完成标准

- Sandbox 中 `/roll` 能稳定回复。
- 保存代码后，新 generation 自动生效。
- 至少一个真实平台 Endpoint 在线。
- 主动通知使用 Runtime 出站能力，而不是直接调用适配器实例。

## 1. 从可重复的 Sandbox 开始

```bash
npm create zhin-app my-bot -y
cd my-bot
pnpm dev
```

用终端打印的 API Base 和 `.env` 中的 `HTTP_TOKEN` 连接 Console。进入“渠道与会话”中的 Sandbox，先确认 `/hello` 有回复。

## 2. 添加一个命令

创建 `commands/roll.ts`：

```ts
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: '掷一个六面骰子',
  execute: () => `🎲 ${1 + Math.floor(Math.random() * 6)}`,
});
```

保存后发送 `/roll`。文件路径提供命令路由；例如 `commands/gh/issue.ts` 对应 `/gh issue`。

## 3. 添加主动通知

定时任务只决定“何时执行”；消息仍应经过 `outboundHostToken`，这样 Sandbox 和真实平台共用同一条出站链路。

```ts
import {
  definePlugin,
  outboundHostToken,
  scheduleHostToken,
} from 'zhin.js';

interface Config {
  morningTarget?: {
    adapter: string;
    endpointKey: string;
    conversation: { kind: 'private' | 'group' | 'channel'; id: string };
  };
}

export default definePlugin<Config>({
  name: 'my-bot',
  setup(context) {
    const target = context.config.get().morningTarget;
    if (!target) return;
    if (!context.resources.has(outboundHostToken)) return;
    const outbound = context.resources.use(outboundHostToken);
    const schedule = context.resources.use(scheduleHostToken);

    context.lifecycle.add(schedule.register({
      id: 'my-bot/morning',
      cron: '0 0 9 * * *',
      description: '每天 9 点发送早安',
      execute: async () => {
        await outbound.send({
          ...target,
          content: '早上好',
        });
      },
    }));
  },
});
```

`endpointKey` 使用 Console“渠道与会话”显示的完整 Endpoint identity。`lifecycle.add()` 保证热重载退休旧 generation 时注销旧任务。

## 4. 接入真实平台

```bash
npx zhin setup --adapters
pnpm install
pnpm dev
```

向导会同时修改 `package.json#zhin.plugins`、`zhin.config.yml` 和 `.env`。凭据只进入 `.env`，配置文件保留变量引用。

一个适配器实例可声明多个 Endpoint。业务命令和组件不应依赖具体适配器，因此从 Sandbox 切换到 QQ、Discord 或 Slack 时无需重写业务层。

## 5. 在 Console 验收

1. “渠道与会话”确认 Endpoint 在线并发送测试消息。
2. “运行时能力”确认 `/roll` 来自当前 generation。
3. “日志”检查命令和主动通知没有错误。
4. 重启 Host，再重复一次真实平台测试。

## 常见边界

- `zhin.config.yml` 保存配置；插件挂载关系只写 `package.json#zhin`。
- 主动消息通过 `outboundHostToken`，不要持有全局 Adapter 实例。
- 定时任务是六段 cron：秒、分、时、日、月、周。
- 只有对应 Host token 已装配时，插件才能使用该能力。

## 下一步

- 让 Bot 使用模型与工具：[AI Agent 路径](./ai-agent.md)
- 管理多个账号和运行态：[Console 管理路径](./console.md)
- 深入命令参数与权限：[命令系统](../authoring/commands.md)
