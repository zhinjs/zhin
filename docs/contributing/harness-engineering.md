# Harness Engineering 指南

本文档描述了 zhin.js 项目的 harness engineering 实践，包括自动化检查、架构约束和代码质量标准。

## 概述

Harness engineering 是通过自动化工具和检查来强制执行项目架构、代码质量和开发规范的实践。在 zhin.js 中，我们使用以下工具：

1. **ESLint** — 代码风格和质量检查
2. **TypeScript** — 类型安全检查
3. **自定义脚本** — 架构约束和规范检查
4. **CI/CD** — 持续集成中的自动化检查

## 快速开始

### 运行所有检查

```bash
pnpm check:all
```

### 运行单个检查

```bash
pnpm check:harness-paths    # 检查发送链路绕过
pnpm check:no-koa           # 检查 koa 导入
pnpm check:prod             # 检查生产配置
pnpm check:plugin           # 检查插件规范
pnpm check:architecture     # 检查架构层级
pnpm check:doc-links        # 检查文档相对链接（AGENTS、architecture 等）
pnpm check:adapter-docs     # 适配器 README 与 docs/adapters 是否同步
pnpm sync:adapter-docs      # 从 plugins/adapters/*/README 生成 docs/adapters/*
pnpm check:stable           # Stable smoke（Sandbox + minimal-bot 契约，无 LLM）
```

### 代码质量检查

```bash
pnpm lint                   # ESLint 检查
pnpm type-check             # TypeScript 类型检查
```

## 架构层级规则

### 依赖层级（从低到高）

```
1. basic/ (logger, schema, database, cli)
   ↓
2. packages/im/kernel (无 IM 概念)
   ↓
3. packages/im/ai (providers, agents, memory)
   ↓
4. packages/im/core (Plugin, Adapter, Endpoint, Command)
   ↓
5. packages/im/agent (ZhinAgent, security policies)
   ↓
6. packages/im/zhin (主入口)
```

### 允许的导入关系

| 层级 | 可以导入 |
|------|----------|
| basic/ | 无（基础层）|
| packages/im/kernel | basic/ |
| packages/im/ai | basic/, packages/im/kernel |
| packages/im/core | basic/, packages/im/kernel, packages/im/ai |
| packages/im/agent | basic/, packages/im/kernel, packages/im/ai, packages/im/core |
| packages/im/zhin | 所有 IM 层级 + 按需 re-export |

### 禁止的导入

- ❌ `packages/im/kernel` 不能导入 `packages/im/core` 或更高层
- ❌ `packages/im/ai` 不能导入 `packages/im/core` 或更高层
- ❌ `packages/im/core` 不能导入 `packages/im/agent`
- ❌ 插件不能直接导入 `packages/im/kernel`（应通过 `@zhin.js/core` / `zhin.js`）

## 发送链路保护

### 标准发送链路

所有消息发送必须通过以下链路：

```
Message.$reply / Adapter.sendMessage
  ↓
renderSendMessage
  ↓
root plugin before.sendMessage
  ↓
platform Endpoint.$sendMessage
```

### 禁止的绕过方式

```typescript
// ❌ 错误：直接调用 bot.$sendMessage()
bot.$sendMessage(target, message);

// ✓ 正确：使用 adapter.sendMessage()
await adapter.sendMessage({
  target,
  content: message,
});

// ✓ 正确：使用 message.$reply()
await message.$reply(message);
```

### 检查范围

- `packages/im/zhin/src`
- `packages/im/agent/src`
- `plugins/features`
- `packages/host`
- `plugins/utils`
- `plugins/games`

## 插件规范

### 必需文件

每个插件必须包含：

```
plugin-name/
├── package.json          # 包配置
├── README.md             # 使用说明
├── src/
│   └── index.ts          # 入口文件
└── tests/
    └── index.test.ts     # 测试文件
```

### package.json 要求

```json
{
  "name": "@zhin.js/plugin-name",
  "main": "./lib/index.js",
  "exports": {
    ".": {
      "development": "./src/index.ts",
      "default": "./lib/index.js"
    }
  }
}
```

### 测试要求

- 至少一个测试文件在 `tests/` 目录
- 测试文件必须以 `.test.ts` 结尾
- 建议覆盖率 > 70%

## 代码质量标准

### ESLint 配置

项目使用 ESLint flat config 格式（`eslint.config.mjs`）：

```javascript
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
);
```

### TypeScript 规范

- 严格模式（`strict: true`）
- 禁止使用 `any` 类型（警告）
- 必须处理未使用的变量（错误）
- 导入路径必须使用 `.js` 扩展名

### AsyncLocalStorage 使用

```typescript
// ✓ 正确：在模块顶层调用
const plugin = usePlugin();

// ❌ 错误：在异步函数中调用
async function setup() {
  const plugin = usePlugin(); // 会导致错误
}
```

### getPlugin() 使用

```typescript
// ✓ 正确：初始化阶段捕获，运行时回调用闭包
const { addMiddleware, logger, root } = usePlugin();

addMiddleware(async (message, next) => {
  logger.info(message.sessionId);
  await next();
});

// ✓ 正确：register/init 函数开头（装配阶段）
export function registerMyCommands(): void {
  const root = getPlugin().root ?? getPlugin();
  addCommand(new MessageCommand('ping').action(() => root.name));
}

// ❌ 错误：中间件 / action / execute 等运行时回调内 getPlugin()
addMiddleware(async (message, next) => {
  getPlugin().logger.info('...'); // 线上易丢失 ALS 上下文
  await next();
});
```

CI 检查：`pnpm check:use-plugin-top-level`（usePlugin 顶层）、`pnpm check:get-plugin-runtime`（插件目录禁止运行时 getPlugin）。

## CI/CD 集成

### GitHub Actions 工作流

CI 工作流在 PR 到 `main` 分支时自动运行：

1. **安装依赖** — `pnpm install`
2. **检查 changeset** — `pnpm changeset status`
3. **构建包** — `pnpm build`
4. **运行 harness 检查** — 所有 `check:*` 命令
5. **运行测试** — `pnpm test:reporter`
6. **生成覆盖率** — `pnpm test:coverage`

### 检查失败处理

如果任何 harness 检查失败：

1. CI 会显示详细的错误信息
2. PR 会被标记为失败
3. 必须修复问题后才能合并

## 例外处理

### 何时可以例外

在极少数情况下，可能需要绕过某些检查：

1. **第三方库限制** — 某些库可能需要特定的导入方式
2. **性能优化** — 某些优化可能需要绕过常规规则
3. **兼容性需求** — 旧代码可能需要渐进式改进

### 如何添加例外

1. **代码中添加注释**

   ```typescript
   // harness-disable-next-line check:harness-paths
   bot.$sendMessage(target, message);
   ```

2. **在 PR 描述中说明理由**

   ```markdown
   ## 例外说明

   绕过 `check:harness-paths` 检查的原因：
   - 需要直接调用底层 API 进行性能优化
   - 已获得维护者批准
   ```

3. **获得维护者审批**
   - 至少一位维护者必须批准例外
   - 例外应该有明确的过期时间或条件

## 最佳实践

### 开发流程

1. **本地开发** — 运行 `pnpm check:all` 确保所有检查通过
2. **提交前** — 运行 `pnpm lint` 和 `pnpm type-check`
3. **PR 提交** — CI 会自动运行所有检查
4. **代码审查** — 审查者会检查 harness 检查结果

### 常见问题解决

#### 1. 架构层级违规

**错误信息**：
```
Layer "packages/im/kernel" cannot import from "packages/im/core"
```

**解决方案**：
- 将共享代码移动到更低层级
- 使用依赖注入或接口抽象
- 重新设计模块边界

#### 2. 发送链路绕过

**错误信息**：
```
direct bot.$sendMessage() bypasses Adapter.sendMessage / before.sendMessage chain
```

**解决方案**：
- 使用 `adapter.sendMessage()` 或 `message.$reply()`
- 如果确实需要直接调用，添加例外注释

#### 3. 插件规范不达标

**错误信息**：
```
Missing package.json
No test files found
```

**解决方案**：
- 创建必需的文件和目录
- 参考现有插件的结构

## 工具扩展

### 添加新的检查

1. **创建检查脚本** — `scripts/check-新检查名.mjs`
2. **更新 package.json** — 添加 `check:新检查名` 命令
3. **更新 CI** — 在 `.github/workflows/ci.yml` 中添加步骤
4. **更新文档** — 在本文档中添加说明

### 检查脚本模板

```javascript
#!/usr/bin/env node
/**
 * Harness: 检查描述
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const violations = [];

// 检查逻辑...

if (violations.length) {
  console.error('Harness check: FAILED\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}: ${v.issue}`);
  }
  process.exit(1);
}

console.log('Harness check: OK');
```

## 参考资料

- [ESLint 文档](https://eslint.org/)
- [TypeScript 文档](https://www.typescriptlang.org/)
- [Vitest 文档](https://vitest.dev/)
- [GitHub Actions 文档](https://docs.github.com/en/actions)

## 获取帮助

如果遇到 harness 检查问题：

1. 查看本文档的常见问题部分
2. 搜索 GitHub Issues
3. 在 Discussions 中提问
4. 联系维护者
