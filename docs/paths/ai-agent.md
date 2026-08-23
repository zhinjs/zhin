# 从 IM Bot 增加一个受治理的 Agent

目标：在已有消息链上增加模型、工具和插件上下文，同时保持权限、Prompt 与 Runtime generation 可观察。建议先完成 [IM Bot 路径](./im-bot.md)。

## 完成标准

- 私聊或 `ai:` 前缀能触发模型回复。
- Agent 能发现并调用一个 generation-owned Tool。
- Prompt Section 出现在 Console 能力目录，但正文不会泄露。
- 文件、命令和网络权限由策略控制，不由提示词授予。

## 1. 用向导安装完整 AI 拓扑

```bash
npx zhin setup --ai
pnpm install
pnpm dev
```

向导不仅安装模型 SDK，还会挂载 `@zhin.js/tool` 与 `@zhin.js/prompt-section` Feature。只手工安装 `@zhin.js/agent` 不足以建立完整发现拓扑。

云模型 Key 写入 `.env`。本地模型可选择 Ollama，不需要云凭据。

## 2. 核对 provider 与 Agent binding

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

`providers` 定义连接；`agents` 把角色绑定到 provider 和 model。私聊默认可触发 Agent，群或频道可使用 `ai:`、`AI:`、`#` 前缀，或由适配器提供可信 mention 标记。

## 3. 声明一个 Tool

创建 `tools/weather.ts`：

```ts
import { defineAgentTool } from '@zhin.js/tool';
import { z } from 'zod';

export default defineAgentTool<{ city: string }>({
  description: '查询城市实时天气',
  inputSchema: z.object({ city: z.string().min(1) }),
  approval: 'never',
  async execute({ city }) {
    const response = await fetch(
      `https://wttr.in/${encodeURIComponent(city)}?format=3`,
    );
    return response.text();
  },
});
```

文件路径提供本地名称。Tool 进入当前 generation 的能力目录，并按回合权限、平台、场景和审批策略过滤后才对模型可见。

## 4. 给插件补充业务上下文

创建 `agent/prompt-sections/product-language.ts`：

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

Prompt Section 固定到 generation。热更后，新回合读取新版本；已经开始的回合继续使用旧快照。它只改变模型上下文，不增加任何 Tool、文件或网络权限。

## 5. 理解记忆边界

三层 Markdown 记忆默认可被读取：

| 层 | 路径 | 适合保存 |
| --- | --- | --- |
| 部署级 | `data/memory/global/` | 长期产品事实与偏好 |
| 平台级 | `data/memory/platforms/<platform>/` | 群规和平台约束 |
| 会话级 | `data/memory/sessions/<hash>/` | 当前会话笔记 |

“加载记忆”不等于“允许写入”。写文件仍要经过 Turn 的文件策略与 Tool；全局和平台记忆只有 Endpoint Owner 可以写，会话笔记用于普通会话。

## 6. 在 Console 验收

1. “Agent 概览”确认 provider、binding 和当前运行态。
2. “运行时能力”检查 Tool 与 Prompt Section 的 owner、source、generation。
3. 在“渠道与会话”发起请求，观察 Agent 工作台中的步骤和工具结果。
4. 重载 Prompt Section，确认旧回合不被新内容污染。

## 安全原则

- Prompt 说明意图，Tool Feature 提供能力，Host 策略决定授权。
- `required` Prompt Section 放不进预算时应明确失败，不静默截断。
- MCP Server 先在 `ai.mcpServers` 声明，再由 `agents.<name>.mcpServers` 分配。
- 工作目录和 shell 安全策略属于 Turn，不从用户文本或 Prompt 自报获得。

## 下一步

- 完整 Tool、Prompt 与执行策略：[Agent 创作面与安全](../authoring/agent-tools.md)
- 外部工具协议：[MCP 配置](../configuration/#mcpservers-外部-mcp-server)
- 多 Agent 协作空间：[Workroom Kernel](../ai/agent.md#workroom-kernel)
