# 能力接缝（Capability Seam）

Capability Seam 是 Agent Runtime 的 **Advanced / experimental** Provider 扩展口。普通插件仍应优先使用
`tools/*.ts`、`agent/skills/*.md` 或 `addTool` / `addSkill`；这些 Feature 能获得 manifest、
owner 可见性、Generation HMR 和冲突校验。Seam 用于 Root Host 需要接入远程能力服务、已有能力注册表，
或不适合落成普通 Feature slot 的 Provider。

## 生产执行路径

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

`CapabilityIngress` 从固定的 Runtime snapshot 读取 Root 的 `capabilitySeamToken`，把服务投影为与
Tool / Skill Feature 相同的 capability snapshot。Seam Tool 不存在独立的
`executeTool(name, args)` 执行通道（遗留同名方法只返回 fail-closed 迁移错误）；只有
`TurnToolRuntime` 可以执行投影后的 Tool。因此：

- 当前 generation 退役或 operation 结束后，Provider 不再可执行；
- `platforms`、`scopes`、`permissions` 和 `hidden` 先经过统一可见性过滤；
- `approval` 由 Turn 的 ApprovalPort 执行；无人值守且需要审批时 fail closed；
- Tool call、denied、failed 和 result 进入同一 Turn Journal；
- Feature 与 Seam 出现同名 Tool / Skill 时，候选能力快照直接拒绝，而不是静默覆盖。

## 服务契约

`ToolService` 提供 schema 和最终 Provider 调用。schema 上的策略字段会进入 canonical
Tool capability；未声明 `approval` 时默认 `on-risk`。

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
      approval: 'never',
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

## Root 注册与生命周期

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

旧 `seamIntegrationToken` Symbol 仅为源码兼容保留，Plugin Runtime Scope 不会消费它。迁移时改用
`capabilitySeamToken`；旧 `executeTool()` / `invokeSkill()` 方法也只返回 fail-closed 错误。

## 作用域和冲突

- `global` Provider 对 Root 下所有 Agent owner 可见；
- 使用 owner 的字符串 ID 注册时，只对对应 owner 查询可见；
- 同一 scope 中 Provider ID 重复会在注册时失败；
- scoped Provider 可以用相同 ID 替代 global Provider；
- 可见 Provider 中 Tool / Skill 名重复会在 capability projection 时失败；
- 每次注册都应保存并调用返回的 disposer，或把整个 Integration 交给 Scope disposer。

## 现有适配器

| 类 | 用途 |
|---|---|
| `BuiltinToolService` | 把 QuestionPort 的交互能力适配为 ToolService；仅用于自定义 Host 组合 |
| `ToolRegistryAsService` | 显式桥接 generation-owned `ToolRegistry`；不会由 Agent Host 自动全局发布 |
| `SkillRegistryAsService` | 显式桥接 generation-owned `SkillRegistry`，并读取 Skill 文档 |

这些适配器不会自动注册。框架内置 Tool / Skill 仍走 Feature projection，避免形成第二套可见性和
生命周期规则。

## 选择 Feature 还是 Seam

| 场景 | 推荐入口 |
|---|---|
| npm 插件中的普通 Tool / Skill | Feature 约定目录或 `addTool` / `addSkill` |
| 需要 manifest、owner 关系和文件级 HMR | Feature |
| Root Host 接入远程 Provider 或已有 registry | Capability Seam |
| 需要绕过审批或直接按名称执行 | 不支持；使用 Turn capability |

相关文档：[插件模型](./plugin-model.md) · [Generation 生命周期](./generation-lifecycle.md) ·
[Agent Tool 创作](../authoring/agent-tools.md) · [架构概览](./architecture.md)
