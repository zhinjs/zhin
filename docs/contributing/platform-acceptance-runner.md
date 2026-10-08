# 平台实机验收指南

本指南分为两部分：无需账号的安装产物验收，以及使用真实账号的收发与长跑验收。模拟平台通过只证明本地安装和运行链路；任何命令都不会自动提升平台的公开稳定档位。

本仓库已提供[预配置的实机验收 example](../../examples/platform-acceptance-bot/README.md)。在 `examples/platform-acceptance-bot/.env` 填写要测试的平台变量，然后用 `pnpm --filter platform-acceptance-bot dev:napcat`（或 `dev:onebot11`、`dev:qq`、`dev:telegram`）启动。该例会自动生成本指南中的项目配置、探针与本地策略，无需手工编辑 JSON。

## 一、无需账号：检查安装产物

在仓库根目录安装依赖后，分别执行：

```sh
pnpm check:created-project:onebot11
pnpm check:created-project:napcat
pnpm check:created-project:telegram
pnpm check:created-project:qq
```

每条命令都会打包所需的 workspace 包，在临时目录中安装打包后的项目创建器，创建项目并安装候选适配器。随后使用实际 CLI、Host 和 SDK 连接本地模拟平台，验证 `/hello` 入站、平台发送回执、命令热重载（HMR）和生产重启。

覆盖模式为 OneBot11/NapCat 正向 WebSocket、Telegram Polling、QQ WebSocket。其他接入模式和真实平台行为需要单独验收。QQ 的模拟程序只在测试子进程中重定向 SDK 的固定 API 地址，保留实际安装的 SDK，连接本地 HTTP/WS 服务。

## 二、准备真实账号和测试项目

使用独立测试项目，先配置好真实账号。账号登录、配对和测试账号配置由你完成。

| 平台 | 首轮需要准备 | 后续完整验收追加 |
| --- | --- | --- |
| NapCat / OneBot11 | 已登录的专用 QQ 桥实例、桥版本、可访问的 WS 地址、本地 token、测试好友和群 | 第二个独立账号/桥实例；反向 WS；NapCat HTTP；媒体、引用、撤回权限 |
| Telegram | Bot token、测试私聊和群、能访问 Bot API 的网络；先使用 Polling | 第二个 Bot；Webhook 公网 HTTPS 地址和 secretToken；所需群权限 |
| QQ 官方 | AppID/Secret、应用类型和沙箱/上线状态、已授权测试用户及群/频道、所需 intents | 第二个独立应用；HTTP 回调地址；分别记录公域/私域及主动发送限制 |

凭据保存在本地环境变量或 `.env`，配置用 `${VAR}` 引用。测试目标 ID 只放在本地策略文件里。

## 三、先跑一次文本收发

### 1. 创建本地策略文件

将下面内容保存为本地 `policy.json`，文件权限设为 `0600`。示例使用 Telegram；请替换测试会话 ID、端点 ID 和绝对路径。

```json
{
  "version": 1,
  "platform": "telegram",
  "mode": "polling",
  "targets": [
    { "alias": "private-a", "adapter": "root/telegram", "endpoint": "test-bot", "kind": "private", "id": "替换为已授权的测试会话ID" }
  ],
  "actions": ["reply-text"],
  "minIntervalMs": 5000,
  "maxSends": 20,
  "eventsPath": "/absolute/local/private-evidence.jsonl"
}
```

字段含义：

| 字段 | 如何填写 |
| --- | --- |
| `platform` | `telegram`、`qq`、`onebot11` 或 `napcat` |
| `mode` | 与项目配置一致：Telegram 为 `polling`/`webhook`；QQ 为 `websocket`/`webhook`/`middleware`；桥为 `ws`/`wss`/`http`，具体以适配器支持的模式为准 |
| `targets[].alias` | 自定义测试目标别名，报告使用它代替真实会话 ID |
| `targets[].adapter` | 会话端点所属的插件 owner，例如 `root/telegram` |
| `targets[].endpoint` | 配置中的 Endpoint ID，也就是入站命令上下文的端点 ID；不要填显示昵称 |
| `targets[].kind` | `private`、`group` 或 `channel` |
| `targets[].id` | 该平台实际的测试会话 ID |
| `actions` | 本次允许执行的动作；首轮仅开启 `reply-text` |
| `minIntervalMs` | 两次探针发送的最小间隔，单位毫秒，至少 1000 |
| `maxSends` | 本地持久化的探针次数上限 |
| `eventsPath` | 保存原始验收记录的本地绝对路径 |

探针会忽略白名单之外的会话。每个唯一测试样本只执行已授权的动作，不会主动发起会话、改变成员或修改 Webhook。

### 2. 安装探针并启动项目

前后两条 `node` 命令在 Zhin 仓库根目录运行。中间的启动命令在你的测试项目目录运行。所有 `/absolute/...` 都需要替换为实际绝对路径。

```sh
node scripts/platform-acceptance/run.mjs --project /absolute/test-project --policy /absolute/policy.json --prepare

# 切换到测试项目目录，启动已配置的真实账号：
ZHIN_ACCEPTANCE_POLICY=/absolute/policy.json pnpm exec zhin runtime start

# 另开终端，在 Zhin 仓库根目录开始观察：
node scripts/platform-acceptance/run.mjs --project /absolute/test-project --policy /absolute/policy.json --report /absolute/new-report.json --duration 30s
```

`--prepare` 会创建 `commands/acceptance/index.ts`，不会覆盖已有同名文件。运行器目前只读取 `zhin.config.yml`；使用其他配置格式时，需准备显式转换的独立测试项目，它不会自动改写原配置。

### 3. 从测试会话发送命令

在观察的 30 秒内，从白名单中的私聊或群聊发送：

```text
/acceptance probe:sample0001
```

预期收到：

```text
acceptance:private-a:sample0001
```

每次请求使用新的样本 ID：8–64 个英文字母、数字、下划线或连字符。实际看到回复需要你核对，API 回执本身只证明平台接受了请求。

示例使用 `/` 命令前缀。如果适配器的 `commandPrefix` 为空，请发送 `acceptance ...`，省略开头的 `/`。

## 四、逐项验证能力与故障恢复

只在 `actions` 中开启你准备测试的动作。支持 `reply-text`、`reply-image`、`reply-quote`、`reply-interaction`、`reply-recall` 和 `account-marker`。

下面命令按空前缀展示；如果项目使用 `/`，请在命令前添加 `/`。

| 场景 | 操作 | 需要核对的证据 |
| --- | --- | --- |
| 私聊/群聊文本 | 在每个白名单会话发送 `acceptance probe:text0001 action:reply-text` | 入站→命令→统一发送回执；实际回复的别名与样本对应 |
| 图片 | `acceptance probe:image001 action:reply-image` | 探针通过标准媒体链路发送固定小 PNG；实际看到图片 |
| 引用 | `acceptance probe:quote001 action:reply-quote` | 回复引用了本次入站消息，引用关系正确 |
| 撤回 | `acceptance probe:recall01 action:reply-recall` | 探针先发送，再通过 Endpoint 控制端口撤回该回执对应的消息；实际看到消息消失 |
| 交互 | `acceptance probe:interact1 action:reply-interaction` | 在 60 秒内回答确认；记录实际使用的平台原生交互或文本回退 |
| 双账号隔离 | 配置两个独立适配器/端点身份，分别发送 `account-marker` 动作 | 两边回执成功，回复别名正确，并有人工观察记录；同端点的两个别名不算双账号 |
| 断网恢复 | 先成功收发；记录 begin；断开测试连接/桥；恢复后立即记录 end；发送新探针 | end→首个确认回执的恢复耗时；未知结果保留 |
| 热重载 | 成功基线；begin；修改测试命令；end；发送新探针 | 同目标的 generation 发生变化，end 后探针成功，并有人工证据 |
| 生产重启 | 成功基线；begin；停止并重启测试运行时；end；发送新探针 | 同目标的进程 PID 变化，end 后探针成功，并有人工证据 |
| 权限拒绝/限流 | 在授权测试环境施加权限限制或受控上游故障，记录预期拒绝和恢复 | 脱敏日志及回执；不要通过轰炸平台制造限流，不盲目重试 |
| 重复投递 | 重复同一个样本 ID；若传输允许，再重放入站 update | 重复样本被抑制，没有重复回复；区分探针自身防重复与平台 update 去重 |
| 发送结果未知 | 发送开始后中断传输 | attempt 保留为 unknown；人工核对是否送达，不自动重发 |
| 长跑 | 使用 `--duration 24h` 或 `72h` 和 `--pid 测试运行时PID`，按预定频率持续发送授权探针 | 实际时长、样本量、最大空档、RSS 趋势、失败/未知、进程连续性及人工复核 |

### 记录人工观察和故障阶段

`record.mjs` 记录人工阶段及可见性观察。每条记录必须引用一个**已存在、可读、非空的绝对路径证据文件**。请先将日志或观察记录脱敏后保存；命令行不接收自由输入的日志正文。

图片、引用和撤回不能只凭 API 回执 `confirmed` 通过。报告要求每个已执行目标都有探针之后的 `--phase observation --status pass` 记录，且 `--target` 与该平台的目标别名一致。证据需显示实际图片、平台原生引用关系或消息消失；`[image]`、`[reply]` 文字降级不算通过，应记录 `fail`。缺少可见性证据时报告保持 `blocked`，失败或未知回执不会被人工通过记录覆盖。

```sh
node scripts/platform-acceptance/record.mjs --policy /absolute/policy.json --scenario quote-roundtrip --phase observation --status pass --target lark-a --evidence /absolute/quote-visible.png
```

例如断网恢复：

```sh
node scripts/platform-acceptance/record.mjs --policy /absolute/policy.json --scenario network-recovery --phase begin --status blocked --target private-a --evidence /absolute/baseline-redacted.json

# 只断开并恢复授权的测试连接/桥，恢复后立即记录 end：
node scripts/platform-acceptance/record.mjs --policy /absolute/policy.json --scenario network-recovery --phase end --status pass --target private-a --evidence /absolute/recovery-redacted.json

# 然后从同一测试会话发送一个新样本的探针。
```

HMR、重启和恢复都要求：同一目标、begin 前的成功基线、end 后的成功探针。generation/PID 只在同一目标上比较，不能用其他账号的变化凑数。

人工 `pass` 不能覆盖失败或未知探针。仅故意施加的网络/权限/限流故障窗口内，明确拒绝才可作为预期结果；恢复后的失败仍算失败。空样本不能让场景通过。

### 人工核对未知发送

`send-unknown` 需要实际 unknown 记录，以及随后对同一目标的送达核对：

```sh
node scripts/platform-acceptance/record.mjs --policy /absolute/policy.json --scenario send-unknown --phase observation --status pass --reconciliation accepted --target private-a --evidence /absolute/redacted-reconciliation.json
```

`accepted` 表示核对后确认已被接受；确认未送达时使用 `not-delivered`；仍不确定时使用 `unresolved`。核对不会清除 unknown 计数，也不会触发自动重发。

## 五、进行 24h / 72h 长跑

建议先做 24h 初验，再做 72h 升档候选验收。先确定流量频率、允许预算和验收阈值，然后开始观察。例如在策略中增加：

```json
"soak": { "minConfirmed": 96, "maxGapMs": 900000, "maxRssGrowthBytes": 33554432 }
```

这里是示例阈值：至少 96 个确认样本、最大 15 分钟空档、RSS 最大增长 32 MiB。它们不是框架已有保证；你应在运行前确定适合测试负载的值，并确保 `maxSends` 足够。

```sh
node scripts/platform-acceptance/run.mjs --project /absolute/test-project --policy /absolute/policy.json --report /absolute/new-soak-report.json --duration 24h --pid 12345
```

将 `12345` 替换为**实际执行探针的测试运行时 PID**。观察器不会额外发送平台消息，需要你按授权频率持续触发探针。

RSS 是进程驻留内存。观察器每 30 秒用 `ps` 采样指定 PID，不读取进程参数或环境变量。长跑通过要求采样对应实际探针 PID、覆盖整个观察窗口，采样间隔及两端空档均不超过 45 秒。无关 PID、跨 PID、尾段缺失或人工失败记录不能被后续 pass 覆盖。

运行时 PID 变化后，给新进程重新启动独立观察，复核时合并记录；不要将旧 PID 的数据当作重启后的连续观测。不带 `--pid` 时只在探针执行时采样 RSS，通常不足以满足完整长跑采样要求。

仅运行满时长不算长跑成功。还需核对没有串号、停机后重连、无法解释的重复，以及恢复耗时和 RSS/监听器趋势。平台故障与发送未知结果必须在报告中保留。

## 六、填写版本信息，理解报告结果

运行器读取实际安装的适配器版本；QQ 还会记录 `qq-official-bot` SDK 版本。Telegram/OneBot 原生实现记录协议名称，不编造 SDK 版本。

OneBot11/NapCat 在本地策略中增加实际桥版本：

```json
"bridge": { "name": "NapCat", "version": "替换为实际安装的桥版本" }
```

桥版本标为 `operator-configured`，表示由你填写，程序不会从协议响应猜测。QQ/Telegram 直连项目不填该字段。缺少桥版本时，即使文本通过，认证仍为 blocked。

模式也标为 `operator-configured`，并与项目配置核对，不宣称已独立观测真实传输模式。探针执行前会校验实际 Endpoint 的平台身份。Manifest 支持显式 instanceKey 对象，以及与 CLI 默认命名一致的字符串/对象引用，例如 `@zhin.js/adapter-telegram` 默认对应 `telegram`。

| 结果值 | 含义 |
| --- | --- |
| `pass` | 该场景具备所要求的证据并通过检查 |
| `fail` / `failed` | 场景或请求失败；报告不同字段使用对应值 |
| `unknown` | 发送结果不确定，平台可能已经接受；不能当作安全重试条件 |
| `blocked` | 环境、样本或必要证据未齐，尚不能验收 |
| `unsupported` | 平台/运行时明确不支持该能力 |

报告按白名单保留样本哈希、别名、时间、结果、延迟和资源数据，不写入远端响应/错误正文、凭据、真实会话 ID 或消息内容。证据文件路径仍指向本地文件；分享前请检查这些文件已脱敏。报告用 `0600` 权限创建，不覆盖已有报告。

commit 和工作区状态表示测试项目源码状态，**不是**候选 tarball 的 SHA256，不能单靠它确认具体发布产物。QQ WebSocket/HTTP、Telegram Polling/Webhook、OneBot11 正反向 WS、NapCat 正反向 WS/HTTP 都需要按模式分别验收；未执行的模式保留 blocked。

## 七、测试结束与异常中断

探针通过统一 `Message.$reply` 链路发送，在发送前先记录 unknown attempt，防止进程中断制造假成功。样本防重复、频率和总预算通过本地证据文件跨重启保留，独占锁串行化探针。

如果进程持锁期间退出，后续探针会被阻止。先核对未完成的 unknown 发送，再手动移除遗留 `.lock`；不要直接重发同一个请求。

测试完成后删除测试项目中的 `commands/acceptance/index.ts`。只有你显式启动已配置的测试项目后，探针才会使用真实账号。
