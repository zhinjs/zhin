---
name: plugin-test
description: "为 Zhin.js 插件编写和运行测试（Plugin Runtime）。Use when asked to write tests, add test coverage, or verify defineCommand / definePlugin behavior. 引导编写符合 Runtime 的 Vitest 测试。"
keywords:
  - 测试
  - test
  - vitest
  - 测试用例
  - coverage
  - defineCommand
tags:
  - development
  - testing
  - quality
---

# Zhin 插件测试（Plugin Runtime）

为 Plugin Runtime 插件写 Vitest 测试。**不要**再测 `new Plugin('/path')` / `usePlugin` / `MessageCommand` 旧生命周期——CLI 路径是 `zhin runtime start`。

## 适用场景

- 「帮我写测试」「增加覆盖率」「测试这个命令」
- 新功能配套测试、发布前验证

## 环境

```bash
pnpm test
pnpm test:watch
pnpm test:coverage
```

全局 API 已注入（`describe` / `it` / `expect` / `vi`）。根 `vitest.config.ts`：`globals: true`，匹配 `**/*.test.ts`。

## 优先测什么

| 层级 | 测什么 | 怎么测 |
|------|--------|--------|
| 命令逻辑 | `defineCommand` 的 `execute` | 直接调用 definition，传入 mock `params`/`args`/`input` |
| 工具逻辑 | `defineAgentTool` 的 `execute` | 同上，mock `inputSchema` 入参 |
| 纯函数 / 服务 | 业务模块 | 普通单元测，不碰 Runtime |
| 装配契约 | package `zhin` manifest、default export | 轻量：import default 是 PluginDefinition |

集成级「起完整 bot」成本高；优先单测 execute。需要端到端时用 `examples/minimal-bot` / Sandbox 手测，或仓库已有 Runtime 测试 helper（搜 `definePlugin` / `PluginScope` 相关测试）。

## 模板：命令 execute

```typescript
import { describe, it, expect } from 'vitest';
import hello from '../commands/hello.js';

describe('commands/hello', () => {
  it('returns greeting', async () => {
    const result = await hello.execute({
      params: {},
      args: [],
      input: { $content: 'hello' },
      config: {},
    } as never);
    expect(result).toBe('Hello!');
  });
});
```

带参数的命令对 `params.name` 断言即可。

## 模板：工具 execute

```typescript
import { describe, it, expect } from 'vitest';
import weather from '../tools/get_weather.js';

describe('tools/get_weather', () => {
  it('formats city weather', async () => {
    const text = await weather.execute({ city: '上海' }, {} as never);
    expect(text).toContain('上海');
  });
});
```

## 禁止

```typescript
// ❌ 旧经典 Plugin 生命周期
import { Plugin } from '@zhin.js/core'
root = new Plugin('/test/root.ts')
plugin = new Plugin('/plugins/my-plugin/src/index.ts', root)

// ❌ 依赖 usePlugin / MessageCommand 的测试
```

## 验证清单

- [ ] `pnpm --filter <pkg> test` 通过
- [ ] 新命令/工具有至少一条正向用例
- [ ] 边界（缺参、空串）按需求覆盖
- [ ] 不引入对 `zhin.js/node` / `bootstrapNode` 的依赖

## 输出格式

```markdown
## 测试摘要
- 覆盖：`commands/...` / `tools/...`
- 命令：`pnpm --filter <pkg> test`
```
