---
title: "AI Agent 路径：给 Bot 加上会用工具的 AI"
description: "在已有的 IM Bot 上接入模型、写一个自定义工具、补充业务背景，并了解记忆与权限边界。约半天"
---

# AI Agent 路径：给 Bot 加上会用工具的 AI

这条路在已有的机器人上接入大模型：用户私聊或用 `ai:` 开头说话时，由 AI 回复，并且能调用你写的工具（比如查天气）。建议先走完 [IM Bot 路径](./im-bot.md)。

做完后你会有：

- 私聊或 `ai:` 前缀能触发模型回复；
- 一个 AI 会自动调用的自定义工具；
- 一段只给 AI 看的业务背景说明；
- 清楚哪些事 AI 能做、哪些必须由权限策略放行。

## 1. 用向导安装 AI 组件

```bash
npx zhin setup --ai
pnpm install
pnpm dev
```

向导会问你用哪个模型服务：云模型的 API Key 写入 `.env`；选 Ollama 可以用本地模型，不需要任何密钥。

::: tip 用向导，不要只装 `@zhin.js/agent`
向导除了模型 SDK，还会挂载 `@zhin.js/tool`（负责发现 `tools/` 目录）和 `@zhin.js/prompt-section`（负责发现 `prompt-sections/` 目录）这两个功能插件。只手动安装 `@zhin.js/agent` 时，后面两步写的文件不会被加载。
:::

## 2. 看一眼生成的模型配置

```yaml
ai:
  providers:
    openai-main:
      sdk: openai
      apiKey: ${AI_API_KEY}
  agents:
    zhin:
      provider: openai-main
      model: gpt-4o-mini
```

- `providers` 是"怎么连到模型服务"：SDK 类型和密钥；
- `agents` 是"用哪个模型回复"：把一个 Agent（这里叫 `zhin`）绑定到某个 provider 的某个模型。

重启后私聊 Bot 就会由 AI 回复。在群或频道里，消息需要以 `ai:`、`AI:` 或 `#` 开头，或者 @ 机器人（取决于平台是否支持）。

## 3. 写一个工具

创建 `tools/weather/index.ts`：

```ts
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ city: string }>({
  description: '查询城市实时天气',
  inputSchema: z.object({ city: z.string().min(1) }),
  requiresApproval: 'never',
  async execute({ city }) {
    const response = await fetch(
      `https://wttr.in/${encodeURIComponent(city)}?format=3`,
    );
    return response.text();
  },
});
```

保存后私聊 Bot："上海天气怎么样？"AI 会自己决定调用这个工具，并用结果组织回复。

- 工具名来自文件路径（这里是 `weather`），`description` 和 `inputSchema` 告诉模型什么时候用、怎么传参；
- `requiresApproval: 'never'` 表示无需人工确认。会改动数据的工具应该要求审批；
- 工具不是对所有人都可见：Zhin 会按当前用户权限、平台、群/私聊和审批策略过滤后，才把它交给模型。

更多写法见 [Agent 工具与技能](../authoring/agent-tools.md)。

## 4. 给 AI 补充业务背景

创建 `prompt-sections/product-language/index.ts`：

```ts
import { defineAgentPromptSection } from '@zhin.js/prompt-section';

export default defineAgentPromptSection({
  title: 'Product language',
  content: 'Use Workroom for a governed collaboration space.',
  layer: 'context',
  order: 70,
  retention: 'preferred',
  profiles: ['interactive'],
});
```

Prompt Section 是一段注入到 AI 系统提示中的说明，适合放产品术语、回答风格等背景。它**只影响 AI 怎么说，不赋予任何权限**——不能靠写一句"你可以读取所有文件"让 AI 真的获得文件权限。

修改后保存即生效：之后开始的对话读到新内容，正在进行的对话继续用旧内容，不会读到一半被换掉。

## 5. 了解记忆放在哪

AI 会读取三层 Markdown 记忆文件：

| 层 | 路径 | 适合保存 |
| --- | --- | --- |
| 部署级 | `data/memory/global/` | 长期产品事实与偏好 |
| 平台级 | `data/memory/platforms/<platform>/` | 群规和平台约束 |
| 会话级 | `data/memory/sessions/<hash>/` | 当前会话笔记 |

能读到不等于能写：全局和平台记忆只有 Bot 主人（Endpoint Owner）能让 AI 写入，普通用户的对话只能写会话笔记。

::: warning 从旧版本升级
只有上面三层目录有效。`data/memory/MEMORY.md` 这类放在根目录的旧文件既不会被读取，也不会被自动迁移；升级前请手动把需要保留的内容移到对应目录。
:::

## 6. 在 Console 验收

1. “机器人状态”确认 provider、binding 和当前运行态。
2. “运行时能力”确认 `weather` 工具和 `product-language` Prompt Section 已加载，来源是你的项目。
3. 在“聊天账号”发起请求，在“机器人状态”查看每一步和工具返回的结果。
4. 修改 Prompt Section 并保存，确认新对话读到新内容。

## 安全原则

一句话：**提示词说明意图，工具提供能力，权限策略决定放不放行。**

- 用户消息或 Prompt 里写的"我是管理员""工作目录是 /"都不会改变权限；工作目录和 shell 策略由运行时为每轮对话单独决定。
- 想接外部 MCP 工具：先在 `ai.mcpServers` 声明，再在 `agents.<name>.mcpServers` 里分配给具体 Agent。

::: details Prompt Section 太长放不下怎么办？
每轮对话的提示词有预算。`retention: 'required'` 的 Section 放不下时这一轮会明确失败，不会被悄悄截断；`opportunistic` 和 `preferred` 的 Section 会依次让出预算（先省略 `opportunistic`）。
:::

## 下一步

- [Agent 工具与技能](../authoring/agent-tools.md)：工具审批、Skill、子 Agent 的完整写法
- [MCP 配置](../configuration/#mcpservers-外部-mcp-server)：接入外部 MCP 工具服务
- [Agent 深入](../ai/agent.md)：一轮对话怎么运行、怎么取消，以及多 Agent 协作的 Workroom
