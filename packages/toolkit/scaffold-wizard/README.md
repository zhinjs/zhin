# @zhin.js/scaffold-wizard

Zhin 项目脚手架的**共享交互向导**库。适配器、AI、数据库的分步引导与配置合并逻辑集中在此，供 `create-zhin-app` 与 `@zhin.js/cli` 的 `zhin setup` 共用，避免两套实现漂移。

## 消费者

| 包 / 命令 | 用途 |
|-----------|------|
| `create-zhin-app` (`pnpm create zhin-app`) | 新建 workspace 时运行完整向导并生成项目 |
| `@zhin.js/cli` → `zhin setup` | 已有项目增量配置（database / adapters / AI） |
| `@zhin.js/cli` → `zhin onboard` | 项目内外入口；重新配置时委托 `zhin setup` |

`zhin new` 负责插件包脚手架，**不**使用本包。

## 模块职责

| 模块 | 说明 |
|------|------|
| `adapter.ts` / `adapter-configurers.ts` | 适配器选择与分步配置（Telegram polling/webhook、GitHub App、OneBot11 等） |
| `ai.ts` | AI Provider、触发方式、会话与安全默认值 |
| `database.ts` | 数据库类型与连接参数 |
| `project-deps.ts` | 依赖收集（含启用 AI 时预装 `@modelcontextprotocol/sdk`）、SQLite 前置条件 |
| `apply.ts` | 将向导结果写入 `zhin.config.*`、`.env`、`package.json` |
| `types.ts` | `InitOptions` 等共享类型 |

## 主要 API

```typescript
import {
  configureDatabaseOptions,
  configureAdapters,
  configureAI,
  finalizeWizardOptions,
  applyWizardOptionsToConfig,
  appendWizardEnvVars,
  collectWizardDependencies,
  mergeDependenciesIntoPackageJson,
  getAdapterSetupNotes,
} from '@zhin.js/scaffold-wizard';
```

典型流程（与 `create-zhin-app` / `zhin setup` 一致）：

1. 交互调用 `configureDatabaseOptions` / `configureAdapters` / `configureAI`
2. `finalizeWizardOptions(options)` — 补全 AI / GitHub 等所需的 SQLite
3. `applyWizardOptionsToConfig(config, options)` — 合并进配置对象
4. `appendWizardEnvVars` + `mergeDependenciesIntoPackageJson` — 写 `.env` 与依赖

## 开发

```bash
pnpm --filter @zhin.js/scaffold-wizard build
pnpm --filter @zhin.js/scaffold-wizard test
```

修改向导行为时，请同时跑：

```bash
pnpm --filter create-zhin-app test
pnpm vitest run basic/cli/tests
```

## 文档链接

适配器向导内嵌文档 URL 指向 [zhin.js.org/adapters/](https://zhin.js.org/adapters/) 各平台页；索引见 [Essentials · Adapters](https://zhin.js.org/essentials/adapters)。
