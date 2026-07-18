# test-bot（厨房水槽 · Plugin Runtime）

> **这不是默认入门模板。** 新用户用 [`../minimal-bot`](../minimal-bot/)；L4 用 [`../full-bot`](../full-bot/)。

默认 `pnpm dev` = **Plugin Runtime**，平台配置对齐原 legacy 配置里**已经能跑**的那套（legacy `zhin dev/start` 路径与 `zhin.config.legacy.yml` 已移除）：

| 平台 | Runtime `plugins` | 凭据 |
|------|-------------------|------|
| Sandbox | `sandbox` | 本地 `/sandbox` |
| ICQQ | `icqq` … `icqq-5` | `${ICQQ_ACCOUNT}` … `${ICQQ_ACCOUNT_5}` |
| Slack | `slack` | `${SLACK_TOKEN}` / `${SLACK_APP_TOKEN}` / `${SLACK_SIGNING_SECRET}` |
| GitHub | `github` | `${GITHUB_APP_ID}` / `${GITHUB_PRIVATE_KEY}` |
| QQ 官方 | `qq` + `qq-sandbox` | `${QQ_APPID_2}` 等；`qq` 使用 `bots.l2cl.link` 代理 URL |

另挂 legacy 同款 games（game-hub / 猜数 / 对战 / blackjack 等）+ lottery + group-suite + activity-feedback + qrcode / short-url / link-poster / code-runner。

## Host 能力

- **Agent Host**：`ai: …` → **`ZhinAgent.process`**（入站队列 + IM session；CapabilityIngress tools + `ai.mcpServers` + speech tools + SOUL/AGENTS/TOOLS）。`ai: clear` 归档会话。含 **`SubagentSystem` + `spawn_task`**（可并行子代理）与 deferred meta（`discover` / `load_tool` / `load_skill`）。另含：`schedule_*`、assistant profile/events、collaboration Runtime 门闸、`bash` + Owner `/approve`（需 `plugins.*.master` / sandbox `owner`）。
- **Speech Host**：顶层 `speech:` → `voice_stt` / `voice_tts`（TTS 需 edge-tts；STT 需本机 Ollama whisper）；入站可 STT 后再进 ZhinAgent。
- **项目 tools**：`tools/*.ts` 用 `defineAgentTool` + zod；与命令共享 `lib/`。

会话 **DB 持久化已接**（DatabaseHost → `agent_*` / `im_transcripts`）。legacy `src/plugins/*`（AOP enrich/出站润色样例）已随 `zhin dev` 旧路径一并移除。

## 启动

```bash
pnpm install && pnpm build   # 仓库根
pnpm dev:test                # 或 cd examples/test-bot && pnpm dev
```

Node `>=22.18.0`（Plugin Runtime 依赖 Node 原生 TypeScript）。依赖本目录 `.env`（与 legacy 相同变量）。Console：https://console.zhin.dev → `http://127.0.0.1:8086`，Token `test-bot-dev-token`。

### 手测

| 命令 / 工具 | 期望 |
|-------------|------|
| `/ping` `/mem` `/status` `/heap` `/send` `/zt` | 本地诊断与 Satori 卡 |
| `/weather 成都` / tool `weather` | **实时** wttr.in（非 mock） |
| `/calc 2+3*(4-1)` / tool `calculator` | 安全算术解析（无 eval） |
| `/dice 2 6` / tool `dice` | 掷骰 |
| `/mem-debug` `/mem-profile` `/gc` | 内存明细 / 进程画像 / 可选 GC |
| `/test-err` | 异步组件错误探测 |
| tool `system_info` | 进程与主机事实 |
| `/gh help` / `gh repo` / `gh bind` / … | GitHub 子命令；`bind` 写入 DatabaseHost `github_oauth_users` |
| `ai: 你好` / `ai: @name …` / `ai: clear` | ZhinAgent 多轮；`@name` 注入 specialist 指令；可 `spawn_task` 并行子代理 |
| `/approve always bash`（Owner 私聊） | 永久放行 bash Owner 硬确认（需 `plugins.*.master`） |
| 语音入站 + `speech:` | metadata `audio_url` / `[audio:url]` → STT 再跑 ZhinAgent |
| `/games` `/猜数` | 游戏插件 |
| Sandbox `/sandbox` | 无平台也能聊 |

（legacy AOP enrich 样例已随旧路径移除）

### 质量约定（本目录）

- 禁止用 mock / stub /「deferred 命令」充场面；做不到就不要注册入口。
- 共享逻辑进 `lib/`，命令与 `tools/*.ts` 共用；工具用 `defineAgentTool` + zod。
- 安全：禁止 `eval` / `Function` 执行用户输入；密钥不得写入日志或回显。

## 许可证

MIT License
