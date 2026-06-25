# 5 分钟首跑

本页是 Zhin 新用户的黄金路径。目标：在 Remote Console 的 Sandbox 页发出 `hello` 并收到回复，可选体验 `card` 卡片。

## 1. 创建 IM-only 项目

```bash
npm create zhin-app my-bot -y
cd my-bot
```

`-y` 默认生成 Sandbox + Host API + Remote Console CORS，不启用 AI，也不要求 Ollama、OpenAI Key 或数据库。

也可零安装先试 [demo.zhin.dev](https://demo.zhin.dev)（预连 Sandbox，首次访问有使用引导，无需登录），或从 monorepo 的 [minimal-bot](https://github.com/zhinjs/zhin/tree/main/examples/minimal-bot) 调试。

## 2. 启动 Host

```bash
pnpm dev
```

终端里确认 Host 地址，一般是：

```text
http://127.0.0.1:8086
```

如果依赖安装失败，先运行：

```bash
pnpm install
npx zhin doctor
```

## 3. 连接 Remote Console

打开 [console.zhin.dev](https://console.zhin.dev)（本地自建 Host 时使用；**零安装体验请用 [demo.zhin.dev](https://demo.zhin.dev)**）。

| 字段 | 填写 |
|------|------|
| API Base | `http://127.0.0.1:8086` |
| Token | `.env` 中的 `HTTP_TOKEN` |

![Remote Console 登录：填写 API Base 与 Token](/images/first-run/console-login.svg)

登录后进入 **Sandbox / 沙盒** 页，点击连接：

![Sandbox 页显示已连接](/images/first-run/sandbox-connected.svg)

发送：

```text
hello
```

收到示例插件回复（含 `card` 与 `ai:` 引导）即首跑完成。

![hello 与 card 回复示意](/images/first-run/hello-card-reply.svg)

## 3.5 试试 card 卡片

在 Sandbox 发送：

```text
card
```

应收到 **@zhin.js/satori JSX** 渲染的状态卡片（HTML；安装 `@zhin.js/html-renderer` 可自动转图）。脚手架与 minimal-bot 均内置此示例命令。

## 4. 首跑后做什么（任选，无默认优先级）

| 目标 | 命令或文档 |
|------|------------|
| 接入 QQ / Discord 等 | `npx zhin setup --adapters` · [适配器索引](/adapters/) |
| 启用 AI 对话 | `npx zhin setup --ai` |
| 写插件 | [插件生命周期](/guide/plugin-lifecycle) |
| 检查项目健康 | `npx zhin doctor` |
| 安装社区插件 | [安装插件](/guide/plugin-install) |
| 排错 | [疑难排查](/troubleshooting/) |

## 判断首跑成功

- `pnpm dev` 没有退出。
- Console 登录成功。
- Sandbox 页显示已连接。
- 发送 `hello` 后有回复（含 card / ai 引导文案）。
- 发送 `card` 后有卡片回复。
- `npx zhin doctor` 没有 error；warn 可按建议处理。
