# Changelog

> **说明**：4.x 起，本仓库采用 changesets 逐包发布，逐版本的发布记录维护在各包目录的 `CHANGELOG.md` 中（如主包 [packages/im/zhin/CHANGELOG.md](./packages/im/zhin/CHANGELOG.md)、全仓 changeset 摘要 [docs/CHANGELOG.md](./docs/CHANGELOG.md)）。本文件只记录跨版本的重要里程碑。

## [4.1.x] - 2026-06 ~ 2026-07

当前主线。4.1.0 引入语音管线，4.1.3 完成约定式插件运行时（Plugin Runtime）迁移。

### 💥 破坏性变更（4.1.3，按仓库惯例以 patch 形式发布）

- **约定式插件运行时迁移**：插件与适配器由 `usePlugin()` / `extends Adapter` 迁移为 `definePlugin` / `defineAdapter` + `plugin.ts` 入口 + 约定目录（`adapters/`、`commands/`、`components/`、`tools/` 等），旧 `usePlugin` / `extends Adapter` 生产入口已删除；全部 20 个平台适配器完成迁移。迁移边界见 [ADR 0050](./docs/adr/0050-plugin-runtime-migration-boundary.md)，开发形态见 [examples/plugin-runtime-migration-bot](./examples/plugin-runtime-migration-bot/)。
- **CLI daemon 化**：`zhin runtime start --daemon`（pidfile / 崩溃拉起 / 风暴保护 / orphan watchdog）；legacy `zhin dev` / `zhin start`（含 `zhin restart`）已移除，`zhin stop` 兼容新 daemon。命令参考见 [docs/reference/cli.md](./docs/reference/cli.md)。
- 注：为避免 zhin.js 5.0 级联，本次 breaking 迁移统一以 patch 版本发布（见 [docs/CHANGELOG.md](./docs/CHANGELOG.md) 1.0.45 条）。

### ✨ 新能力主线

- **语音管线（4.1.0）**：可选 peer `@zhin.js/speech`，入站 STT（`audio.strategy: transcribe`）、出站 TTS（`segment.tts` + `voice_stt` / `voice_tts` 工具），edge / openai / azure / custom 提供商；移除 `@zhin.js/plugin-voice`，配置键 `voice:` 改为 `speech:`。见 [ADR 0020](./docs/adr/0020-speech-pipeline-stt-tts.md)。
- **约定式运行时新包**：`@zhin.js/plugin-runtime`、`@zhin.js/adapter`、`@zhin.js/runtime`、`@zhin.js/host-http`；onebot11 反向 WSS、onebot12 webhook/wss、milky sse/webhook 等连接模式补齐。
- **安全加固**：builtin 工具统一走 `security/policy-facade.ts` 的 `runToolPolicies`（声明式策略表，deny 优先）；审计日志 close flush + 背压队列；命令拆分引号感知、堵绕过。
- **Console 与可观测性**：Remote Console 接入 Plugin Runtime Host；Logger 表格日志、本地时区、第三方库（log4js / discord）桥接。
- **脚手架同步**：`create-zhin-app` / `zhin new` / scaffold-wizard 生成物改为 Plugin Runtime 形态；Slack 适配器 mrkdwn 收发与交互反馈。

## [4.0.x] - 2026-06

安装分层主线（首个 4.x 发布为 4.0.1）。

### 💥 破坏性变更

- **`import from 'zhin.js'` 不再导出 `ZhinAgent` / `AIService`**：AI 能力拆分为可选子路径，请改用 `import from 'zhin.js/agent'` 或 `zhin.js/ai`，并按需安装 `@zhin.js/agent` + `zod` + `ai` + 所选 `@ai-sdk/*`。
- **安装分档**：默认安装仅 IM 核心（production `node_modules` ≤ 10MB），AI 按需加装。分档表见 [docs/snippets/install-tiers.md](./docs/snippets/install-tiers.md)，决策见 [ADR 0019](./docs/adr/0019-install-size-layering.md)。

### ✨ 新能力主线

- 核心包瘦身与依赖分层治理；`@zhin.js/agent` 走向 1.0（多模型编排、安全沙箱、MCP 工具）。

## [3.0.0] - 2026-06

短周期过渡主版本。注意：zhin.js 包在 2026 年 6 月内由 2.0.x → 3.0.0 → 4.0.x 快速递进，此处的 2.x / 3.x 是 zhin.js 包的过渡版本号，与下方 2024 年的 2.0.0 里程碑及更早的旧主包 `zhin` 3.x 线均不是同一条线。

### 🔄 变更

- **架构分层落地（2.0.x）**：抽离 `@zhin.js/kernel`（插件系统 / 定时任务 / 错误体系，无 IM 概念），依赖方向收敛为 basic → kernel → ai → core → agent → zhin，由架构门禁强制。见 [docs/architecture/README.md](./docs/architecture/README.md)。
- **概念更名 Bot → Endpoint（2.0.1）**：统一角色权限，适配多 Endpoint 业务场景。
- **AI 双代 API 统一 + Plugin 类拆分（3.0.0）**：`@zhin.js/ai` 1.3 / `@zhin.js/agent` 0.3，为 4.x 安装分层铺路。

## [zhin.js 1.0.x（zhin-next 重写）] - 2025-10 ~ 2026-06

2025-10 的 "zhin-next" 重写开启新主线，主包 `zhin.js` 从 1.0.0 重新开始版本计数，至 1.0.93 共 90 余个迭代版本。

### 💥 破坏性变更

- **npm 命名空间迁移**：`@zhinjs/*` → `@zhin.js/*`，主包 `zhin` → `zhin.js`（版本计数随之重置为 1.0.x）。

### ✨ 新能力主线

- **AI Agent 技术栈从无到有**（2026-02 起）：`@zhin.js/ai`（Provider / agentLoop / 会话 / 记忆）与 `@zhin.js/agent`（ZhinAgent、多模型编排、安全沙箱、MCP）落地；harness 对齐系列决策见 [docs/adr/](./docs/adr/README.md)（ADR 0001 ~ 0031）。
- **Remote Console**（2026-05）：Host 提供 API，UI 托管在 console.zhin.dev。
- **Host 运行时分层**：`@zhin.js/host-api` / `@zhin.js/host-router` 从主包拆出。
- 平台适配器持续扩充与迭代（QQ / ICQQ / NapCat / OneBot11·12 / Discord / Telegram / Slack / KOOK / 钉钉 / 飞书 / 企微 / GitHub / Email 等）；多智能体协作等实验性能力。

## [zhin 3.x（旧主包维护线）] - 2024-12 ~ 2025-10

2.0.0 里程碑之后、zhin-next 重写之前，旧主包 `zhin`（`@zhinjs/*` 命名空间）进入维护性迭代：3.0.x → 3.1.x 以缺陷修复与适配器维护为主，2025-02 后发布频次显著放缓，2025-03 ~ 2025-09 基本处于发布静默期，为 zhin-next 重写做准备。该线的逐版本细节未完整保留在本仓库 git 历史中，此处仅作概括，不逐项罗列；`zhin` 包最终停留在 3.1.x，随后被 `zhin.js` 取代。

---

## [2.0.0] - 2024-12-26

### 🎉 重大架构升级

Zhin.js 2.0 是一次重大架构重构，移除了 HMR 依赖，简化了插件系统，提升了性能和稳定性。

### ✨ 新增功能

#### 核心架构
- **移除 `@zhin.js/hmr` 依赖**：使用 Node.js 原生模块系统，更稳定可靠
- **简化的插件系统**：基于 `AsyncLocalStorage` 的上下文管理
- **内置服务系统**：command、component、cron、permission、config、database 作为内置服务
- **自动资源清理**：插件卸载时自动清理注册的命令、组件、定时任务等资源
- **插件功能追踪**：`plugin.features` 属性记录插件提供的功能
- **`usePlugin()` API**：替代 `useApp()`，获取当前插件实例
- **`useContext()` API**：等待并使用特定服务
- **`provide()` API**：提供服务给其他插件
- **`onDispose()` API**：注册插件卸载时的清理函数

#### 数据库模块
- **事务支持**：完整的事务 API，支持嵌套事务和保存点
- **迁移系统**：自动生成 `down` 迁移逻辑，支持版本管理
- **生命周期钩子**：beforeCreate、afterCreate、beforeUpdate、afterUpdate、beforeDelete、afterDelete
- **多对多关系**：`belongsToMany` 关系定义和加载，支持 pivot 数据
- **增强的查询构建器**：支持更复杂的查询条件和聚合函数
- **`defineModel` 扩展**：在插件中直接调用 `plugin.defineModel()` 定义模型

#### 配置系统
- **YAML 配置格式**：从 `.ts` 迁移到 `.yml`，更简洁易读
- **环境变量支持**：支持 `.env` 和 `.env.{mode}` 文件
- **配置热重载**：配置文件变更时自动重载相关插件

#### 开发体验
- **改进的日志系统**：区分 root/setup 插件和普通插件的日志级别
- **更好的类型推导**：完整的 TypeScript 类型支持
- **热重载优化**：使用 Node.js 原生模块系统，更稳定可靠

#### Console 插件优化
- **按需加载 Vite**：开发模式下可选择延迟加载 Vite，节省内存
- **动态导入优化**：Vite 和 React 相关依赖使用动态导入，减少初始内存占用
- **生产环境优化**：生产环境只依赖 `mime` 和 `ws`，磁盘占用减少 98%
- **依赖分类**：正确区分 `dependencies`、`devDependencies` 和 `optionalDependencies`

### 🔄 变更

#### 破坏性变更

**API 变更**：
- `useApp()` → `usePlugin()` - 获取当前插件实例
- `defineModel()` → `plugin.defineModel()` - 定义数据模型
- `onDatabaseReady()` → `useContext('database')` - 等待数据库就绪

**配置文件**：
- `zhin.config.ts` → `zhin.config.yml`
- `defineConfig()` 函数不再需要

**插件系统**：
- 移除 `App` 类的直接访问
- 插件间通信改用 `provide()` 和 `useContext()`
- 资源自动清理，无需手动管理

**适配器**：
- `@zhin.js/adapter-process` 重命名为 `@zhin.js/adapter-sandbox`

**依赖包**：
- 移除 `@zhin.js/hmr` 包
- 移除 `@zhin.js/types` 包（类型定义合并到 `@zhin.js/core`）

### 🐛 修复

- **内存泄漏修复**：
  - 修复 `evalCache` 无限增长问题，实现 LRU 缓存（最大 1000 条）
  - 修复插件卸载时未清理 `loadedModules` 的问题
  - 修复 `DatabaseLogTransport` 重复添加的问题
  - 修复事件监听器未清理的问题

- **日志系统修复**：
  - 修复重复日志输出问题
  - 优化日志级别，减少不必要的日志

- **HTTP 服务修复**：
  - 修复 `server.listen` 在 macOS 上的 EPERM 错误（改为监听 `127.0.0.1` 而非 `0.0.0.0`）
  - 修复 `/api/stats` 接口的类型错误

- **类型错误修复**：
  - 修复 `CronService` 类型声明
  - 修复 `Plugin.Contexts` 类型定义
  - 修复数据库相关类型错误

### 📝 文档

- 新增完整的架构文档
- 新增数据库功能文档
- 新增 Console 插件优化文档
- 新增内存分析指南
- 更新所有 API 文档

### 🧪 测试

- 新增数据库模块完整测试套件（1738 行，81 个测试用例）
- 新增迁移系统测试
- 新增生命周期钩子测试
- 新增多对多关系测试

### 🚀 性能优化

- **启动性能**：
  - Console 插件启动内存从 42MB 降至 17MB（延迟加载模式）
  - 插件加载速度提升 30%

- **运行时性能**：
  - `evalCache` 使用 LRU 缓存，防止内存泄漏
  - 优化插件上下文管理，减少内存占用
  - 自动资源清理，避免内存泄漏

- **构建性能**：
  - Console 插件生产环境磁盘占用从 200MB 降至 2MB（98% 减少）

### ⚠️ 已知问题

- Console 插件在浏览器首次访问时，Vite 模块缓存会增加约 20MB 内存（正常现象）
- Discord 适配器会增加约 20MB 内存（discord.js 库本身较大）

---

## 升级指南

### 快速升级步骤

1. **更新依赖**
```bash
pnpm update zhin.js @zhin.js/core
```

2. **转换配置文件**

删除 `zhin.config.ts`，创建 `zhin.config.yml`：

```yaml
log_level: 1
database:
  dialect: sqlite
  filename: ./data/bot.db
plugin_dirs:
  - node_modules
  - ./src/plugins
plugins:
  - your-plugin
```

3. **更新插件代码**

```typescript
// 旧版本
import { useApp, addCommand, MessageCommand, defineModel, onDatabaseReady } from 'zhin.js';
const app = useApp();

defineModel('users', { /* ... */ });

onDatabaseReady((db) => {
  // ...
});

addCommand(
  new MessageCommand('hello')
    .action((message) => {
      return 'Hello!';
    })
);

// 新版本
import { usePlugin, MessageCommand } from 'zhin.js';

const plugin = usePlugin();
const { addCommand, useContext } = plugin;

// 定义模型
plugin.defineModel('users', { /* ... */ });

// 等待数据库就绪
useContext('database', (db) => {
  // ...
});

// 添加命令
addCommand(
  new MessageCommand('hello')
    .action((message) => {
      return 'Hello!';
    })
);
```

### 主要 API 对照

| 旧版本 | 新版本 |
|--------|--------|
| `useApp()` | `usePlugin()` |
| `defineModel(name, def)` | `plugin.defineModel(name, def)` |
| `onDatabaseReady(fn)` | `useContext('database', fn)` |
| `app.database` | `plugin.root.inject('database')` |
| `app.config` | `plugin.config` |

### 详细信息

更多升级细节请参考项目文档和示例代码。

---

## 获取帮助

- 📖 查看 [examples/test-bot](./examples/test-bot) 了解新版本用法
- 🐛 [提交 Issue](https://github.com/zhinjs/zhin/issues)
