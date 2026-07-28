# 案例：多平台社区 Bot

> 对应示例：[`examples/test-bot`](../../examples/test-bot/)（维护者厨房水槽，能力全集演示）
> 关键词：单实例多账号、一个进程五个 QQ 号、游戏插件、跨平台 AI

## 场景

社区运营：手里有 5 个 QQ 小号分管不同群，另有 QQ 官方 bot、Slack 工作区、
GitHub 仓库通知。以前是每个平台一个进程一套代码，现在要求**一个进程全管**，
还要能在群里玩小游戏、@bot 能 AI 对话。

## 为什么选 zhin

核心原因是**单实例多 endpoint**：一个适配器插件实例挂多个账号，
`endpoints[i]` 各配各的凭据，顶层字段共享。五个 icqq 账号在配置里是
一个 `icqq` 插件 + 5 个 endpoint，不是一个插件复制五份。

## 部署架构

```
                 ┌───────────────────────────────┐
 icqq × 5 ─────▶ │                               │
 qq 官方 × 2 ──▶ │  zhin（test-bot）              │
 slack ────────▶ │  ├─ AdapterIndex（11 endpoint）│
 github ───────▶ │  ├─ 游戏插件 × 9（game-kit）    │
                 │  ├─ Agent Host（AI 对话/工具） │
 sandbox ──────▶ │  └─ HTTP Host :8086           │
                 └───────────┬───────────────────┘
                             │ REST + SSE
                    ┌────────▼────────┐
                    │  Remote Console  │
                    └─────────────────┘
```

## 关键配置（脱敏）

```yaml
plugins:
  icqq:
    master: "${ICQQ_MASTER}"
    endpoints:                        # 一个实例，五个账号
      - name: "${ICQQ_ACCOUNT}"
      - name: "${ICQQ_ACCOUNT_2}"
      - name: "${ICQQ_ACCOUNT_3}"
      - name: "${ICQQ_ACCOUNT_4}"
      - name: "${ICQQ_ACCOUNT_5}"

  qq:
    mode: websocket
    intents: [GUILDS, GROUP_AND_C2C_EVENT]
    endpoints:
      - name: zhin                  # 主 bot 走自建代理网关
        appid: "${QQ_APPID_2}"
        secret: "${QQ_SECRET_2}"
        gatewayUrl: "https://bots.example.com/gateway/102005927"
      - name: "102069707"           # 沙箱 bot：逐项覆盖
        appid: "${QQ_102069707_APPID}"
        secret: "${QQ_102069707_SECRET}"
        sandbox: true
```

## 踩过的坑

1. **代理网关串号**：主 bot 走自建代理 `gatewayUrl`，沙箱 bot 不能继承——
   把 `gatewayUrl` 放在主 bot 的展开项里而不是顶层，否则沙箱 bot 会连错网关。
2. **消息发错账号**：多 endpoint 时按名字（uin / bot 名）路由，Console 里
   一个插件卡片下能看到每个 endpoint 的在线状态，发消息先确认选的是哪个。
3. **配置凭据进 git**：凭据一律 `${ENV}` 占位放 `.env`，`zhin.config.yml`
   可以进库。扫码/向导类流程（`qq endpoint add`、微信 iLink 扫码）也会自动写 `.env`。

## 运维经验

- 日志在 Console「日志」页直接看（SystemLog 落库，带级别过滤），不用 ssh 翻文件。
- 定时任务（游戏会话清理、彩票 pipeline）在 Console「定时任务」页管理，不用改配置重启。
- AI 用 OpenRouter 免费模型做兜底，贵模型按 agent 角色分流（`ai.agents.<name>.provider`）。
