# 能力接缝（Capability Seams）

## 什么是能力接缝？

能力接缝是 Zhin.js 中统一的扩展点模型。所有能力（LLM / Tool / Skill）都遵循同一套三角架构：

```
┌─────────────────────────────────┐
│ Service Definition (接口规范)    │
│ 定义能力提供者必须实现的方法      │
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────┐
│ Service Provider (实现)          │
│ 具体的能力提供者（插件等）        │
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────┐
│ Consumer (消费方)                │
│ 使用能力的核心模块               │
└─────────────────────────────────┘
```

## 三种能力

### 1. LLM Service
- **定义**：大语言模型适配（`AIProvider` in `@zhin.js/ai`）
- **消费方**：`AgentDispatcher`
- **示例**：DeepSeek API、OpenAI API

### 2. Tool Service（`ToolService`）
- **定义**：原子操作（读文件、调 API 等）
- **消费方**：`AgentDispatcher`（工具执行）、`PromptAssemblyRegistry`（schema 注入）
- **示例**：内置工具（`BuiltinToolService`）、平台工具、插件工具

### 3. Skill Service（`SkillService`）
- **定义**：复合能力（通常由多个 Tool 组合而成）
- **消费方**：`AgentDispatcher`
- **示例**：GitHub Skill、数据分析 Skill

## 核心组件

### `SeamProvider`

所有 Service Provider 的基接口：

```typescript
interface SeamProvider {
  readonly id: string;         // 唯一标识符，格式建议：namespace:name
  readonly description: string;
  readonly tags?: string[];
  readonly version?: string;
}
```

### `SeamProviderRegistry<T>`

类型安全的提供者注册表，支持作用域隔离：

```typescript
const registry = new SeamProviderRegistry<ToolService>();
registry.register('global', myToolService);        // 全局可见
registry.register('agent-1', scopedService);       // 仅 agent-1 可见

registry.getFor('agent-1');  // 返回 global + agent-1 的所有提供者
registry.getById('global', 'zhin:builtin-tools');
```

### `SeamIntegration`

统一管理 Tool 和 Skill 两类能力注册表，并提供便利方法：

```typescript
const seamIntegration = new SeamIntegration();

// 注册服务
seamIntegration.registerToolService('global', new BuiltinToolService());
seamIntegration.registerSkillService('global', new SkillRegistryAsService(skillRegistry));

// 收集所有 Tool Schema（用于 LLM 工具描述）
const schemas = seamIntegration.getToolSchemas('global');

// 执行工具
const result = await seamIntegration.executeTool('global', 'ask_user', { question: 'Sure?' });

// 收集 Skill 目录
const catalog = await seamIntegration.getSkillCatalog('global');
```

## 实现一个 Tool Service

```typescript
// packages/my-plugin/src/tool-service.ts
import type { ToolService, ToolSchema, ToolExecutionResult, SeamScope } from '@zhin.js/agent';

export class MyToolService implements ToolService {
  readonly id = 'my-plugin:tools';
  readonly description = 'My custom tools';

  schema(_scope: SeamScope | 'global'): ToolSchema[] {
    return [{
      type: 'function',
      function: {
        name: 'greet',
        description: 'Greet someone by name',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'The name to greet' },
          },
          required: ['name'],
        },
      },
    }];
  }

  async execute(
    _scope: SeamScope | 'global',
    toolName: string,
    args: unknown,
  ): Promise<ToolExecutionResult> {
    if (toolName === 'greet' && typeof args === 'object' && args !== null) {
      const { name } = args as { name: string };
      return { success: true, output: `Hello, ${name}!` };
    }
    return { success: false, error: `Unknown tool: ${toolName}` };
  }
}
```

## 实现一个 Skill Service

```typescript
// packages/my-plugin/src/skill-service.ts
import type { SkillService, SkillMetadata, SkillInvocationRequest, SkillInvocationResult, SeamScope } from '@zhin.js/agent';

export class MySkillService implements SkillService {
  readonly id = 'my-plugin:skills';
  readonly description = 'My custom skills';

  async catalog(_scope: SeamScope | 'global'): Promise<SkillMetadata[]> {
    return [
      { name: 'data-analysis', description: 'Analyze data files', keywords: ['data', 'csv', 'json'] },
    ];
  }

  async describe(_scope: SeamScope | 'global', skillId: string): Promise<string> {
    if (skillId === 'data-analysis') return 'Reads and summarizes data files.';
    throw new Error(`Skill not found: ${skillId}`);
  }

  async invoke(
    _scope: SeamScope | 'global',
    request: SkillInvocationRequest,
  ): Promise<SkillInvocationResult> {
    // 执行 skill 逻辑
    return { success: true, output: `Invoked ${request.skillId}` };
  }

  isAvailable(_scope: SeamScope | 'global', skillId: string): boolean {
    return skillId === 'data-analysis';
  }
}
```

## 作用域隔离

每个能力都支持作用域隔离，避免不同 agent/session 间的冲突：

```typescript
const seamIntegration = new SeamIntegration();

// 在 agent-specific 作用域中注册
seamIntegration.registerToolService(agentScope, toolService);

// 查询时也需要指定作用域（自动包含 global 提供者）
const schemas = seamIntegration.getToolSchemas(agentScope);
```

## 内置实现

| 类 | 路径 | 说明 |
|---|---|---|
| `BuiltinToolService` | `packages/im/agent/src/builtins/builtin-tool-service.ts` | 框架内置工具（ask_user 等）的接缝接入 |
| `SkillRegistryAsService` | `packages/im/agent/src/skill/skill-registry-as-service.ts` | 将 `SkillRegistry` 适配为 `SkillService` |

## DI Token

```typescript
import { seamIntegrationToken, SeamIntegration } from '@zhin.js/agent';

// 在 context.resources 中提供
context.resources.provide(seamIntegrationToken, seamIntegration);

// 在消费方使用
const seamIntegration = context.resources.use(seamIntegrationToken);
```

## 最佳实践

1. **一个 Service = 一个单一职责** — 不要混合 Tool/Skill 能力
2. **始终检查 `isAvailable?()`** — 在作用域中验证能力可用性
3. **应用策略** — 通过 `applyPolicy()` 进行权限和安全检查
4. **返回类型规范** — 始终返回标准的 `ToolExecutionResult` / `SkillInvocationResult` 对象
5. **唯一 ID** — 使用 `namespace:name` 格式避免冲突，例如 `zhin:builtin-tools`

## 相关文件

- [架构概览](./architecture.md)
- [插件模型](./plugin-model.md)
- [消息发送链路](./message-flow.md)
