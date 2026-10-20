# 受控测试实例的切断 / 恢复工具

`fault-proxy.mjs` 是一个只监听 `127.0.0.1` 的 HTTP / WebSocket 转发器。它仅切断经过本代理的测试连接，不关闭整机网络、不改 DNS、系统代理或生产配置。工具不读取 `.env`，不保存流量，不打印上游地址、请求路径、Token、消息或错误正文；控制接口只返回状态与计数。

`POST /cut` 会销毁代理拥有的客户端及上游 socket，并拒绝新连接。`POST /recover` 只重新接受新连接，不复活旧请求、重发消息或代替适配器重连。控制端口在切断期间仍然可用。

## Telegram Polling

先停止同一个测试 Bot 的其他 Polling 进程；本工具不替你启动或停止真实 Bot。仓库根目录打开一个专用终端：

```sh
node scripts/platform-acceptance/fault-proxy.mjs \
  --upstream https://api.telegram.org --port 18200 --control-port 18201
```

输出只含本地转发入口、控制入口和计数。在另一终端，以启动时环境变量覆盖现有验收 example，不需要改 `.env`：

```sh
TELEGRAM_API_BASE_URL=http://127.0.0.1:18200 \
  pnpm --filter platform-acceptance-bot dev:telegram
```

如果使用自己的隔离测试项目，只修改那个测试 endpoint 的 `apiBaseUrl` 为 `http://127.0.0.1:18200`，保留原 Token 环境变量引用。API 与文件下载路径/query 原样转发，代理上游仍使用 HTTPS 并正常校验证书。

从白名单测试会话发送一个新的探针，确认真实回复可见后执行：

```sh
curl --fail --silent http://127.0.0.1:18201/status
curl --fail --silent -X POST http://127.0.0.1:18201/cut
# 保持切断至少一个轮询重试周期，观察测试端点变为离线/重连中。
curl --fail --silent -X POST http://127.0.0.1:18201/recover
```

恢复后发送不同 sample ID 的新探针，并记录恢复到第一次确认回复的时间。切断时已经发出的发送请求可能已被 Telegram 接受，送达结果应保持 unknown；不要用相同探针重发来推断恢复。通过 Telegram 端的实际可见消息核对重复或未知发送。

双账号需要独立控制时，为账号 B 启动第二个代理，例如转发端口 `18202`、控制端口 `18203`，并在启动命令中加 `TELEGRAM_B_API_BASE_URL=http://127.0.0.1:18202`。未设置 B 入口时，B 仍直连官方 API；两个账号都指向同一个代理时，切断会影响两者。

## NapCat / OneBot11 前向 WS

代理固定上游只能是 origin，不能包含账号凭据、路径或 query。例如桥地址为 `ws://127.0.0.1:3001/onebot?client=test`：

```sh
node scripts/platform-acceptance/fault-proxy.mjs \
  --upstream ws://127.0.0.1:3001 --port 18200 --control-port 18201
```

在专用验收实例启动时保留桥的路径/query，替换 origin：

```sh
NAPCAT_WS_URL='ws://127.0.0.1:18200/onebot?client=test' \
  pnpm --filter platform-acceptance-bot dev:napcat
# OneBot11 对应 ONEBOT11_WS_URL 与 dev:onebot11。
```

桥使用根路径时直接指定 `ws://127.0.0.1:18200`。鉴权继续使用测试实例已有的 `NAPCAT_ACCESS_TOKEN` / `ONEBOT11_ACCESS_TOKEN` 配置，不把凭据加入命令行。上游为 `wss://` 时代理正常校验 TLS，测试实例到本机代理使用 `ws://`。HTTP POST、Upgrade headers、路径/query、文本和二进制 WS 帧均透明转发，代理不伪造平台消息或回执。

先取得真实平台 baseline，再执行相同的 cut/recover 控制。既有 WS 必须关闭；恢复后观察适配器自行建立新连接，并从真实白名单会话发新探针验证入站与出站。代理的 `forwarding` 仅表示允许转发，不能当作平台已恢复。

## 证据与结束操作

按原有 [完整场景协议](./README.md#full-controlled-scenario-protocol) 使用 `record.mjs` 记录 `network-recovery` begin/end，并保留真实探针结果与接收者可见证据。状态接口可以单独保存为无凭据的本地证据文件：

```sh
umask 077
curl --fail --silent http://127.0.0.1:18201/status > /absolute/private/proxy-cut-status.json
```

该文件只证明代理当前状态；它不能代替真实平台收发或恢复证据。先停止测试 runtime，再在代理终端按 Ctrl+C，工具会等待自己拥有的 socket 关闭。下一次普通验收启动不设置代理环境覆盖即可恢复默认入口。

## 边界

- 两个端口固定绑定 loopback；任何能访问本机控制端口的进程都能控制这个测试代理，不应把它用于生产实例。
- DNS 和上游 TLS 在代理进程中执行，保留系统默认校验；不修改证书、hosts 或真实平台域名。若直连 baseline 失败，先检查网络/DNS/证书，不能把它算成受控切断恢复成功。
- QQ 官方 SDK 使用固定 API 域名以及运行时返回的动态 WSS gateway，当前没有 `apiBaseUrl` 配置可以统一引入本代理。只转发 API 不能证明 gateway 断线恢复。本轮不提供 QQ 实机入口；`qq-network-fixture.mjs` 是本地假平台重定向，不能用于冒充真实 QQ 故障验收。
- Telegram Webhook 的外部入站、反向 WS、飞书/钉钉动态长连接入口也不由上述步骤控制，需要另设专用反向转发/进程级代理；不得关闭整机网络作为替代。
- 工具只模拟连接被强制切断，未覆盖丢包、带宽限制、DNS 故障或半开连接。自动回归只证明本地 HTTP/WS 的切断和恢复，真实账号恢复仍须实机探针验证。

本地回归：

```sh
pnpm exec vitest run tests/platform-acceptance/fault-proxy.test.ts
```


### Discord Gateway（REST 独立）

启动专用 Gateway 模式：

```sh
node scripts/platform-acceptance/fault-proxy.mjs --discord-gateway true --port 18090 --control-port 18091
```

在**测试 endpoint**配置 `gatewayFaultProxyUrl: ws://127.0.0.1:18090/`，或通过示例已经映射的
启动时环境变量覆盖该字段；无需编辑真实 `.env`。REST 路径不经过此代理。按前文控制接口
`POST /cut` / `POST /recover` 操作，只影响这一个测试实例经过的 Gateway sockets。

```sh
DISCORD_GATEWAY_FAULT_PROXY_URL=ws://127.0.0.1:18090/ pnpm --filter platform-acceptance-bot dev:discord
```

SDK 初始和恢复连接分别携带公开 Gateway hostname 到本地专用路由。代理仅允许
`gateway.discord.gg` / `gateway-*.discord.gg`，上游强制 WSS 443、根路径，仍使用 Node 默认
TLS 证书及 hostname 校验。不使用系统 DNS/proxy 修改，不关闭 TLS 校验，不记录 Token、
消息或原始 URL。普通 HTTP 请求和任意目的地址在转发前拒绝。区域 Resume hostname
同样经过代理，不能只切初始 Gateway 后让恢复绕过故障工具。

正式 `buildStrategy` 与真实已装 SDK 的本地初连/Resume 回归已经验证；只有真实客户端
断线、恢复后的新消息与按钮回调证据，才能作为 Discord 平台恢复通过。

## Slack / Discord / KOOK / 飞书 API 出站

这些入口使用专用透明 TCP 代理，保留官方 URL、Host、SNI 与证书校验，默认不启用。
它们与消息接收的长连接代理独立。只对专用测试实例使用启动覆盖，不编辑 `.env`。

| 平台 | 固定上游（443） | 转发 / 控制端口示例 | 启动覆盖变量 |
| --- | --- | --- | --- |
| Slack | slack.com | 18560 / 18561 | SLACK_WEB_API_PROXY_PORT |
| Discord | discord.com | 18570 / 18571 | DISCORD_REST_API_PROXY_PORT |
| KOOK | www.kookapp.cn | 18580 / 18581 | KOOK_API_PROXY_PORT |
| 飞书 | open.feishu.cn | 18590 / 18591 | LARK_WEB_API_PROXY_PORT |

以 Discord 为例，先确认端口空闲，启动代理：

```sh
node scripts/platform-acceptance/tcp-fault-proxy.mjs \
  --upstream-host discord.com --upstream-port 443 --port 18570 --control-port 18571
```

在另一个终端停止同账号的旧专用测试实例后启动：

```sh
DISCORD_REST_API_PROXY_PORT=18570 pnpm --filter platform-acceptance-bot dev:discord
```

其他平台用表内固定上游、端口、变量及对应 `dev:slack` / `dev:kook` / `dev:lark`。
代理必须先处于 forwarding：Discord Gateway 地址发现、KOOK gateway/preload 与飞书访问令牌获取也会使用该 API 入口。
Discord 此入口只支持 Gateway 模式；KOOK 仅代理 SDK JSON API，媒体上传及源下载仍直连。
Slack SocketMode SDK 的连接发现与 WSS 不经过此出站入口。

先从白名单会话发送新探针并确认客户端真实回复，再执行：

```sh
curl --fail --silent -X POST http://127.0.0.1:18571/cut
# 发一个不同 sample 的白名单探针，确认入站仍正常且出站保持 unknown。
curl --fail --silent -X POST http://127.0.0.1:18571/recover
# 确认旧样本没有自动补发，再发新的 sample，核对客户端只出现一次回复。
```

不得将连接拒断等同于平台已经收到完整 POST 后丢失响应；后者目前由本地 TLS fixture 覆盖。
四平台本地代理回归已通过，实机 API 连接切断/恢复目前 Slack、KOOK 与 Discord 有独立证据。
真实状态以 [当前实机验收](../../examples/platform-acceptance-bot/CURRENT-ACCEPTANCE.md) 为准。

### 2026-10-08 飞书 OpenAPI 断网与恢复

专用 TLS 代理 18590/control 18591 的三阶段真实探针，均由 PID 43854/generation 1 处理：基线 `larkapibase0001` confirmed（用户确认客户端仅一次）；切断新连接后的 `larkapicut0001` unknown；恢复后的新探针 `larkapiafter0001` confirmed。账本每个样本各一条 attempt 和 result，当前无旧样本重投。代理已恢复 forwarding，服务继续运行。用户已确认收到恢复后的 `acceptance:lark-a:larkapiafter0001` 且只有一次；旧断网消息是否补发仍待客户端核对，不能据此声明完整客户端验收通过。证据：`.acceptance/lark/evidence/20261008-api-ledger.json`。此项只覆盖 API 新连接切断，不覆盖平台已接受完整 POST 后丢失响应；未修改用户 `.env`。
