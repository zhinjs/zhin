---
title: "IM Bot 路径：交付一个不用 AI 的机器人"
description: "从 Sandbox 开始，加一个命令、一条定时通知，再接入真实聊天平台并在 Console 中验收。约 1 小时，不涉及模型"
---

# IM Bot 路径：交付一个不用 AI 的机器人

这条路带你做一个"收到消息 → 执行业务 → 回复或主动通知"的机器人。大约 45–60 分钟，全程不需要模型或 API Key。

做完后你会有：

- 一个自定义命令 `/roll`，保存代码后无需重启就会更新；
- 一条每天定时发送的通知；
- 至少一个真实聊天平台（QQ、Discord、Slack……）上线。

## 1. 先在 Sandbox 里跑通

```bash
npm create zhin-app my-bot -y
cd my-bot
pnpm dev
```

Sandbox 是内置的模拟聊天窗口，不需要任何平台账号。用终端打印的 API Base 和 `.env` 中的 `HTTP_TOKEN` 连接 [Console](https://console.zhin.dev)，打开侧栏「机器人 → 试聊一下」（Sandbox），发送 `/hello`，确认有回复。

## 2. 添加一个命令

创建 `commands/roll/index.ts`：

```ts
import { defineCommand } from 'zhin.js/command';

export default defineCommand({
  description: '掷一个六面骰子',
  execute: () => `🎲 ${1 + Math.floor(Math.random() * 6)}`,
});
```

保存后在 Sandbox 发送 `/roll`，不用重启就能看到骰子点数。

命令名来自文件路径：`commands/roll/index.ts` 就是 `/roll`，`commands/gh/issue/index.ts` 就是 `/gh issue`。参数、权限等写法见 [命令](../authoring/commands.md)。

## 3. 添加定时通知

下面在插件入口里注册一个每天 9 点执行的任务。定时器只决定"什么时候做"；真正发消息要通过 `outboundHostToken` 取到的出站服务，这样 Sandbox 和真实平台走的是同一条发送链路。

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

在配置里填好 `morningTarget` 后任务才会注册：

- `endpointKey` 填 Console“聊天账号”中显示的完整 Endpoint 标识（Endpoint 就是 Bot 在某个平台上登录的一个账号）；
- `cron` 是六段格式：秒、分、时、日、月、周；
- `context.lifecycle.add()` 让插件在热重载或停用时自动注销旧任务，不会重复发送。

::: details 为什么要先检查 `resources.has(outboundHostToken)`？
`outboundHostToken`、`scheduleHostToken` 这类 Host token 是运行时提供给插件的服务。只有当前运行时装配了对应服务，插件才能取到；提前检查可以让插件在没有出站能力的环境（例如某些测试）里安静地跳过，而不是报错。详见 [Host 能力](../authoring/host-tokens.md)。
:::

## 4. 接入真实平台

```bash
npx zhin setup --adapters
pnpm install
pnpm dev
```

向导会问你要接哪个平台，然后同时修改 `package.json#zhin.plugins`、`zhin.config.yml` 和 `.env`。账号密钥只写进 `.env`，配置文件里只保留 `${变量}` 引用。

刚才写的 `/roll` 和定时通知不用改：命令不依赖具体平台，从 Sandbox 换到 QQ、Discord 或 Slack 时业务代码保持不变。各平台的准备工作见 [平台适配器](../adapters/index.md)。

## 5. 在 Console 验收

1. “聊天账号”确认 Endpoint 在线并发送测试消息。
2. “运行时能力”确认 `/roll` 已加载，并且是最新保存的版本。
3. “日志”检查命令和主动通知没有错误。
4. 重启 Host，再重复一次真实平台测试。

## 容易踩的坑

- **配置写错地方**：`zhin.config.yml` 只保存配置值；装了哪些插件只写在 `package.json#zhin.plugins`。
- **绕过发送链路**：主动发消息用 `outboundHostToken`，不要自己保存适配器实例去调用它的发送方法。
- **cron 少一段**：定时任务是六段（秒在最前），`0 9 * * *` 这种五段写法会被拒绝。

## 下一步

- [AI Agent 路径](./ai-agent.md)：让 Bot 能用模型对话、调用工具
- [Console 管理路径](./console.md)：在浏览器里管理多个账号、排查问题
- [命令](../authoring/commands.md)：给命令加参数、权限和子命令
