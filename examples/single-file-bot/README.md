# single-file-bot

整个机器人就是一个 `bot.ts`：不建 `commands/`、`components/` 等任何子目录。

## 运行

本仓库内（monorepo 根已 `pnpm install`）：

```bash
pnpm --filter single-file-bot dev
```

独立使用（把这个目录拷出去）：

```bash
pnpm install
npx zhin runtime start        # 或 pnpm dev
```

启动后按终端里的首跑指引操作：打开 [Remote Console](https://console.zhin.dev)，
Host 填 `http://127.0.0.1:8086`（本示例未配置 token，仅限本地），
进入 **Sandbox / 沙盒** 页连接，发送 `/hello`（或 `hello`），即可收到回复。

## 它是怎么工作的

- `package.json#zhin.entry` 指向 `./bot.ts`，`zhin runtime start` 加载它的
  默认导出（`definePlugin`）。
- `zhin.plugins` 清单挂了 `@zhin.js/adapter-sandbox`，Console 的 Sandbox 页
  通过它收发消息。
- 命令路由（`CommandIndex`）来自 `commands/` 约定目录；单文件没有这个目录，
  所以 `bot.ts` 在 `setup()` 里通过 `messageGatewayToken` 注册了一个
  **unmatched 回退**，把 `hello` 路由给文件内的 `defineCommand`。

## 什么时候该升级成目录布局

单文件适合 demo / 一次性脚本。出现以下任一需求时，改用约定式布局
（参考 [examples/minimal-bot](../minimal-bot/) 或 `npm create zhin-app` 模板）：

- 多个命令、子命令、带参数命令（`commands/hello.ts`、`commands/remind/[time:string].ts`）
- 中间件（`middlewares/`）、卡片组件（`components/`）、AI 工具（`tools/`）
- HMR 热重载粒度与命令帮助列表（Console 命令页只列约定目录发现的命令）

最小目录要求：命令路由需要 `commands/` 目录（每个 `.ts` 默认导出
`defineCommand`），其余能力目录按需添加。
