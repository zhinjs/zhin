---
title: "能力接缝（Capability Seam）"
description: "让 Root Host 把远程能力服务或已有的工具注册表接入 Agent：何时该用、服务契约、注册方式，以及它如何与普通 Tool 走同一条权限与审批链"
---

# 能力接缝（Capability Seam）

大多数插件**用不到**这一页：写 Tool 和 Skill 请直接用约定目录 `tools/<name>/index.ts`、`skills/<name>/SKILL.md`，或 `addTool` / `addSkill`，它们自带清单、归属、热重载和重名检查。

Capability Seam 是给 **Root Host**（组装整个运行时的那一层）准备的高级扩展口：当你要把一个远程能力服务、已有的工具注册表，或者不适合写成单个文件的能力提供者接入 Agent 时，才需要它。

::: warning 实验性
这是 Advanced / experimental 接口，签名可能随版本调整。
:::

## 先判断要不要用

| 你的情况 | 用什么 |
|---|---|
| 在插件里写普通的 Tool / Skill | 约定目录（`tools/`、`skills/`）或 `addTool` / `addSkill` |
| 需要清单、归属关系、改文件即热重载 | 同上（Feature） |
| 在 Root Host 里接入远程能力服务或已有注册表 | **Capability Seam** |
| 想绕过审批、按名字直接执行工具 | 不支持，任何入口都不行 |

## 写一个能力服务

`ToolService` 提供 schema 和最终 Provider 调用。schema 上的策略字段会进入 canonical
Tool capability；未声明 `requiresApproval` 时默认 `on-risk`。

```ts
import type {
  ToolExecutionResult,
  ToolSchema,
  ToolService,
} from '@zhin.js/agent'

export class SearchService implements ToolService {
  readonly id = 'acme:search'
  readonly description = 'Acme remote search'

  schema(): ToolSchema[] {
    return [{
      type: 'function',
      function: {
        name: 'acme_search',
        description: 'Search the Acme knowledge base',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
      requiresApproval: 'never',
      permissions: ['authenticated'],
      source: 'remote:acme',
    }]
  }

  async execute(_scope, toolName, input, context): Promise<ToolExecutionResult> {
    if (toolName !== 'acme_search') {
      return { success: false, error: `Unknown tool: ${toolName}` }
    }
    if (!context) return { success: false, error: 'Turn context required' }
    context.signal.throwIfAborted()
    return { success: true, output: await searchAcme(input, context.signal) }
  }
}
```

`SkillService` 是声明式目录，不是另一种可直接执行的函数。它通过 `catalog()` 暴露名称和摘要，
通过 `describe()` 返回完整 instructions；Skill 使用哪些 Tool、何时加载和如何进入 prompt，仍由
Agent 的 capability plan 和 prompt assembly 决定。

```ts
import type { SkillService } from '@zhin.js/agent'

export class ResearchSkills implements SkillService {
  readonly id = 'acme:skills'
  readonly description = 'Acme research workflows'

  async catalog() {
    return [{ name: 'acme_research', description: 'Research with Acme sources' }]
  }

  async describe(_scope, skillId: string) {
    if (skillId !== 'acme_research') throw new Error('Skill not found')
    return '# Acme research\nUse acme_search, cite source IDs, then summarize.'
  }
}
```

## 注册到 Root

Seam 是显式的 Root Resource。注册返回幂等 disposer；Root Scope 退役时还要释放整个
`SeamIntegration`。这样 Provider 与候选 Generation 一起 prepare、发布、回滚和释放。

```ts
import {
  SeamIntegration,
  capabilitySeamToken,
} from '@zhin.js/agent'
import { definePlugin } from 'zhin.js/plugin-runtime'
import { ResearchSkills } from './research-skills.js'
import { SearchService } from './search-service.js'

export default definePlugin({
  name: 'my-agent-root',
  setup({ resources }) {
    const seams = new SeamIntegration()
    seams.registerToolService('global', new SearchService())
    seams.registerSkillService('global', new ResearchSkills())

    resources.provide(capabilitySeamToken, seams, () => seams.dispose())
  },
})
```

不要在模块顶层保存 `SeamIntegration`，也不要在 candidate 发布后向旧 Generation 的实例追加
Provider。动态变化应生成新的 Runtime Generation。

Capability Seam 只通过 `capabilitySeamToken` 进入 Plugin Runtime Scope。`SeamIntegration` 只负责
Provider 注册和能力投影，不提供 `executeTool()` / `invokeSkill()` 直接执行方法。

## 它是怎么工作的

Seam 提供的 Tool 和普通 Tool **走同一条执行链**，没有旁路：

```text
Tool / Skill Feature ─┐
                      ├─ CapabilityIngress ─ immutable AgentCapabilities
Root Capability Seam ─┘                         │
                                                ▼
                                          TurnIngress
                                                │
                                                ▼
                                        TurnToolRuntime
                         generation → permission → approval → journal
                                                │
                                                ▼
                                           Provider
```

`CapabilityIngress` 从固定的运行时快照中读取 Root 的 `capabilitySeamToken`，把服务转换成与普通 Tool / Skill 相同的能力描述。Seam Tool 没有单独的 `executeTool(name, args)` 通道，只能由 `TurnToolRuntime` 在一轮对话中执行。由此得到这些保证：

- **跟随热重载**：所属的 generation 退役或本次操作结束后，Provider 不再能被调用；
- **同样的可见性过滤**：`platforms`、`scopes`、`permissions`、`hidden` 和普通 Tool 一样生效；
- **同样的审批**：`requiresApproval` 由这一轮的审批端口处理；无人值守又需要审批时直接拒绝；
- **同样的记录**：调用、被拒、失败和结果都写进同一份执行日志（Turn Journal）；
- **重名直接报错**：普通 Tool 与 Seam 出现同名 Tool / Skill 时，新的能力快照会被拒绝，不会悄悄覆盖。

### 作用域和冲突

- `global` Provider 对 Root 下所有 Agent owner 可见；
- 使用 owner 的字符串 ID 注册时，只对对应 owner 查询可见；
- 同一 scope 中 Provider ID 重复会在注册时失败；
- scoped Provider 可以用相同 ID 替代 global Provider；
- 可见 Provider 中 Tool / Skill 名重复会在 capability projection 时失败；
- 每次注册都应保存并调用返回的 disposer，或把整个 Integration 交给 Scope disposer。

::: details 现有适配器
| 类 | 用途 |
|---|---|
| `BuiltinToolService` | 把 QuestionPort 的交互能力适配为 ToolService；仅用于自定义 Host 组合 |
| `SkillRegistryAsService` | 显式桥接 generation-owned `SkillRegistry`，并读取 Skill 文档 |

这些适配器不会自动注册。框架内置 Tool / Skill 仍走 Feature projection，避免形成第二套可见性和
生命周期规则。
:::

## 相关

- [插件模型](./plugin-model.md)：Feature 与约定目录如何被发现
- [Generation 与生命周期](./generation-lifecycle.md)：能力如何随热重载准备、发布和退役
- [Agent 工具与技能](../authoring/agent-tools.md)：普通插件写 Tool / Skill 的方式
- [分层架构](./architecture.md)：各层职责与依赖方向
