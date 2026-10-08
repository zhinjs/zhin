# 平台实机验收项目

第一轮四平台文本收发已通过。继续测试见[第二轮操作单](./NEXT-TESTS.md)；新准备的 Discord、Slack、KOOK、Email 见[新增平台账号与启动指南](./ADDITIONAL-PLATFORMS.md)。

高阶能力适用性、当前实现与限制见[中文能力表](../../scripts/platform-acceptance/CAPABILITIES.zh-CN.md)。实际通过项仍以[当前验收记录](./CURRENT-ACCEPTANCE.md)为准。

LINE 见[账号准备指南](./LINE-ACCOUNT-PREPARATION.md)。飞书与钉钉接收模式见[长连接与 Stream 准备指南](./WEBHOOK-ACCOUNT-PREPARATION.md)。

这个 example 已装配 NapCat、OneBot11、QQ 官方、Telegram、Discord、Slack、KOOK、Email、飞书和钉钉。它们共用本目录的 `.env`，每次只启动所选的平台，运行目录与证据分别保存在 `.acceptance/<平台>/`，不会同时连接全部平台。

## 你只需填写 `.env`

初始化时已创建空白 `.env`（权限 0600，Git 忽略）。只填写准备测试的平台对应变量，不需要一次填完全部平台：

| 平台 | 必填变量 | 模式 |
| --- | --- | --- |
| NapCat | `NAPCAT_WS_URL`、`NAPCAT_BRIDGE_VERSION`、`NAPCAT_TEST_CHAT_ID`；桥启用鉴权时填写 `NAPCAT_ACCESS_TOKEN` | 正向 WS |
| OneBot11 | `ONEBOT11_WS_URL`、`ONEBOT11_BRIDGE_VERSION`、`ONEBOT11_TEST_CHAT_ID`；桥启用鉴权时填写 `ONEBOT11_ACCESS_TOKEN` | 正向 WS |
| QQ 官方 | `QQ_APP_ID`、`QQ_APP_SECRET`、`QQ_TEST_CHAT_ID`；确认 `QQ_SANDBOX` 和 `QQ_BOT_KIND` | WebSocket |
| Telegram | `TELEGRAM_BOT_TOKEN`、`TELEGRAM_TEST_CHAT_ID` | Polling |

`*_TEST_CHAT_ID` 是受控测试会话 ID，不是 Bot 自己的账号 ID。默认私聊；测试群聊改为 `*_TEST_CHAT_KIND=group`，频道则为 `channel`。每个平台首轮只配置一个白名单目标。

变量模板见 [.env.example](./.env.example)。凭据不会写进生成的 YAML，只以 `${VAR}` 引用；策略中的目标 ID 和生成的报告留在被 Git 忽略的 `.acceptance/`。

### 不知道测试会话 ID 时

QQ 官方和 Telegram 都可先将对应 `*_TEST_CHAT_ID` 临时填成 `pending`。示例会自动开启 debug 日志并提示获取 ID 模式。填好凭据后，正常启动即可，例如：

```sh
pnpm --filter platform-acceptance-bot dev:telegram
```

私聊自己的 Telegram Bot，点击 Start 或发送 `/start`。日志会显示 `receive | conv: private:123456789 | ...`；取 `private:` 后的数字，填入 `TELEGRAM_TEST_CHAT_ID`，停止后重新启动。此时 `TELEGRAM_TEST_CHAT_KIND=private`。

测群聊时将 Bot 加入测试群，发送 `/start@你的Bot用户名`，读取 `conv: group:...` 后的完整数字（保留负号），并设置 `TELEGRAM_TEST_CHAT_KIND=group`。QQ 则用 `dev:qq`，发送消息后读取 `recv private:...` 或 `recv group:...` 的会话 ID。`pending` 不匹配真实会话，因此获取 ID 期间探针不会自动回复。

## 启动与第一次收发

在仓库根目录执行对应命令：

```sh
pnpm --filter platform-acceptance-bot dev:napcat
pnpm --filter platform-acceptance-bot dev:onebot11
pnpm --filter platform-acceptance-bot dev:qq
pnpm --filter platform-acceptance-bot dev:telegram
```

任选一条启动。缺少变量时只提示变量名，不输出凭据。脚本自动生成独立的 Plugin Runtime 项目、平台配置、白名单和 `/acceptance` 探针，再启动实际 CLI。默认模式的 HTTP Host 使用回环地址及随机端口；进阶入站模式使用可配置固定端口。

**NapCat 与 OneBot11 如果连接同一个 QQ 桥，请轮流启动，不要同时运行。Telegram 的同一个 Bot 也不要有另一个 Polling 消费者。**

另开终端，先开始 30 秒观察，例如：

```sh
pnpm --filter platform-acceptance-bot observe:telegram
```

在这 30 秒内，从 `.env` 中配置的测试会话发送：

```text
/acceptance probe:sample0001
```

预期回复 `acceptance:telegram-a:sample0001`；其他平台的别名分别为 `napcat-a`、`onebot11-a`、`qq-a`。每次使用新的 8–64 字符样本 ID。报告自动写入 `.acceptance/<平台>/reports/`，不会覆盖旧报告。

观察命令读取已启动项目的策略，不会重写运行中的命令或配置。

## 生产启动、其他动作与长跑

生产模式（关闭 watch）：

```sh
pnpm --filter platform-acceptance-bot start:telegram
```

`prepare:<平台>` 只生成配置并检查必填变量，不连接平台。默认只允许文本动作；要测试其他能力，在 `.env` 中修改 `ACCEPTANCE_ACTIONS`，例如：

```dotenv
ACCEPTANCE_ACTIONS=reply-text,reply-image,reply-quote,reply-recall,reply-interaction
```

重新启动后，发送对应动作：

```text
/acceptance probe:image0001 action:reply-image
```

长跑前先成功发送一次文本探针，脚本从回执记录取得实际运行时 PID。随后开始观察，按策略预算和预定频率继续人工发送授权探针：

```sh
pnpm --filter platform-acceptance-bot observe:telegram 24h
# 或 72h
pnpm --filter platform-acceptance-bot observe:telegram 72h
```

长跑不自动制造平台流量。默认阈值和预算在 `.env` 中调整。进程重启后先发送新的成功探针，再开始新的观察；跨进程数据不能当作连续运行证据。

HMR 时编辑 `.acceptance/<平台>/project/commands/acceptance/index.ts` 中的描述等无副作用内容。重新执行 dev/start 会从本例源码重新生成该运行目录，不保留这些临时修改，但保留证据与报告。

本例覆盖单账号与下方接入模式。双账号、故障阶段记录及验收结果解释见[完整中文实机验收指南](../../docs/contributing/platform-acceptance-runner.md)。人工 `pass` 不能抹掉失败/未知结果，模拟安装通过不代表真实平台已认证。


## 反向 WS 与 HTTP 回调模式

现有启动命令不变，在你自己的配置中追加对应变量，再停止旧进程并启动。MODE 不填写时保持原来的默认模式。不要覆盖已经准备的凭据。

| 平台模式 | 追加变量 | 平台或桥侧配置 |
| --- | --- | --- |
| NapCat 反向 WS | `NAPCAT_MODE=wss`、`NAPCAT_REVERSE_WS_PATH=/napcat/reverse` | 让桥连接 `ws://127.0.0.1:18080/napcat/reverse`，鉴权使用现有 `NAPCAT_ACCESS_TOKEN` |
| OneBot11 反向 WS | `ONEBOT11_MODE=wss`、`ONEBOT11_REVERSE_WS_PATH=/onebot11/reverse` | 让桥连接 `ws://127.0.0.1:18080/onebot11/reverse`，鉴权使用现有 `ONEBOT11_ACCESS_TOKEN` |
| NapCat HTTP | `NAPCAT_MODE=http`、`NAPCAT_HTTP_URL`、`NAPCAT_POST_PATH=/napcat/events` | HTTP_URL 是桥的出站 API；桥的 POST 上报地址为 `http://127.0.0.1:18080/napcat/events` |
| QQ 官方 HTTP | `QQ_MODE=webhook`、`QQ_WEBHOOK_PATH=/qq/events` | 在 QQ 后台将公网 HTTPS 回调转发到本地 `18080/qq/events`；`middleware` 模式也可单独验收 |
| Telegram Webhook | `TELEGRAM_MODE=webhook`、`TELEGRAM_WEBHOOK_DOMAIN`、`TELEGRAM_WEBHOOK_PATH=/telegram/events`、`TELEGRAM_WEBHOOK_SECRET` | DOMAIN 是公网 HTTPS 域名（不含事件路径），转发到本地 `18080`；启动时适配器注册 Webhook |

这些模式使用 `ACCEPTANCE_HTTP_PORT`（默认 `18080`，范围 1–65535）和 `ACCEPTANCE_HTTP_HOST`（默认 `127.0.0.1`）。远端桥不能通过自己的 `127.0.0.1` 访问此电脑，需要你准备实际可达的地址或转发。`wss` 是适配器的反向 WS 模式名；若需要 TLS，由 HTTPS/WSS 代理终止。

先执行 `prepare:<平台>` 检查生成的配置，再启动并从同一白名单会话发送新的探针。证据策略会保存实际模式标签。默认模式继续使用 `.acceptance/<平台>/`；其他模式使用 `.acceptance/<平台>-<模式>/`，证据和报告相互隔离。上述配置生成测试属于本地验证，真实回调连通性仍需实机验收。


## 同平台双账号

追加 `<平台前缀>_B_TEST_CHAT_ID` 即启用账号 B，例如 `TELEGRAM_B_TEST_CHAT_ID`。其余账号 B 字段均在平台前缀后插入 `_B_`：Telegram 使用 `TELEGRAM_B_BOT_TOKEN`；QQ 使用 `QQ_B_APP_ID`、`QQ_B_APP_SECRET`；桥使用 `NAPCAT_B_WS_URL`、`NAPCAT_B_BRIDGE_VERSION`、`NAPCAT_B_ACCESS_TOKEN` 等。B 不继承 A 的凭据，缺失会明确提示 B 的变量名。`*_B_TEST_CHAT_KIND` 独立配置。

两账号共用当前模式与 HTTP Host，生成独立端点 `test-bot` / `test-bot-b`、独立目标别名 `<平台>-a` / `<平台>-b`，readiness 要求两个端点。反向 WS、HTTP 上报及 Webhook 的 B 路径必须不同，例如 `TELEGRAM_B_WEBHOOK_PATH=/telegram/b/events`；Webhook 域名和 secret 也要填写对应 B 字段。分别从两组白名单会话发送不同样本 ID，核对回复中的 a/b 别名与各账号身份。该配置只准备隔离验收，不代替实机双账号验证。

### Telegram 可控故障代理入口

验收启动时可用 `TELEGRAM_API_BASE_URL=http://127.0.0.1:18200` 覆盖 API 入口；账号 B 使用 `TELEGRAM_B_API_BASE_URL`。生成配置仅保存环境变量引用，不保存 URL 或 Token 原值。只指向专用测试代理，默认仍使用 Telegram 官方 API；不要与其他运行中的同 Token 轮询进程并行启动。代理切断和恢复后的真实收发须单独记录，配置生成通过不代表故障恢复通过。

当前真实通过项、失败记录和下一轮待测范围见 [当前验收表](./CURRENT-ACCEPTANCE.md)。

## 高阶消息：Markdown、按钮、分享

在临时验收配置中显式允许 `reply-markdown,reply-button,reply-share` 后重启测试项目，仍只接收原白名单会话。每个探针使用新样本，间隔至少 5 秒：

```text
/acceptance probe:markdown0001 action:reply-markdown
/acceptance probe:button0001 action:reply-button
/acceptance probe:share0001 action:reply-share
```

Markdown 应呈现粗体、行内代码、可点击 Zhin 链接及 `& < >` 字符，平台纯文本降级不能记原生通过。按钮使用 canonical keyboard（不是普通文本确认），在 60 秒内点击「确认验收」；只有原发起人在原会话产生实际 action 回调，记录才有 `callbackObserved: true`。文字、数字回答不能代替点击；不支持原生交互的平台明确 unsupported，超时 unknown。处理结束注销 handler。

分享使用公开 `https://zhin.dev` 及中文标题、描述。必须检查目标链接、标题、描述实际显示；Telegram 当前映射为 HTML 可点击链接及描述，不能称为原生分享卡片；`[share]` 占位或丢字段不能算通过。报告新增 `markdown-roundtrip`、`button-roundtrip`、`share-roundtrip`，三者均要求后续保留可见证据，按钮另要求点击回调证据。

按钮回调同时匹配 adapter、endpoint、会话/父会话/线程及发起人。Telegram 必须有 `sourceMessageId` 并与发送回执相同；其他平台若提供该字段也严格比较，未提供时以本次唯一回调载荷、完整会话及发起人关联，报告可见证据须标明平台的关联范围。

按钮发送后命令立即返回并释放发送锁，点击结果由独立观察器写入；不会阻塞轮询接收下一条回调。60 秒内未收到有效点击记录 unknown 并注销观察器，重复或迟到回调不能补记通过。进程退出未写结果时保留 attempt，报告仍视为未确认。


钉钉原生按钮验收需已关联当前应用的互动卡片模板。模板搭建按[卡片模板指南](../../plugins/adapters/dingtalk/CARD-TEMPLATE.md)配置，其中正文 `text` 使用富文本变量，按钮 label/payload 使用普通文本变量。启动时注入 `DINGTALK_CARD_TEMPLATE_ID` 和可选 `DINGTALK_CARD_BUTTON_COUNT`（1–5，默认 2）；固定按钮数须与模板一致。例如：

```bash
DINGTALK_CARD_TEMPLATE_ID=your-template.schema DINGTALK_CARD_BUTTON_COUNT=2 pnpm dev:dingtalk
```

生成配置保留模板 ID 的环境变量引用，按钮数量经整数范围校验。无需修改真实 `.env`。模板接入和配置测试通过不能代替卡片展示、点击及 Core 接纳的实机证据。

### 钉钉 Stream 故障验收临时配置

`run.mjs` 通过 `additional-profiles.mjs` 接收可选进程环境变量 `DINGTALK_STREAM_PROXY_PORT` 与 `DINGTALK_STREAM_PROXY_SERVER_NAME`，两者需同时填写；留空保持直连。用启动命令临时覆盖，不覆盖已有 `.env`：

```sh
DINGTALK_STREAM_PROXY_PORT=18443 DINGTALK_STREAM_PROXY_SERVER_NAME=实际网关域名 pnpm --filter platform-acceptance-bot dev:dingtalk
```

网关域名未知可先用占位域名，身份不匹配日志只显示安全 hostname，随后配置固定上游 TCP 代理；参考[钉钉代理验收指南](../../plugins/adapters/dingtalk/README.md)。仅 WSS入站被切断，出站sessionWebhook仍直连。

### Discord Gateway 故障验收临时配置

先启动本地代理，再临时覆盖验收进程变量，无需修改已有 `.env`：

```sh
node scripts/platform-acceptance/fault-proxy.mjs --discord-gateway true --port 18090 --control-port 18091
DISCORD_GATEWAY_FAULT_PROXY_URL=ws://127.0.0.1:18090/ pnpm --filter platform-acceptance-bot dev:discord
```

代理仅允许官方 Discord Gateway 主机，覆盖初次连接与区域 Resume，保留上游 TLS 校验。控制端口的 POST `/cut`、POST `/recover` 用于切断及恢复；GET `/status` 查看连接数。REST 出站保持直连，这轮不能证明出站网络故障恢复。该入口仅用于本地验收，正常运行留空。

### QQ WSS 故障验收临时配置

`QQ_STREAM_PROXY_PORT` 与 `QQ_STREAM_PROXY_SERVER_NAME` 必须同时配置，仅限 `QQ_MODE=websocket`。变量由启动命令覆盖，不修改已有 `.env`：

```sh
QQ_MODE=websocket QQ_STREAM_PROXY_PORT=18510 QQ_STREAM_PROXY_SERVER_NAME=实际网关主机 pnpm --filter platform-acceptance-bot dev:qq
```

先按安全主机诊断建立固定上游透明 TCP 代理，再执行 cut/recover。SDK 每次动态查询网关；主机改变时拒绝连接，须更新固定上游，不能绕过代理。原 Host、SNI、证书校验保留；认证、网关发现和出站 API/上传仍直连。本轮 WSS 恢复证明不覆盖出站 API 故障。

### Slack 出站 API 单独故障验收

使用上述仓库 TCP 透明代理，上游固定 `slack.com:443`，监听 `18560`、control `18561`。以 `SLACK_WEB_API_PROXY_PORT=18560 pnpm --filter platform-acceptance-bot dev:slack` 临时启动，不改 `.env`。默认未设置时仍直连。此变量与 `SLACK_STREAM_PROXY_PORT` 分开；不要同时切两个代理，否则无法区分出站API和入站WSS。

先 forwarding 下新样本基线；cut 后新样本出站必须失败/unknown，恢复不能补发旧样本；recover 后再次新样本必须得到真实回执和平台可见回复。每步保留独立sample ID并生成报告。API auth.test启动也经此代理，所以必须先forwarding再启动。SocketModeClient独立连接发现/WebSocket不经过该Web API agent。本模式仅JSON API，媒体上传域名会显式拒绝，不用于image/file验收。

### Discord 出站 REST 故障验收

独立透明代理18570/control18571，上游固定discord.com:443；以 `DISCORD_REST_API_PROXY_PORT=18570 pnpm --filter platform-acceptance-bot dev:discord` 临时覆盖启动，不改.env。先forwarding启动并确认新sample；cut时只切REST，观察新sample失败unknown、没有后台重发；recover后旧sample不能补发，新sample应得到真实消息与回执。Gateway的discovery API也经过此代理，故启动前必须forwarding；WebSocket本身独立。只适用于Gateway模式JSON消息，CDN/Interactions不计此路径通过。
