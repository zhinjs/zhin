# Showcase: Multi-Platform Community Bot

> Corresponding example: [`examples/test-bot`](../../examples/test-bot/) (maintainer kitchen sink, full capability demonstration)
> Keywords: single instance multi-account, one process five QQ accounts, game plugins, cross-platform AI

## Scenario

Community operations: managing 5 QQ alt accounts across different groups, plus a QQ Official bot, a Slack workspace,
and GitHub repo notifications. Previously each platform had its own process and codebase -- now the requirement is
**one process manages everything**, with mini-games in group chats and @bot for AI conversations.

## Why zhin

The core reason is **single-instance multi-endpoint**: one adapter plugin instance hosts multiple accounts,
with `endpoints[i]` each having their own credentials while top-level fields are shared. Five icqq accounts
in the config means one `icqq` plugin + 5 endpoints, not one plugin duplicated five times.

## Deployment Architecture

```
                 ┌───────────────────────────────┐
 icqq × 5 ─────▶ │                               │
 qq official × 2 ▶ │  zhin (test-bot)              │
 slack ────────▶ │  ├─ AdapterIndex (11 endpoints) │
 github ───────▶ │  ├─ Game plugins × 9 (game-kit) │
                 │  ├─ Agent Host (AI chat/tools)  │
 sandbox ──────▶ │  └─ HTTP Host :8086             │
                 └───────────┬───────────────────┘
                             │ REST + SSE
                    ┌────────▼────────┐
                    │  Remote Console  │
                    └─────────────────┘
```

## Key Configuration (Sanitized)

```yaml
plugins:
  icqq:
    master: "${ICQQ_MASTER}"
    endpoints:                        # One instance, five accounts
      - name: "${ICQQ_ACCOUNT}"
      - name: "${ICQQ_ACCOUNT_2}"
      - name: "${ICQQ_ACCOUNT_3}"
      - name: "${ICQQ_ACCOUNT_4}"
      - name: "${ICQQ_ACCOUNT_5}"

  qq:
    mode: websocket
    intents: [GUILDS, GROUP_AND_C2C_EVENT]
    endpoints:
      - name: zhin                  # Main bot via self-hosted proxy gateway
        appid: "${QQ_APPID_2}"
        secret: "${QQ_SECRET_2}"
        gatewayUrl: "https://bots.example.com/gateway/102005927"
      - name: "102069707"           # Sandbox bot: per-item override
        appid: "${QQ_102069707_APPID}"
        secret: "${QQ_102069707_SECRET}"
        sandbox: true
```

## Lessons Learned

1. **Proxy gateway account mix-up**: The main bot uses a self-hosted proxy `gatewayUrl`; the sandbox bot must not inherit it --
   put `gatewayUrl` in the main bot's expanded entry rather than at the top level, otherwise the sandbox bot will connect to the wrong gateway.
2. **Messages sent from the wrong account**: With multiple endpoints, routing is by name (uin / bot name). In Console,
   one plugin card shows every endpoint's online status -- confirm which one is selected before sending a message.
3. **Credentials committed to git**: Credentials must always use `${ENV}` placeholders in `.env`; `zhin.config.yml`
   is safe to commit. QR code/wizard flows (`qq endpoint add`, WeChat iLink QR scan) also auto-write to `.env`.

## Operations Tips

- Logs are viewable directly on the Console "Logs" page (SystemLog persisted to database, with level filtering) -- no need to SSH and dig through files.
- Scheduled tasks (game session cleanup, lottery pipeline) are managed on the Console "Scheduled Tasks" page -- no config changes or restarts needed.
- AI uses OpenRouter free models as fallback; expensive models are routed by agent role (`ai.agents.<name>.provider`).
