# 安装与启动

先确认环境：Node.js `^20.19.0` 或 `>=22.12.0`，pnpm 9+。  
Plugin Runtime 直接跑 TypeScript 时，`zhin runtime start` 需要 Node **≥22.6**（22.6–22.17 由 CLI 自动带 `--experimental-strip-types`；**推荐 ≥22.18**）。

## 有多容易？

最短路径：**脚手架 → 启动 → Console 里发一条命令**。不写平台适配器样板，也不需要模型 Key。

```bash
npm create zhin-app my-bot -y   # 或 pnpm create zhin-app my-bot -y
cd my-bot
pnpm dev
```

1. 打开 [console.zhin.dev](https://console.zhin.dev)
2. Host 填终端提示的地址（默认 `http://127.0.0.1:8086`）与 `.env` 里的 `HTTP_TOKEN`（`-y` 会生成）
3. 进 **Sandbox**，发 `/hello`

`-y` 跳过向导，走 **IM 黄金路径**（Sandbox + Host + Remote Console）。想选适配器 / 数据库 / AI 时去掉 `-y` 即可进入交互向导（`@zhin.js/scaffold-wizard`）。

已经有项目要加适配器或 AI：

```bash
npx zhin setup
```

## 想看「一个文件就是 bot」？

仓库示例 [single-file-bot](../examples/index.md#single-file-bot-一个-botts-就是机器人) 把命令写在 `bot.ts` 的 `setup({ addCommand })` 里，没有 `commands/` 目录：

```bash
# 本仓库根已 pnpm install
pnpm --filter single-file-bot dev
```

Console → Sandbox → `/hello`。完整说明见该目录 [README](https://github.com/zhinjs/zhin/tree/main/examples/single-file-bot)。

## 四种启动路径

按复杂度从「一个文件」长到「完整应用」，**同一条**命令：`zhin runtime start`。

| 路径 | 形态 | 启动方式 | 参考 |
|------|------|----------|------|
| 单文件 | 一个 `bot.ts` + `addCommand` / `addComponent`… | `zhin runtime start` | [single-file-bot](../examples/index.md#single-file-bot-一个-botts-就是机器人) |
| 单插件 | `plugin.ts` + 约定目录（`commands/` 等） | `zhin runtime start` | [minimal-bot](../examples/index.md#minimal-bot-stable-最小路径) |
| 插件即应用 | 单插件 + `zhin.config.yml`（HTTP、数据库、子插件） | `zhin runtime start` | [capabilities-bot](../examples/index.md#capabilities-bot-defineplugin-能力样板) |
| 完整应用 | 多插件 workspace（适配器 + 功能插件 + AI） | `pnpm create zhin-app` → `pnpm dev` | [full-bot](../examples/index.md#full-bot-l4-参考含-ai) |

```mermaid
flowchart LR
  subgraph 项目目录
    P[bot.ts / plugin.ts<br/>definePlugin]
    C[commands/ components/ ...<br/>约定目录 · 可选]
    Y[zhin.config.yml<br/>可选]
    M[package.json#zhin<br/>拓扑清单]
  end
  CLI[zhin runtime start] --> M
  M --> P
  M --> F[Feature 提供者<br/>adapter / command / component]
  F --> C
  Y -. 按 plugins.&lt;instanceKey&gt; 分层注入 .-> P
```

`package.json#zhin` 是拓扑的唯一事实来源：`entry`、`features`、`plugins`。`zhin.config.yml` 只放配置值。`setup()` 里注册的能力与约定目录发现进入同一个 Feature projection——单文件够用就写单文件，长大了再拆目录。

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

- [编写第一个插件](./first-plugin.md)：从空目录到可运行插件（也可先看单文件）
- [示例速览](../examples/index.md)：官方示例怎么跑
- [definePlugin](../authoring/define-plugin.md)：`setup` 还能挂什么
