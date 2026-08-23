# 10 分钟跑通第一个 Bot

本页只完成一个结果：在浏览器 Sandbox 里向新 Bot 发送 `/hello`，并收到真实 Runtime 的回复。这个闭环不需要平台账号，也不需要模型 Key。

## 开始前

- Node.js `^20.19.0` 或 `>=22.12.0`；直接运行 TypeScript 项目推荐 `>=22.18`。
- pnpm 9 或更高版本。
- 能访问 [Remote Console](https://console.zhin.dev)。

## 1. 创建并启动

```bash
npm create zhin-app my-bot -y
cd my-bot
pnpm dev
```

`-y` 创建 IM 黄金路径：HTTP Host、Sandbox、Remote Console 和 `/hello` 示例都已配置。需要选择真实平台、数据库或 AI 时，去掉 `-y` 使用交互向导。

## 2. 在 Console 验证

启动日志会打印 API Base；新脚手架当前默认是 `http://127.0.0.1:8068`。以终端实际输出或 `zhin.config.yml` 的 `http.port` 为准。

1. 打开 [console.zhin.dev](https://console.zhin.dev)。
2. 填入终端显示的 API Base。
3. Token 使用项目 `.env` 中的 `HTTP_TOKEN`。
4. 打开“渠道与会话”中的 Sandbox，会话里发送 `/hello`。

收到回复才算首跑成功。此时已经验证了 Console 鉴权、HTTP Host、Sandbox Endpoint、命令发现和出站回复整条链路。

## 3. 认识刚生成的项目

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

`package.json#zhin` 是拓扑唯一事实源；`zhin.config.yml` 只保存配置值。约定目录与 `setup()` 注册的能力最终进入同一个 generation projection。

## 4. 修改并观察热重载

打开 `commands/hello.ts`，修改返回文案并保存，再发送 `/hello`。新请求应进入新 generation；已经开始的请求继续使用原快照。

## 遇到问题

```bash
npx zhin doctor
```

Doctor 会检查 Node、pnpm、端口、`HTTP_TOKEN`、CORS 和项目清单。连接失败时先看终端打印的 API Base，不要默认套用其他项目的端口。

## 项目如何长大

| 当前需要 | 推荐形态 | 下一步 |
| --- | --- | --- |
| 验证一个想法 | 单文件 `bot.ts` | [single-file-bot](../examples/index.md#single-file-bot-一个-botts-就是机器人) |
| 做命令与组件 | 单插件 + 约定目录 | [IM Bot 路径](../paths/im-bot.md) |
| 增加模型与工具 | 挂载 Agent Features | [AI Agent 路径](../paths/ai-agent.md) |
| 多账号与生产运维 | HTTP Host + Remote Console | [Console 管理路径](../paths/console.md) |

## Install tiers

```md
<<< ../snippets/install-tiers.md#tiers-table
```

继续学习时先选目标，不必先读完整包结构：[从问题选解决方案](../solutions/)。
