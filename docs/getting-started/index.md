# 10 分钟跑通第一个 Bot

本页只完成一个结果：在浏览器 Sandbox 里向新 Bot 发送 `/hello`，并收到回复。整个过程不需要平台账号，也不需要模型 Key。

> 还不清楚 Zhin.js 是做什么的？先花 5 分钟读 [Zhin.js 是什么](./introduction.md)。

## 开始前

- 脚手架项目与编译后的 IM 库都需要 Node.js `>=22.19.0`（`@zhin.js/ai` 依赖的 undici 8 要求该版本）。
- pnpm 9 或更高版本。
- 能访问 [Remote Console](https://console.zhin.dev)。

## 1. 创建并启动

```bash
npm create zhin-app my-bot -y
cd my-bot
pnpm dev
```

`-y` 表示全部使用默认选项：只接入 Sandbox（浏览器里的模拟聊天窗口）、开启 Console 所需的 HTTP 服务、附带一个 `/hello` 命令，不启用 AI。想在创建时就选择真实平台、数据库或 AI，去掉 `-y` 使用交互向导；之后也可以随时用 `npx zhin setup` 补充。

## 2. 在 Console 验证

启动日志会打印 API Base；新脚手架当前默认是 `http://127.0.0.1:8068`。以终端实际输出或 `zhin.config.yml` 的 `http.port` 为准。

1. 打开 [console.zhin.dev](https://console.zhin.dev)。
2. 填入终端显示的 API Base。
3. Token 使用项目 `.env` 中的 `HTTP_TOKEN`。创建项目时终端只显示打码后的 Token 和它的存放位置，不会打印完整值，避免进入 CI 日志。
4. 打开侧栏「机器人 → 试聊一下」（Sandbox），发送 `/hello`。

收到回复才算首跑成功。这一条消息走完了完整的链路：Console 通过 HTTP 连上 Bot → Sandbox 适配器收到消息 → 匹配到 `commands/hello` → 回复经同一个适配器发回。之后接入真实平台，只是把 Sandbox 换成对应的适配器。

## 3. 认识刚生成的项目

想知道 Bot 还能执行哪些指令？在会话中发送 **`/菜单`**（无命令前缀时发 `菜单`）。它列出根插件的指令与子插件；再发 `/菜单 <插件实例名>` 可逐层查看。某条指令的参数用 `/hello --help` 查看。关键词可在项目配置中通过 `menuKeyword` 修改，详见[指令菜单](../authoring/commands.md#查看已加载的指令菜单)。

```text
my-bot/
├── package.json          # Runtime 拓扑：entry、features、plugins
├── zhin.config.yml       # Host 与插件配置值
├── .env                  # token、平台凭据、模型 Key
├── plugin.ts             # 根插件入口
├── commands/             # 文件路径就是命令路由
├── components/           # 可复用消息组件
└── pages/                # 插件贡献的 Console 页面
```

记住两点就够了：

- **`package.json` 的 `zhin` 字段描述“装了什么”**（入口、子插件），**`zhin.config.yml` 描述“怎么配”**（端口、凭据、插件配置），密钥放 `.env`。
- **放进 `commands/`、`components/`、`pages/` 等约定目录的文件会被自动注册**，不需要在 `plugin.ts` 里手动登记。

这些名词的完整解释见 [核心概念速览](./concepts.md)。

## 4. 修改并观察热重载

打开 `commands/hello/index.ts`，修改返回文案并保存，再发送 `/hello`——不用重启就能看到新回复。正在处理中的消息会用旧代码跑完；如果新代码有错误，旧版本会继续工作，终端会打印错误原因。

## 遇到问题

```bash
npx zhin doctor
```

Doctor 会检查 Node、pnpm、端口、`HTTP_TOKEN`、CORS 和项目清单。连接失败时先看终端打印的 API Base，不要默认套用其他项目的端口。

## 项目如何长大

| 当前需要 | 推荐形态 | 下一步 |
| --- | --- | --- |
| 验证一个想法 | 单文件 `bot.ts` | [single-file-bot](../examples/index.md#single-file-bot-一个-bot-ts-就是机器人) |
| 做命令与组件 | 单插件 + 约定目录 | [IM Bot 路径](../paths/im-bot.md) |
| 增加模型与工具 | 挂载 Agent Features | [AI Agent 路径](../paths/ai-agent.md) |
| 多账号与生产运维 | HTTP Host + Remote Console | [Console 管理路径](../paths/console.md) |

## Install tiers

<!--@include: ../snippets/install-tiers.md#tiers-table-->

## 下一步

1. [核心概念速览](./concepts.md)：把文档里常见的名词一次弄懂。
2. [第一个插件](./first-plugin.md)：写一个带配置的 `/ping` 命令。
3. [平台适配器](../adapters/index.md)：用 `npx zhin setup --adapters` 接入真实平台。
4. [AI 总览](../ai/index.md)：用 `npx zhin setup --ai` 接入大模型。
