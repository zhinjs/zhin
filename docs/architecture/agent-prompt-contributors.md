# Agent Prompt Contributors（适配器级系统提示）

## 目的

将 **平台相关** 的 Agent 编排指引（icqq 发消息、GitHub issue/PR 等）与 **deferred Worker 工具优选策略** 放在各 `plugins/adapters/*` 中；`@zhin.js/agent` 仅保留跨平台纪律与 toolSearch 编排模型。

## 契约（`@zhin.js/core`）

- `AgentPromptSlot`: `orchestrator` | `deferred_worker`
- `AgentPromptContributor`: `platform` + `buildSections` + 可选 `matchesDeferredTask` / `selectDeferredTools`
- 类型定义：[`packages/core/src/agent-prompt.ts`](../../packages/core/src/agent-prompt.ts)

## 注册

适配器在 `provide.mounted` 中：

```ts
import { registerAgentPromptContributor, unregisterAgentPromptContributor } from 'zhin.js';
import { createIcqqAgentPromptContributor } from './agent-prompt.js';

registerAgentPromptContributor(createIcqqAgentPromptContributor());
// dispose: unregisterAgentPromptContributor('icqq');
```

## 解析管线（`@zhin.js/agent`）

每轮 `ZhinAgent.process`：

1. `resolveAgentPromptSections` 按 `toolContext.platform` 查找 Contributor
2. 按 `priority` 排序并限长（`platformPromptSectionMaxChars` / `platformPromptMaxChars`）
3. 触发 `agent:prompt` hook（可变 `sections` 数组，供非适配器插件追加）
4. 格式化为 markdown，注入 `buildRichSystemPrompt` 的 **§6c Platform**

Deferred Worker：`DeferredWorkerRunner` 使用 `deferred_worker` slot + `resolveDeferredToolsForPlatform`。

## 与 Bootstrap / Skills 的边界

| 机制 | 作用域 |
|------|--------|
| `SOUL.md` / `AGENTS.md` / `TOOLS.md` | 工作区全局 Bootstrap |
| `ai.agent.persona` | 全局身份 §1 |
| **AgentPromptContributor** | 按 `platform`（`message.$adapter`） |
| Skills `platforms` | 技能发现；toolSearch 下 orchestrator 仅 reference |

## Debug

`describePromptSectionsForDebug` 含 `§6c_platform` 段字符统计；Contributor 段应使用稳定 `id`（如 `platform.icqq.orchestrator`）。

## 参考实现

- icqq: [`plugins/adapters/icqq/src/agent-prompt.ts`](../../plugins/adapters/icqq/src/agent-prompt.ts)
- github: [`plugins/adapters/github/src/agent-prompt.ts`](../../plugins/adapters/github/src/agent-prompt.ts)
