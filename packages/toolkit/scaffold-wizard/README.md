# @zhin.js/scaffold-wizard

Zhin 项目脚手架的**共享交互向导**库。适配器、AI、数据库的分步引导与配置合并逻辑集中在此，供 `create-zhin-app` 与 `@zhin.js/cli` 的 `zhin setup` 共用，避免两套实现漂移。

::: warning 依赖版本策略
脚手架写入的 `@zhin.js/*` / `zhin.js` 版本是与本包同一次发布的真实版本范围（如 `^1.1.11`），AI 栈的第三方包（`ai`、`zod`、`@ai-sdk/*`、`@modelcontextprotocol/sdk`）使用 Zhin 自身 `peerDependencies` 声明的范围，不再写 `latest`。范围在打包时由 `prepack` 写入 `lib/stack-version-ranges.json`；在 zhin 仓库内运行时直接读取工作区版本；只有拿不到版本的包（如第三方适配器依赖）才保留 `latest`（见 `stack-version-ranges.ts` 与 `check:dependency-policy`）。`zhin doctor --fix` 补写依赖与 `~/.zhin` 全局实例初始化也使用同一套范围。doctor / config check 的诊断基线仍接受任意已声明的版本。生产环境请提交 lockfile。
:::

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
| `project-deps.ts` | 依赖收集（启用 AI 时写入 `@zhin.js/agent`、`zod`、`ai`、所选 `@ai-sdk/*`；启用 memory MCP 时另加 `@modelcontextprotocol/sdk`）、SQLite 前置条件 |
| `apply.ts` | 将向导结果写入 `zhin.config.*`、`.env`、`package.json` |
| `env.ts` | `.env` 值转义（`formatEnvValue`）、幂等合并（`mergeEnvText`）与数据库环境变量生成（`generateDatabaseEnvVars`） |
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

数据库方言的字段 Schema、默认值、环境变量校验、驱动版本和实机验收基线统一由
`DATABASE_DIALECT_DEFINITIONS` 提供。选择界面会显示验收基线；`validateDatabaseConfig`
供 CLI 在保存和 `zhin config check` 时复用；启动阶段的 `normalizeDatabaseHostConfig`
在驱动加载前负责运行时字段归一化，两处共同受回归测试约束。

## 开发

```bash
pnpm --filter @zhin.js/scaffold-wizard build
pnpm --filter @zhin.js/scaffold-wizard test
```

`create-zhin-app` 与 `@zhin.js/cli` 的 `build` 脚本会自动先构建本包；单独 `pnpm --filter @zhin.js/cli build` 也会触发依赖构建。

修改向导行为时，请同时跑：

```bash
pnpm --filter create-zhin-app test
pnpm vitest run basic/cli/tests
```

## 文档链接

适配器向导内嵌文档 URL 指向 [zhin.js.org/adapters/](https://zhin.js.org/adapters/) 各平台页；索引见 [Essentials · Adapters](https://zhin.js.org/essentials/adapters)。

## 语言

新建项目可在向导选择简体中文或英文，也可使用 `pnpm create zhin-app my-bot --locale=en`。`--yes` 未指定语言时保持中文；选择英文后，适配器、数据库、AI 问答、安装说明和生成项目文档使用英文。

已有项目使用 `zhin setup --locale en` 修改项目语言；未传入时保留已有配置，并使用其语言显示向导。语言不会推断或修改时区、平台标识、环境变量名及用户填写内容。共享 API 接受显式 `locale` 参数（缺省 `zh-CN`），没有进程级语言状态。CLI 静态 help 同时提供中英文说明。
