# Platform acceptance tools

These tools distinguish installed fake-platform evidence from real-platform evidence.
No command automatically promotes a public stability tier.

高级消息的平台能力、当前实现和实机证据边界见 [中文能力与限制表](./CAPABILITIES.zh-CN.md)。

Controlled loopback-only HTTP/WS interruption for isolated Telegram Polling and
forward OneBot11/NapCat instances: [中文切断 / 恢复工具指南](./FAULT-PROXY.md).
The local proxy tests verify interruption mechanics; real-account recovery still
requires the probe/recipient evidence described below.

## Installed consumer path (no accounts)

Run each mode from the repository after dependencies are installed:

```sh
node scripts/check-created-project.mjs --onebot11
node scripts/check-created-project.mjs --napcat
node scripts/check-created-project.mjs --telegram
node scripts/check-created-project.mjs --qq
```

Each creates tarballs of the workspace publish closure, installs the packed creator
into a temporary directory, creates a project, installs the candidate adapter
and executes its real CLI/Host/SDK through a local fake platform. It verifies
inbound `/hello`, outgoing platform API receipt, command HMR and production restart.
OneBot11/NapCat use forward WebSocket; Telegram uses Polling; QQ uses WebSocket.
This does not certify other transport modes or real platform behavior. The QQ
fixture redirects fixed SDK API origins only in the test child, retaining the
installed SDK and a local HTTP/WS server. No production SDK is substituted.

## Opt-in real reply probe

Use an isolated test project already configured for a real account. The user owns
login, pairing and the test account configuration. Store a policy locally with
mode 0600; target IDs are kept only in that local policy:

```json
{
  "version": 1,
  "platform": "telegram",
  "mode": "polling",
  "targets": [
    { "alias": "private-a", "adapter": "root/telegram", "endpoint": "test-bot", "kind": "private", "id": "REPLACE_WITH_AUTHORIZED_TEST_CONVERSATION" }
  ],
  "actions": ["reply-text"],
  "minIntervalMs": 5000,
  "maxSends": 20,
  "eventsPath": "/absolute/local/private-evidence.jsonl"
}
```

`adapter` is the conversation endpoint owner; `endpoint` is incoming
the command context endpoint ID, as shown by the configured Endpoint, not its display nickname.
The command silently ignores every nonallowlisted conversation. It performs only
the explicitly enabled probe action once per unique sample. It cannot send
unsolicited messages, change membership, or alter Webhooks.

```sh
node scripts/platform-acceptance/run.mjs --project /absolute/test-project --policy /absolute/policy.json --prepare
# In the test project, launch the existing real Zhin CLI with this environment:
ZHIN_ACCEPTANCE_POLICY=/absolute/policy.json pnpm exec zhin runtime start
# In a separate terminal, observe actual probe results:
node scripts/platform-acceptance/run.mjs --project /absolute/test-project --policy /absolute/policy.json --report /absolute/new-report.json --duration 30s
```

In each authorized private/group conversation send `/acceptance probe:sample0001`.
Use a new 8–64 character alphanumeric/underscore/hyphen sample ID per request.
You should receive `acceptance:private-a:sample0001`; recipient visibility is checked by the
operator, separately from the API acknowledgement. Repeated sample IDs are
blocked. Rate and total send budgets survive process restart through the private
evidence file. An exclusive lock serializes sends. A process death while holding
the lock blocks further sends until the operator checks the pending unknown send
and removes the stale `.lock`; it never blindly resends it.

The probe awaits `Message.$reply` through Zhin's unified output path. It writes
an unknown attempt **before** sending so process interruption cannot invent a
success. Final records contain only sample hashes, aliases, timestamps, outcomes,
latency and RSS. Remote response/error strings, credentials, IDs and message
contents are never written. The report whitelist also strips unknown event fields.
Reports are created exclusively with 0600 permissions; existing reports are not
overwritten.

`--duration 24h` or `72h` performs passive observation, with no extra platform
traffic. Without `--pid`, RSS is sampled on probes only; use `--pid` for periodic process samples.
Automated scenarios use their corresponding acknowledged probe results; failed
and unknown results take precedence over operator observations. Duration alone
is not a successful soak certification. Follow the full scenario protocol below
for fault phases, dual accounts and recipient-visible evidence.

Suggested soak review: 24h first run, 72h promotion run; predetermined traffic
cadence within the authorized budget, no cross-account delivery, no post-stop
reconnect, no unexplained duplicate, bounded restoration time and RSS/listener
trend. Platform outage and send outcome unknown must be visible in the report.
Thresholds need acceptance-owner approval and must be frozen before testing.

Remove `commands/acceptance/index.ts` when testing is finished. No tool accesses
real accounts unless the user explicitly starts the configured test project.

## Full controlled scenario protocol

Expand `actions` only for the test actions you authorize. Available actions:
`reply-text`, `reply-image`, `reply-quote`, `reply-interaction`, `reply-recall`,
`account-marker`. Each command uses `probe:<unique-id> action:<action>` after the
project's configured command prefix. The examples use `/`; if the adapter has an
empty `commandPrefix`, use `acceptance ...` instead of `/acceptance ...`.

| Scenario | Execution | Required evidence |
| --- | --- | --- |
| Private/group text | Send `acceptance probe:text0001 action:reply-text` from each allowlisted scene | Real receive→command→unified send receipt, operator sees matching alias/sample |
| Image | `acceptance probe:image001 action:reply-image` | Probe sends a fixed tiny PNG through canonical media; confirm actual rendered image separately |
| Quote | `acceptance probe:quote001 action:reply-quote` | Canonical reply segment references the incoming probe; operator verifies quote linkage |
| Recall | `acceptance probe:recall01 action:reply-recall` | Probe sends then uses canonical Endpoint control to recall that exact receipt; operator checks removal |
| Interaction | `acceptance probe:interact1 action:reply-interaction` | Answer the confirmation within 60s; native or text fallback is permitted, report actual behavior |
| Account isolation | Configure two targets on two distinct adapter/endpoint identities; send `account-marker` probes to both | Replies contain their target alias; both automated results and operator visible isolation observation are required |
| Network recovery | Baseline reply; record begin; user disconnects network/bridge; user reconnects and records end immediately; send fresh probe | Runner calculates end→first confirmed restoration time; unknown stays visible |
| HMR | Baseline probe; begin; edit a test command; end; send probe | Distinct generation plus confirmed post-end probe and operator evidence |
| Production restart | Baseline probe; begin; stop/restart test runtime; end; send probe | Distinct runtime PID plus confirmed post-end probe and operator evidence |
| Permission/rate limit | User safely applies a test permission restriction or controlled upstream fault; record actual expected rejection and recovery | Sanitized local logs and receipt evidence, no blind retry |
| Duplicate delivery | Repeat a sample ID and, if transport permits, deliberately replay the inbound update | Probe suppresses repeated sample, observer checks no repeated output; distinguish probe guard from platform update dedup |
| Send unknown | Interrupt transport after sending begins | Pending attempt stays unknown; never automatically resend; operator reconciles platform visibility |
| Soak | Observe with `--duration 24h`/`72h` and `--pid TEST_RUNTIME_PID`, continue authorized probes at the frozen cadence | Requested elapsed time, sufficient confirmed samples, bounded max gap and RSS growth, no failed/unknown, no interruption, and separate operator review |

Use `record.mjs` for operator stages and visibility observations. Each requires an
existing **absolute readable nonempty evidence file**; no freeform secret-bearing
log text is accepted on the command line. The report records the file under a
stable evidence label and distinguishes operator observations from automated data.

```sh
node scripts/platform-acceptance/record.mjs --policy /absolute/policy.json --scenario network-recovery --phase begin --status blocked --target private-a --evidence /absolute/baseline-redacted.json
# User disconnects and restores the authorized test network/bridge.
node scripts/platform-acceptance/record.mjs --policy /absolute/policy.json --scenario network-recovery --phase end --status pass --target private-a --evidence /absolute/recovery-redacted.json
```

A reported operator `pass` cannot override failed/unknown probes. For isolation,
two aliases on the same endpoint do not qualify as two accounts. Long-running
observation requires policy criteria fixed before the run, for example:

```json
"soak": { "minConfirmed": 96, "maxGapMs": 900000, "maxRssGrowthBytes": 33554432 }
```

These are example acceptance bounds, not existing framework guarantees. Ensure
`maxSends` and the planned traffic cadence permit them. RSS sampling uses `ps`
every 30s for the explicit local PID and never reads process arguments/environment.
If runtime PID changes, start a separate observation for the new process; combine
records during review rather than claiming continuity from the old PID.

Policy `mode` is checked against the project's configured Endpoint: Telegram
`polling`/`webhook`, QQ `websocket`/`webhook`/`middleware`, bridges `ws`/`wss`/`http`.
Real transport modes remain separate certifications: QQ WebSocket/HTTP,
Telegram Polling/Webhook, OneBot11 forward/reverse WS and NapCat forward/reverse
WS/HTTP. Run the same controlled scene protocol independently for each supported
mode. `unsupported` is reserved for a platform capability absent at runtime;
missing account, missing scenario evidence or an unexecuted mode is `blocked`.

## Version identity

The runner discovers the installed adapter package version and, for QQ, the
installed `qq-official-bot` SDK version. Native Telegram/OneBot transports name
the protocol instead of inventing a library version. For OneBot11/NapCat modes,
add the actual bridge version to the local policy before certification:

```json
"bridge": { "name": "NapCat", "version": "REPLACE_WITH_INSTALLED_BRIDGE_VERSION" }
```

Bridge metadata is explicitly labelled `operator-configured`; the runner does not
guess it from a protocol response. Omit the bridge field on direct QQ/Telegram
projects. Missing bridge metadata leaves certification blocked even when a text
probe passes. The template's placeholders must be replaced locally. Commit and
worktree identify the test project's source state; they are **not** a candidate
tarball SHA256 and cannot establish exact release artifact identity.

## Evidence precedence and process continuity

HMR/restart/recovery stages require `begin` and `end` markers for the **same**
target, a confirmed baseline before begin, and a confirmed probe after end.
HMR generation and restart PID changes are compared on that target only.
Unknown outcomes during a stage cannot be overridden by operator pass. Known
rejections only inside an intentional network/permission/rate-limit fault window
may be expected; after-restoration failures still fail the scenario.

`duplicate-delivery` needs actual repeated-sample suppression evidence, not an
operator assertion alone. `send-unknown` needs a real unknown attempt and a
subsequent explicit visibility reconciliation on the same target:

```sh
node scripts/platform-acceptance/record.mjs --policy /absolute/policy.json --scenario send-unknown --phase observation --status pass --reconciliation accepted --target private-a --evidence /absolute/redacted-reconciliation.json
```

Use `not-delivered` if recipient/platform inspection establishes no delivery, or
`unresolved` while uncertain. Reconciliation never removes the unknown count and
never causes an automatic resend.

Soak requires periodic samples of the **actual probe runtime PID**, covering the
observation window with at most 45 seconds between samples and near both ends.
Unrelated PID samples, cross-PID observation, stale tail samples or operator failure
block/fail certification; a later operator pass cannot erase failure. Mode is
explicitly labelled `operator-configured` and checked against project configuration;
it is not claimed as an independently observed live transport mode. The probe
checks the actual Endpoint adapter identity before performing any action.

This runner currently reads `zhin.config.yml` only. Other project configuration
formats need an explicitly converted isolated test fixture; the runner does not
silently load or rewrite them. Manifest platform checks support keyed object
references and string/object references with the same default instance key naming
as the CLI (`@zhin.js/adapter-telegram` → `telegram`).

高阶原生消息验收：`reply-markdown` → `markdown-roundtrip`，`reply-button` → `button-roundtrip`，`reply-share` → `share-roundtrip`。显式加入 policy.actions 后用新 probe 样本执行。三项都要求客户端可见观察证据；按钮须在 60 秒内点击 canonical keyboard 的「确认验收」，结果记录 `callbackObserved: true`，不能用文本或数字回答代替。分享固定公开 https://zhin.dev，检查中文标题/描述和链接，占位降级不算通过。

按钮发送后命令立即返回并释放发送锁，点击结果由独立观察器写入；不会阻塞轮询接收下一条回调。60 秒内未收到有效点击记录 unknown 并注销观察器，重复或迟到回调不能补记通过。进程退出未写结果时保留 attempt，报告仍视为未确认。
# Email TCP 故障代理（SMTP/IMAP）

`tcp-fault-proxy.mjs` 仅监听 `127.0.0.1`，把字节转发到启动时固定的上游，不终止 TLS、不记录流量/凭据、不修改系统网络。SMTP 与 IMAP 分别使用一个实例；适用于隐式 TLS（465/993）及连接内 STARTTLS。下面仅启动代理，不发送邮件：

```sh
node scripts/platform-acceptance/tcp-fault-proxy.mjs --upstream-host smtp.example.com --upstream-port 465 --port 18465 --control-port 18466
node scripts/platform-acceptance/tcp-fault-proxy.mjs --upstream-host imap.example.com --upstream-port 993 --port 18993 --control-port 18994
```

代理显示的 `controlOrigin` 支持 `GET /status`、`POST /cut`、`POST /recover`。`cut` 关闭既有上下游连接并拒绝新连接；`recover` 允许重新建连，不会恢复已关闭的 TCP 会话。Ctrl+C 停止并清理所有代理连接。状态输出只含本地监听地址、计数和状态。

连接代理时，Email 的连接 host/port 指向上述本地地址，TLS 的 serverName 必须保留原始 SMTP/IMAP 服务主机名，以保留 SNI 与证书主机名校验；不要设置 `rejectUnauthorized: false`，不要导入代理证书。适配器现提供 `smtp.serverName` / `imap.serverName`；验收项目分别通过可选 `EMAIL_SMTP_SERVER_NAME` / `EMAIL_IMAP_SERVER_NAME` 映射。未配置时保持原 SDK 默认行为。账号配置由操作者准备，指南不覆盖现有 `.env`。

故障验收顺序：先确认正常 IMAP 入站及 SMTP 出站；切断 IMAP，记录连接断开和恢复期间状态；恢复代理后确认适配器新建连接并重新收取新消息；单独切断 SMTP，确认发送失败/未知如实记录，恢复后仅对新样本发送。未知发送结果需检查收件箱，避免自动重发同一样本造成重复。最后停止两代理并恢复操作者原配置。代理本地测试证明 TLS 和切断行为，不代替真实邮箱恢复验收。

图片排查可显式选择固定样本：`acceptance probe:qqrgb0001 action:reply-image image:rgb`。
`image:rgb` 使用 128×128、8-bit RGB、无透明通道的标准 PNG；默认或 `image:legacy`
仍使用原 48×48 RGBA PNG，保留旧样本的失败证据。参数只接受 `rgb` / `legacy`，
不接受用户 URL 或文件路径，无需修改 `.env`。事件记录 `imageSample`，样本去重键也区分
RGB 与旧样本。更换样本是格式诊断，不能据此宣称适配器缺陷已修复；实际客户端图片显示
和 API 结果仍需各自记录。

跨账号隔离需要账号 A/B 各自的 `account-marker` confirmed 结果，以及每个目标在该结果
之后保留的可见证据（`phase: observation`、`status: pass`、非空 evidence label）。只有 A
截图、B API 回执或两个 endpoint 名称都不能替代真实账号身份/客户端可见性核验。
重复抑制证据必须属于相同 target、action 和 sample，且可见观察发生在 blocked 重复之后；
不能借用另一个账号或另一种动作的成功结果。同一 sample 在事件日志中变更 target/action
会被报告工具拒绝，避免覆盖某账号的 unknown 结果。
