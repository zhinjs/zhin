# AI Agent modelHarness YAML 覆盖与合并边界

`ai.agent.modelHarness` 允许在主配置中覆盖 TypeScript 默认 harness（`packages/agent/src/zhin-agent/model-harness.ts`），用于无代码调参。

## 配置形状

```yaml
ai:
  agent:
    modelHarness:
      providerPatterns:
        "open*":
          maxIterations: 7
      models:
        "gpt-4o":            # model id
          maxIterations: 8
        "openai:gpt-4o":     # provider:model 精确键
          maxIterations: 9
```

## 合并顺序（约定优先）

1. TypeScript 默认 harness（约定层）
2. `providerPatterns`（匹配当前 provider，按对象插入顺序叠加；实现基于 `Object.entries()`，依赖 ES2015+ 的对象键顺序语义）
3. `models`（`model` 与 `provider:model`）

最终结果使用 deep merge 规则：对象按字段合并；数组若显式写出则完整覆盖默认数组（与 ADR 0006 一致）。

## 未知键与未命中行为

- 未命中 model/provider 时，回退到默认 harness（或空对象）。
- 当前仅消费 `maxIterations`；`modelHarness` 中未知字段会被忽略，不进入运行时有效 harness。

## 与 ADR 0006 的关系

`modelHarness` 仍是主配置的一部分，遵循“默认约定 + 用户覆盖”的同一语义，不引入额外的配置优先级体系。
