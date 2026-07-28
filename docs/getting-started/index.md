# 安装与启动

先确认环境：Node.js `^20.19.0` 或 `>=22.12.0`，pnpm 9+。装好之后，一条命令就能起一个新 Bot：

```bash
# npm / pnpm 均可，脚手架为 create-zhin-app
npm create zhin-app my-bot
# 或
pnpm create zhin-app my-bot

cd my-bot
pnpm dev
```

脚手架会生成 pnpm workspace 并进入交互向导（来自共享包 `@zhin.js/scaffold-wizard`）：选择适配器、数据库（SQLite / MySQL / PostgreSQL / MongoDB / Redis）、是否启用 AI（Provider、触发方式、安全默认值）等，自动生成 HTTP Token 与 `.env`。加 `-y` 跳过向导，走 IM 黄金路径。

注意 Node 版本还有一条细则。Plugin Runtime 直接运行 TypeScript 源码，`zhin runtime start` 需要 Node **≥22.6**——Node 22.6–22.17 由 CLI 自动带 `--experimental-strip-types` 重启，Node 22.18+ 原生支持 TypeScript。**推荐 Node ≥22.18**，仓库内示例（如 minimal-bot / full-bot）也以此为准。

已有项目想增量配置适配器 / AI / 数据库，用的是同一套向导：

```bash
npx zhin setup
```

## 三种启动路径

Zhin.js 项目可以按复杂度从一条路径平滑长到下一条：

| 路径 | 形态 | 启动方式 | 参考 |
|------|------|----------|------|
| 单插件 | `plugin.ts` + 约定目录（`commands/` 等） | `zhin runtime start` | [minimal-bot](../examples/index.md#minimal-bot-stable-最小路径) |
| 插件即应用 | 单插件 + `zhin.config.yml`（HTTP、数据库、子插件配置） | `zhin runtime start` | [capabilities-bot](../examples/index.md#capabilities-bot-defineplugin-能力样板) |
| 完整应用 | 多插件 workspace（适配器 + 功能插件 + AI） | `pnpm create zhin-app` 生成，`pnpm dev` | [full-bot](../examples/index.md#full-bot-l4-参考含-ai) |

三条路径跑的是**同一个** `zhin runtime start`，区别只在 `package.json#zhin` 清单里挂了多少 Feature 与子插件：

```mermaid
flowchart LR
  subgraph 项目目录
    P[plugin.ts<br/>definePlugin]
    C[commands/ components/ ...<br/>约定目录]
    Y[zhin.config.yml<br/>可选]
    M[package.json#zhin<br/>拓扑清单]
  end
  CLI[zhin runtime start] --> M
  M --> P
  M --> F[Feature 提供者<br/>adapter / command / component]
  F --> C
  Y -. 按 plugins.&lt;instanceKey&gt; 分层注入 .-> P
```

`package.json#zhin` 是拓扑的唯一事实来源：声明入口 `entry`、要启用的 `features`、要挂载的子插件 `plugins`（npm 包名或 `./` 本地目录）。`zhin.config.yml` 只放配置值——顶层 `plugin:` 段给 Root 插件，`plugins.<instanceKey>` 给对应子插件实例。约定目录由 Feature 提供者发现，没有模块级注册副作用，改文件触发热重载。

### 常用命令

```bash
zhin runtime start                          # 开发模式（watch + 热重载）
zhin runtime start --mode production --no-watch   # 生产模式
zhin runtime start --daemon                 # 后台守护（zhin stop 停止）
```

`zhin` 二进制由开发依赖 `@zhin.js/cli` 提供。

## Install tiers（zhin.js 4.x）

```md
<<< ../snippets/install-tiers.md#tiers-table
```

## 下一步

- [编写第一个插件](./first-plugin.md)：从空目录到可运行插件
- [示例速览](../examples/index.md)：四个官方示例怎么跑
