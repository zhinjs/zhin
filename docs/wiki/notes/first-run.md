---
title: 怎样确认第一个 Bot 跑通？
---

# 怎样确认第一个 Bot 真的跑通了？

**看到进程启动还不够。** 在 Remote Console 的 Sandbox 会话发送 `/hello` 并收到回复，才证明新项目的 HTTP Host、鉴权、Endpoint、命令和出站链路连在了一起。

这个检查适合刚创建的 IM 项目，不需要平台账号或模型 Key。脚手架生成的 TypeScript 项目需要 Node.js `>=22.12.0` 和 pnpm 9 或更高版本。

## 从空目录开始

```bash
npm create zhin-app my-bot -y
cd my-bot
pnpm dev
```

终端会打印 API Base；新项目当前默认端口为 `8068`，但应以终端输出或 `zhin.config.yml` 为准。在 [console.zhin.dev](https://console.zhin.dev) 填入 API Base，Token 使用项目 `.env` 中的 `HTTP_TOKEN`，然后进入 Sandbox 会话发送 `/hello`。

如果 Console 连接不上，先核对 API Base 和 Token，再运行 `npx zhin doctor`。如果能连接却没有回复，就看命令是否被发现、Sandbox Endpoint 是否在线，以及终端是否报错。

## 接下来改哪里

改 `commands/hello/index.ts` 的回复文案，保存后再发一次 `/hello`，可以顺手确认热重载。新增平台或 AI 时，再分别走[适配器](/adapters/)与[AI 配置](/ai/)；这一步不必一次装全。

完整首跑步骤与版本要求见[入门指南](/getting-started/)。配置文件各自负责什么，见[配置指南](/configuration/)。
