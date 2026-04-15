# 仓库结构与模块化约定

本文约定本 monorepo 的目录职责、包命名与 `package.json` 写法。**新增或调整包时，请优先遵守「第 3 节 源码与构建产物」中的双轨约定。**

## 1. 工作区（pnpm workspace 单仓库）

本仓库采用 **pnpm workspace** 管理多个包目录；**不再使用 git submodule**。克隆后执行 `pnpm install` 即可。

若你仍在使用带子模块元数据（`.gitmodules` + gitlink）的旧克隆，请按 [monorepo-no-submodules.md](./monorepo-no-submodules.md) 运行一次性导入脚本，将各路径改为普通目录。

### 克隆

```bash
git clone https://github.com/zhinjs/zhin.git
cd zhin
pnpm install
```

### 目录与历史来源（参考）

以下路径为 monorepo 内普通目录；历史上曾对应 `github.com/zhinjs/<repo>` 独立仓库，便于对照 issue/PR 或 cherry-pick：

| 路径 | 曾用远程（参考） |
|------|----------------|
| `basic/cli` | `zhinjs/cli` |
| `basic/database` | `zhinjs/database` |
| `basic/logger` | `zhinjs/logger` |
| `basic/schema` | `zhinjs/schema` |
| `packages/kernel` | `zhinjs/kernel` |
| `packages/ai` | `zhinjs/ai` |
| `packages/agent` | `zhinjs/agent` |
| `packages/client` | `zhinjs/client` |
| `packages/create-zhin` | `zhinjs/create-zhin` |
| `packages/satori` | `zhinjs/satori` |
| `plugins` | `zhinjs/plugins` |
| `docs` | `zhinjs/docs` |

**主仓库内常驻包**：`packages/core`、`packages/zhin`、`examples/*`。

### pnpm workspace

根目录 `pnpm-workspace.yaml` 已声明：

- `basic/*` — 基础能力（CLI、数据库、日志、schema 等）
- `packages/*` — 框架核心与运行时（`kernel`、`core`、`zhin`、`agent`、`client`、`ai` 等）
  - `ai`：通用 AI 引擎（Provider、Agent、Memory、CostTracker、FileStateCache、MicroCompact、ToolSearchCache）
  - `agent`：IM Agent 编排（ZhinAgent、ExecPolicy、FilePolicy、PromptBuilder、内置工具）
- `plugins/adapters/*` — 平台适配器
- `plugins/services/*` — 服务类插件（如 HTTP、Console）
- `plugins/features/*` — 特性类插件
- `plugins/utils/*` — 工具类插件
- `plugins/games/*` — 游戏类插件（可为空，仅保留说明时请放 `README.md`）
- `examples/*`、`docs`

**规则：** 凡应被 `pnpm install` / `workspace:*` 解析的包，**必须**在对应 glob 下提供独立的 `package.json`。不要提交「仅有空目录、无 `package.json`」的占位文件夹，以免误导协作者。

## 2. 包命名（npm `name`）

| 类型 | 约定 | 示例 |
|------|------|------|
| 主入口 | `zhin.js` | — |
| 核心/共享库 | `@zhin.js/<短名>` | `@zhin.js/core`、`@zhin.js/kernel` |
| 适配器 | `@zhin.js/adapter-<平台>` | `@zhin.js/adapter-icqq` |
| 工具插件 | `@zhin.js/plugin-<名称>` | `@zhin.js/plugin-rss` |
| 服务 | `@zhin.js/<服务名>` | `@zhin.js/console`、`@zhin.js/http` |

目录名（文件夹）优先 **kebab-case**；与平台强相关的缩写（如 `icqq`、`qq`）可保持小写短名。

## 3. 源码与构建产物（核心约定）

本仓库对**每个包**采用统一语义（与运行环境对应）：

| 运行环境 | 源码目录 | 构建输出目录 | `package.json` 入口习惯 |
|----------|----------|----------------|-------------------------|
| **Node.js 服务端** | **`src/`** | **`lib/`** | `main` / `types` / `import` → `./lib/index.js` 等 |
| **浏览器客户端** | **`client/`** | **`dist/`** | 按实际导出配置（如仅静态资源可无 `main`，库包可指向 `./dist/index.js`） |

**原则：**

1. **不要混放**：服务端逻辑只在 `src/`；仅在浏览器执行的 UI、路由、DOM API 等在 `client/`。
2. **`lib/` 与 `dist/` 并列**：同一包内可同时存在 `lib/`（Node）与 `dist/`（前端产物），二者职责不同。
3. **工具链**：Node 侧常用 `tsc` / `tsup` → `lib/`；客户端常用 Vite / Rolldown → `dist/`（具体脚本以各包 `package.json` 为准）。
4. **发布范围**：`files` 字段应包含实际发布的 `lib` 和/或 `dist`（以及 `client` 源码若需随包提供扩展入口，见下）。

### 3.1 仅 Node 的包（无浏览器部分）

```
<包根>/
  package.json
  tsconfig.json  # 通常 outDir: lib, rootDir: src
  src/
  lib/           # 构建输出，gitignore
  tests/
```

典型：`@zhin.js/core`、`@zhin.js/adapter-*` 服务端部分、`basic/database` 等。

### 3.2 带浏览器扩展的适配器 / 插件

- **Node 适配逻辑**：`src/` → `lib/`。
- **控制台扩展 UI**：源码在包根 **`client/`**（如 `client/index.tsx`），由 `@zhin.js/console` 的构建能力打包；产物落在**该包根目录下的 `dist/`**（与 `plugins/services/console/src/build.ts` 行为一致）。

`package.json` 的 `files` 中通常需包含 **`client`**（源码供开发/扩展加载）及构建生成的 **`dist`**（若对外分发预构建产物）。

### 3.3 大型服务：`@zhin.js/console`

- **服务端**：`plugins/services/console/src/` → **`lib/`**（如 `tsup`）。
- **控制台 SPA**：`plugins/services/console/client/` → 构建产物在**该包下的 `dist/`**（Vite 等脚本，见 `scripts/client.js`）。

即：在同一包内严格执行 **src→lib**、**client→dist**。

包根提供可发布的 TypeScript 基线，供适配器 `extends`（见 `package.json` 的 `exports`）：

- **`@zhin.js/console/browser.tsconfig.json`** — 控制台扩展目录 **`client/`**（React + bundler）。
- **`@zhin.js/console/node.tsconfig.json`** — Node 侧插件 **`src/`** 的推荐选项（与 `NodeNext` 一致）；各包仍需在本机 `tsconfig` 中设置自身的 `rootDir` / `outDir` / `include`。

#### 3.3.1 控制台 SPA：`client/` 内部的「应用根」

`@zhin.js/console` 的前端是 **Vite 单页应用**，除包根 **`client/`** 表示「整段浏览器资产」外，其下还有常见子结构（与适配器包根下**扁平**的 `client/index.tsx` 不同，但语义仍属浏览器侧）：

```
plugins/services/console/client/
  index.html              # Vite 入口 HTML
  src/                    # 应用源码（页面、布局、组件、hooks）
  public/                 # 若有静态资源
  *.config.js             # tailwind / postcss 等
```

**约定：** 控制台相关 **Node 逻辑**（Koa、WebSocket、持久化）只放在 **`plugins/services/console/src/`**，不要放进 `client/src/`。适配器扩展保持「包根 `client/` + 少量文件」即可。

### 3.4 `@zhin.js/client`（`packages/client`）

- **`packages/client/`**：npm 包 **`@zhin.js/client`** 的根（清单、构建配置）。
- **`packages/client/client/`**：**浏览器端源码**（非「包名重复」，而是「客户端子树」语义）。
- **构建输出**：包根 **`dist/`**（`main`/`types` 指向 `./dist/...`），符合上表「client 侧 → dist」。

路径别名 `@/*` → `./client/*` 与上述布局一致。

## 4. 文件命名（前端 / TS）

建议新代码按下列执行；存量代码可渐进调整。

| 类别 | 约定 |
|------|------|
| React 组件文件 | **PascalCase**，如 `MessageBody.tsx` |
| 默认导出页面组件 | **PascalCase**，语义准确（如 `BotManagePage`，避免 `Mange` 等拼写错误） |
| 页面/路由目录 | **kebab-case**，如 `bot-detail/index.tsx` |
| 工具函数、非组件模块 | **camelCase**，如 `parseComposerContent.ts` |
| 样式与配置 | **kebab-case**，如 `tailwind.config.js` |
| Node 单文件模块 | **kebab-case** 或 **camelCase** 与所在包存量保持一致；新增宜 **kebab-case**（如 `adapter-process.ts`） |

**测试与类型：** `*.test.ts` / `*.spec.ts` 与源码同目录或 `tests/` 均可，同一包内保持一种主风格即可。

## 5. `package.json` 元数据

- **`repository.directory`**：必须与包在仓库中的**真实路径**一致。
- **`type`：** ESM 包使用 `"module"` 时，与构建产物一致即可。
- **`exports`：** 子路径导出应指向**真实存在的构建产物**（`lib` 或 `dist`），避免文档与磁盘不一致。

## 6. 与约定对照（仓库审计备忘）

以下条目在引入新包或重构时用于自检；**不必一次性全部改掉**，但新增代码应对齐第 3 节。

| 位置 | 状态 | 说明 |
|------|------|------|
| 多数 `plugins/*`、`packages/*`、`basic/*`（仅 Node） | ✅ | `src/` → `lib/`，与约定一致。 |
| `@zhin.js/client` | ✅ | 浏览器源码在 `client/`，发布入口在 `dist/`。 |
| 含 `client/` 的适配器 | ✅ | 扩展构建输出目标为包根 `dist/`（Console `build.ts`）。 |
| `@zhin.js/console` | ✅ | `src/` → `lib/`，大前端 `client/` → `dist/`；不再导出无效的 `exports["./client"]`（SPA 由 `dist/` 静态资源承载）。 |
| `@zhin.js/satori`（`packages/satori`） | ✅ | Node 库：`src/` → **`lib/`**（tsup），与全局约定一致。 |
| `examples/*` | ℹ️ | 示例工程可能直接运行 `src`，不强制 `lib`/`dist`，不纳入插件包约定。 |

## 7. 其他说明

- 个别旧包若 `main` / `types` 仍写作 `lib/...` 而未带 `./`，建议统一为 `./lib/...`；若发现遗漏可随 PR 补上。
- **`clean` 脚本** 应删除本包**实际**构建输出目录（例如 `@zhin.js/client` 仅产出 `dist/` 时不应再 `rimraf lib`）。

## 8. 代码组织与可维护性

- **分层：** `packages/kernel` → `core` → `zhin` 等依赖方向保持单向；插件只通过公开 API 与 `zhin.js` / `@zhin.js/core` 交互，避免环形依赖。
- **单文件体量：** 页面或路由文件若超过约 **400～500 行**，优先拆出子组件、`hooks/`、`utils/` 或 `types.ts`（控制台 `bot-detail`、`database` 等可按此渐进拆分）。
- **副作用入口：** 插件 `src/index.ts` 宜保持「注册路由 / 命令 / 生命周期」为主；重逻辑抽到同目录 `*.service.ts` 或 `lib/` 子模块便于测试。
- **日志：** 构建脚本、CLI 中避免长期保留无环境变量的 `console.log` 调试输出；必要进度信息可用 `console.error`（stderr）或受 `DEBUG=*` 控制。
- **英文标识符：** 公共导出符号、类型名、路由 key 使用正确英文拼写，避免混入拼音缩写（除非领域通用如 `icqq`）。

## 9. AI 能力文件约定

插件 / 工作区可通过标准目录放置 AI 声明文件，框架自动扫描与热重载：

| 目录 | 文件格式 | 用途 |
|------|---------|------|
| `tools/` | `*.tool.md`（扁平）或 `<name>/<name>.tool.md`（嵌套 + handler） | 文件化 AI Tool：YAML frontmatter 定义参数/元数据，可选 handler 或 body 模板 |
| `skills/` | `<name>/SKILL.md` | 文件化 Skill：粗筛描述 + 关联工具列表，`always: true` 常驻注入 |
| `agents/` | `*.agent.md`（扁平）或 `<name>/<name>.agent.md`（嵌套） | 文件化 Agent 预设：frontmatter + body 作为 systemPrompt |
| 包根 | `plugin.yml` | 插件元数据清单（`name`、`description`、`version`），通过 `plugin.manifest` 访问 |

**发现优先级**：工作区 `cwd/` > `~/.zhin/` > `data/` > 已加载插件包根。同名先发现者优先；程序化注册的同名 Tool 优先于文件化版本。

---

维护者更新本文时，请同步检查 `pnpm-workspace.yaml` 与 `docs/contributing.md` 中的链接。
