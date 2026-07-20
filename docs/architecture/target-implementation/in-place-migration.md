# Plugin Runtime 原位迁移

`packages/next` 曾是目标架构的实现孵化区，不是产品分层。正式化迁移已经采用
**replace-in-place** 完成：代码进入明确 ownership 包，全部 `@zhin.js/next-*` package、
`packages/next` 目录和 Compat Runtime 均已删除。

机器可读迁移档案是 [migration-topology.json](./migration-topology.json)。`pending` 必须为空；
`completed` 和 `removed` 分别记录正式归属与明确删除项，不作为继续支持旧包名的依据。

## 迁移原则

1. **一个运行时权威**：新 RuntimeSnapshot 是权威；旧 Feature registry 只通过兼容
   Adapter 投影，不能双写。
2. **按依赖方向搬运**：Kernel → Feature Kit → Core → Agent → Console → Root/CLI。
3. **先归位再切流量**：每批先移动源码和测试，再切 workspace consumer，最后删除源包。
4. **迁移不进入运行时**：`addCommand`、`addComponent` 等旧接口由 CLI 和迁移 Skill 改写；
   Root lifecycle、discovery、generation 与 HMR 不保留两套实现。
5. **生产入口只指向 JS**：开发条件可直读 TypeScript，发布 manifest 必须指向 `lib/*.js`。

## 最终 Ownership

| 模块 | 最终归属 |
|---|---|
| Plugin tree、Scope、Slot、Snapshot、RootController | `@zhin.js/plugin-runtime` |
| 第三方 Feature provider interface | `@zhin.js/feature-kit` |
| Adapter、Command、Component、Middleware provider | `@zhin.js/adapter`、`command`、`component`、`middleware` |
| IM Runtime | `@zhin.js/core/runtime` |
| Tool、Skill、Agent、MCP provider | `@zhin.js/tool`、`skill`、`agent-feature`、`mcp-feature` |
| Agent Runtime | `@zhin.js/agent/runtime` |
| Page/Layout wire definition | `@zhin.js/contract` |
| Console catalog、navigation、client build | `@zhin.js/pagemanager` |
| Root、配置、发现与 HMR | `@zhin.js/runtime`（`zhin.js/runtime` facade） |
| 最小 HTTP/WebSocket Host（Plugin Runtime） | `@zhin.js/host-http` |
| YAML 保真配置文档 | `@zhin.js/config-yaml` |
| Worker/process 隔离 | `@zhin.js/isolate` |
| start、migrate、scaffold | `@zhin.js/cli` |

## 当前进度

- 已完成：Plugin Runtime、Feature Kit、IM/Agent/Console 领域 Feature、Core/Agent/Console
  Runtime、Root Runtime、YAML Config、Isolate 与 CLI 原位归属。
- 已删除：Compat Runtime。旧 callback/registry 只由 CLI 与
  `.github/skills/migrate-zhin-plugin-runtime` 迁移，不进入生产依赖闭包。
- 已迁移：Stable `examples/minimal-bot` 由正式 Root + ImRuntime 启动，使用 Terminal Adapter、
  Command 与 Component 约定目录；`check:stable` 验证统一入站/出站链路。
- 已迁移：`@zhin.js/host-http` 为 Root 提供 `httpHostToken`（最小 HTTP/WS，无 Koa）；`zhin runtime start`
  在 generation handoff 时 listen，供 Adapter 通过 `context.use(httpHostToken)` 注册 `/sandbox` 等路径。
- 已迁移：`@zhin.js/adapter-sandbox` 改为约定式 `defineAdapter`（`adapters/sandbox.ts` + `plugin.ts`），
  WebSocket 入站经 `messageGatewayToken`，出站按 `target` 多路复用连接；`tests/sandbox-runtime.test.ts`
  覆盖 WS 功能闭环。旧 `segment-mapper.ts`（对 legacy `zhin.js` 的 `to/fromCanonicalSegments`
  re-export）有意删除：canonicalization 由 gateway/core 渲染链在 `endpoint.send` 前完成，
  适配器只做 wire JSON 封装。
- 已迁移：`@zhin.js/adapter-email` 改为约定式 `defineAdapter`（`adapters/email.ts` + `plugin.ts`），
  IMAP 轮询入站经 `messageGatewayToken`，SMTP 出站按 `send({ target, payload })`；无 host-http；
  `tests/email-runtime.test.ts` 用 mock SMTP/IMAP 覆盖生命周期与收发。旧 `usePlugin` /
  `extends Adapter` / `segment-mapper` 入口已删除。
- 已迁移（slice 1）：`@zhin.js/adapter-satori` 改为约定式 `defineAdapter`（`adapters/satori.ts` +
  `plugin.ts`），**WebSocket 正向客户端**入站经 `messageGatewayToken`，出站 `send({ target, payload })`
  → Satori `message.create`；无 host-http。Webhook（`connection: webhook`）slice 1 曾延期；
  后续已基于 `httpHostToken` POST 路由完成实现并有测试。`tests/satori-runtime.test.ts` 用 mock WS
  覆盖生命周期与收发。旧 `usePlugin` / `extends Adapter` / `segment-mapper` 入口已删除。
- 已迁移（slice 1）：`@zhin.js/adapter-onebot12` 改为约定式 `defineAdapter`（`adapters/onebot12.ts` +
  `plugin.ts`），优先正向 WS 客户端（`connection: ws`）：入站经 `messageGatewayToken`，出站
  `send({ target, payload })` → WS `send_message`；协议纯函数落在 `src/protocol.ts`。Webhook /
  反向 WSS 需 `httpHostToken`，slice 1 在 `create` 中曾明确推迟，不阻塞 cutover；后续两者均已
  实现并有测试。旧 `usePlugin` / `extends Adapter` / `segment-mapper` 生产入口已删除。
  `tests/onebot12-runtime.test.ts` 用 mock WS 覆盖生命周期与收发。
- 已迁移（slice 1）：`@zhin.js/adapter-onebot11` 改为约定式 `defineAdapter`（`adapters/onebot11.ts` +
  `plugin.ts`），优先正向 WS 客户端（`connection: ws`）：入站经 `messageGatewayToken`，出站
  `send({ target, payload })` → WS `send_private_msg` / `send_group_msg`；协议纯函数落在
  `src/protocol.ts`。反向 WSS 需 `httpHostToken`，slice 1 在 `create` 中曾明确推迟；后续已实现
  （`src/wss-endpoint.ts` 的 `OneBot11WssEndpoint`）并有测试；旧
  `usePlugin` / `extends Adapter` / Endpoint 类 / `segment-mapper` 生产入口已删除；`agent/` 工具保留。
  `tests/onebot11-runtime.test.ts` 用 mock WS 覆盖生命周期与收发。
- 已迁移（slice 1）：`@zhin.js/adapter-milky` 改为约定式 `defineAdapter`（`adapters/milky.ts` +
  `plugin.ts`），优先正向 WS 客户端（`connection: ws`，事件 `/event` + HTTP API）：入站经
  `messageGatewayToken`，出站 `send({ target, payload })` → HTTP `send_*_message`；协议纯函数
  落在 `src/protocol.ts`。SSE / Webhook / 反向 WSS 需 `httpHostToken`，slice 1 在 `create`
  中曾明确推迟；后续三者均已实现并有测试；旧 `usePlugin` / `extends Adapter` / Endpoint 类 / `segment-mapper` /
  host-router 生产入口已删除；`agent/` 保留。`tests/milky-runtime.test.ts` 用 mock WS 覆盖
  生命周期与收发。
- 已迁移（slice 1）：`@zhin.js/adapter-napcat` 改为约定式 `defineAdapter`（`adapters/napcat.ts` +
  `plugin.ts`），优先正向 WS 客户端（`connection: ws`）：入站经 `messageGatewayToken`（去重 +
  自发过滤），出站 `send({ target, payload })` → WS `send_private_msg` / `send_group_msg`；
  协议纯函数落在 `src/protocol.ts`。反向 WSS / HTTP 均已通过 `httpHostToken` 接线；旧 `usePlugin` / `extends Adapter` / Endpoint 类 / `segment-mapper` /
  host-router / Console client 生产入口已删除；`agent/` 工具保留。
  `tests/napcat-runtime.test.ts` 用 mock WS 覆盖生命周期与收发。
- 已迁移：`@zhin.js/adapter-wechat-mp` 改为约定式 `defineAdapter`（`adapters/wechat-mp.ts` +
  `plugin.ts`），HTTP Webhook 经 `httpHostToken` 注册 GET 验签 + POST 消息；入站
  `messageGatewayToken`，出站 `send({ target, payload })`（默认被动 XML / 可选客服 API）；
  协议/XML/crypto 落在 `src/protocol.ts`。`tests/wechat-mp-runtime.test.ts` 用 `createHttpHost`
  覆盖验签与收发。旧 `usePlugin` / `extends Adapter` / host-router 生产入口已删除。
- 已迁移：`@zhin.js/adapter-weixin-ilink` 改为约定式 `defineAdapter`（`adapters/weixin-ilink.ts` +
  `plugin.ts`），长轮询 `getupdates` 入站经 `messageGatewayToken`，出站
  `send({ target, payload })` → iLink text/media；无 host-http / host-router（Console
  loginAssist 延期）。协议/配置落在 `src/protocol.ts`，凭证与 CDN/媒体 helper 保留。
  `tests/weixin-ilink-runtime.test.ts` 用 mock notify/poll/send 覆盖生命周期与收发。
  旧 `usePlugin` / `extends Adapter` / Endpoint / routes 生产入口已删除。
- 已迁移：`@zhin.js/adapter-line` 改为约定式 `defineAdapter`（`adapters/line.ts` + `plugin.ts`），
  HTTP Webhook 经 `httpHostToken` 注册 POST（HMAC-SHA256 签名）；入站 `messageGatewayToken`，
  出站 `send({ target, payload })` → Reply API（缓存 replyToken）或 Push API；协议/签名/
  wire 落在 `src/protocol.ts`。`tests/line-runtime.test.ts` 用 `createHttpHost` 覆盖验签与收发。
  旧 `usePlugin` / `extends Adapter` / Endpoint / `segment-mapper` / host-router 生产入口已删除；
  `agent/` 工具保留。
- 已迁移：`@zhin.js/adapter-wecom` 改为约定式 `defineAdapter`（`adapters/wecom.ts` + `plugin.ts`），
  HTTP Webhook 经 `httpHostToken` 注册 GET 验签解密 + POST 消息（AES）；入站
  `messageGatewayToken`，出站 `send({ target, payload })` → `message/send`；协议/crypto/XML
  落在 `src/protocol.ts`。`tests/wecom-runtime.test.ts` 用 `createHttpHost` 覆盖验签与收发。
  旧 `usePlugin` / `extends Adapter` / Endpoint / `segment-mapper` / host-router 生产入口已删除；
  `agent/` 工具保留。
- 已迁移：`@zhin.js/adapter-dingtalk` 改为约定式 `defineAdapter`（`adapters/dingtalk.ts` +
  `plugin.ts`），HTTP Webhook 经 `httpHostToken` 注册 POST（HMAC-SHA256 签名）；入站
  `messageGatewayToken`，出站 `send({ target, payload })` → sessionWebhook 或 `/robot/send`；
  协议/签名/wire 落在 `src/protocol.ts`。`tests/dingtalk-runtime.test.ts` 用 `createHttpHost`
  覆盖验签与收发。旧 `usePlugin` / `extends Adapter` / Endpoint / `segment-mapper` /
  host-router 生产入口已删除；`agent/` 工具保留。
- 已迁移：`@zhin.js/adapter-lark` 改为约定式 `defineAdapter`（`adapters/lark.ts` + `plugin.ts`），
  HTTP Webhook 经 `httpHostToken` 注册 POST（可选 verificationToken / encryptKey 签名 +
  `url_verification`）；入站 `messageGatewayToken`，出站 `send({ target, payload })` →
  `im/v1/messages`；协议/签名/wire 落在 `src/protocol.ts`。`tests/lark-runtime.test.ts` 用
  `createHttpHost` 覆盖验签与收发。旧 `usePlugin` / `extends Adapter` / Endpoint /
  `segment-mapper` / host-router / axios 生产入口已删除；`agent/` 工具保留。
- 已迁移（slice 1）：`@zhin.js/adapter-telegram` 改为约定式 `defineAdapter`（`adapters/telegram.ts` +
  `plugin.ts`），优先长轮询 `getUpdates`（无 host）：入站 `messageGatewayToken`，出站
  `send({ target, payload })` → Bot API；协议/wire 落在 `src/protocol.ts`。Webhook
  （`polling: false`）已通过 `httpHostToken` 接线。
  `tests/telegram-runtime.test.ts` 用 mock fetch 覆盖生命周期与收发。旧 `usePlugin` /
  `extends Adapter` / Telegraf Endpoint / `segment-mapper` 生产入口已删除；`agent/` 工具保留。
- 已迁移（slice 1）：`@zhin.js/adapter-discord` 改为约定式 `defineAdapter`（`adapters/discord.ts` +
  `plugin.ts`），优先 Gateway WebSocket（discord.js，无 host）：入站 `messageGatewayToken`，
  出站 `send({ target, payload })` → channel.send；协议/wire 落在 `src/protocol.ts`。
  Interactions（`connection: interactions`）已通过 `httpHostToken` 接线。`tests/discord-runtime.test.ts` 用 mock Client 覆盖生命周期与收发。旧
  `usePlugin` / `extends Adapter` / Endpoint / `segment-mapper` / host-router 生产入口已删除；
  `agent/` 工具保留。
- 已迁移：`@zhin.js/adapter-slack` 改为约定式 `defineAdapter`（`adapters/slack.ts` + `plugin.ts`），
  **优先 Socket Mode**（默认，无 host）：入站 `messageGatewayToken`，出站
  `send({ target, payload })` → Web API；HTTP Events（`socketMode: false`）经 `httpHostToken`
  POST + 签名验证。协议/配置/验签落在 `src/protocol.ts`。`tests/slack-runtime.test.ts` 用
  mock Socket / `createHttpHost` 覆盖生命周期与收发。旧 `usePlugin` / `extends Adapter` /
  Endpoint / host-router 生产入口已删除；`agent/` 工具保留。
- 已迁移（slice 1）：`@zhin.js/adapter-kook` 改为约定式 `defineAdapter`（`adapters/kook.ts` +
  `plugin.ts`），优先 WebSocket Gateway（`kook-client`，无 host）：入站
  `messageGatewayToken`，出站 `send({ target, payload })` → `sendChannelMsg` /
  `sendPrivateMsg`（target 为 `channel:id` / `private:id`）；协议/wire 落在 `src/protocol.ts`。
  Webhook（`connection: webhook`）需 `httpHostToken`，slice 1 在 `create` 中曾明确推迟；后续已
  实现（POST 路由 + verify_token 校验）并有测试。
  `tests/kook-runtime.test.ts` 用 mock Client 覆盖生命周期与收发。旧 `usePlugin` /
  `extends Adapter` / Endpoint / `segment-mapper` / host-router / Console client 生产入口已删除；
  `agent/` 工具保留。
- 已迁移（slice 1）：`@zhin.js/adapter-qq` 改为约定式 `defineAdapter`（`adapters/qq.ts` +
  `plugin.ts`），优先 WebSocket Gateway（`qq-official-bot`，无 host）：入站
  `messageGatewayToken`，出站 `send({ target, payload })` → QQ API（target 为
  `private:` / `group:` / `channel:` / `direct:`）；协议/wire 落在 `src/protocol.ts`。
  Webhook / middleware（`mode: webhook|middleware`）需 `httpHostToken`，slice 1 在 `create`
  中曾明确推迟；后续两种模式均已实现（httpHostToken POST）并有测试。`tests/qq-runtime.test.ts` 用 mock Bot 覆盖生命周期与收发。旧
  `usePlugin` / `extends Adapter` / Endpoint / `segment-mapper` / host-router / Console
  client / bind-flow 生产入口已删除；`agent/` 工具保留。
- 已迁移：`@zhin.js/adapter-github` 改为约定式 `defineAdapter`（`adapters/github.ts` +
  `plugin.ts`），HTTP Webhook 经 `httpHostToken` 注册 POST（HMAC-SHA256
  `X-Hub-Signature-256`）；入站 `messageGatewayToken`，出站 `send({ target, payload })` →
  Issue/PR comment（target 为 `owner/repo/issues/N` / `pull/N`）；协议/验签/wire 落在
  `src/protocol.ts`。无 `webhook_secret` 时为 API-only（无入站）。跨平台订阅 fan-out 与
  OAuth DB 模型延期。`tests/github-runtime.test.ts` 用 `createHttpHost` 覆盖验签与收发。
  旧 `usePlugin` / `extends Adapter` / Endpoint / `segment-mapper` / host-router 生产入口
  已删除；`agent/` 工具保留。
- 已迁移：`@zhin.js/adapter-icqq` 改为约定式 `defineAdapter`（`adapters/icqq.ts` +
  `plugin.ts`），**IPC/RPC 守护进程客户端**（`@icqqjs/cli`，无 host）：入站
  `messageGatewayToken`，出站 `send({ target, payload })` → `send_*_msg`（target 为
  `private:` / `group:` / `temp:` / `channel:`）；协议/配置落在 `src/protocol.ts`。
  Console loginAssist / host-router 延期。`tests/icqq-runtime.test.ts` 用 mock IPC 覆盖
  生命周期与收发。旧 `usePlugin` / `extends Adapter` / Endpoint / `segment-mapper` /
  host-router / Console client 生产入口已删除；`agent/` 工具保留。
- 已迁移：Sandbox Console UI（ADR 0046）——`pages/sandbox.tsx` + `@zhin.js/page` Feature；
  `zhin runtime start` 装配 `ConsoleRuntime` + `ClientBuildModuleRuntime`，`host-http` 提供
  `/console`、`/console/api/pages`、`/assets/client/*` 与 page route shell（sandbox 页内置
  `/sandbox` WS 聊天壳）。旧 `client/` + `pageManager.addEntry` 路径不再是 Plugin Runtime
  生产入口。
- 已迁移（host 薄切片）：`@zhin.js/host-http` 增加 `GET /pub/health`、CORS、可选 Bearer
  `TokenRegistry`（`http.token` / `http.tokens`，ADR 0016 full/demo）、WS upgrade 鉴权
  （`Authorization` 或 `?token=`；demo 仅 `/sandbox`）。CLI `resolveHttpConfig` 已读取这些字段。
- 已迁移（host 薄切片续）：`GET /pub/openapi.json` 路由清单、`HttpHost.listRoutes()` /
  可选 `RouteMeta`、`readJsonBody()` JSON 体解析。仍无 Koa / host-api 管理面。
- 已迁移（host-api 落脚）：Plugin Runtime `POST /api/console/request`（`ping` /
  `entries:get` / `pages:list` / 只读 `config:get*`）+ `GET /api/events` SSE；demo scope
  HTTP/RPC 白名单（ADR 0016 子集）。CLI `installConsoleApi` 在 `zhin runtime start` 接线。
- 已迁移（host-api 续）：full scope `config:save-yaml` / `config:set` 写回项目配置文件
  （YAML/JSON）；Runtime Host 不热重载进程，回复提示需重启生效。demo scope 仍禁止写。
- **平台 Adapter 约定式迁移已齐**：`plugins/adapters/*`（除 `common`）均已 `defineAdapter`
  + `plugin.ts`（sandbox / email / satori / onebot11/12 / wechat-mp / weixin-ilink / line /
  wecom / telegram / discord / slack / dingtalk / lark / kook / qq / milky / napcat /
  github / icqq）。次级连接模式（反向 WSS / webhook / interactions / Milky sse）已多数
  经 `httpHostToken` 接线；见下文「Adapter 二级连接大扫除」。
- 已迁移：`@zhin.js/plugin-qrcode` 改为约定式 `definePlugin`（`plugin.ts` +
  `commands/[text:string].ts` / `commands/scan/[url:string].ts`，qualified 名为
  `qrcode` / `qrcode scan`）；纯函数落在 `src/qrcode-lib.ts`；旧中文命令名
  「二维码 / 扫码」改为英文路由；命令返回值经 `raw()` 包装为 image 段
  （裸段数组不是合法 `SendContent`）；`agent/tools` 保留；
  `tests/qrcode-runtime.test.ts` 覆盖定义与 segment 生成。
- 已迁移：`@zhin.js/plugin-60s` 改为约定式 `definePlugin`（name=`sixty-s`，因插件名须
  `/^[a-z][a-z0-9-]*$/`）；扁平 `tools/*.ts` + `defineAgentTool`（Runtime Tool Feature）；
  聊天命令落在 `commands/`；handler 收拢到 `src/handlers/`；`schema.json` 声明 `apiBase`，
  `setup` 写入 `ZHIN_60S_API`；旧配置键 `60s` → 实例名 `sixty-s`；删除 `plugin.yml`；
  `agent/tools` 改指向 `src/handlers`；`tests/sixty-s-runtime.test.ts` 覆盖 tool/command 品牌。
- 已迁移：`@zhin.js/plugin-repeater` 改为约定式 `definePlugin` +
  `middlewares/repeater.ts`（`defineMiddleware`）+ `commands/repeater-status.ts`；
  状态机落在 `src/engine.ts`。Runtime `Message` 字段为 `content` / `sender` / `target` /
  `metadata` / `$reply`（无 `$raw` / `$channel`）；群聊判定 best-effort 读
  `metadata.type|channelType`，缺省时用非空 `target`（可能误伤私聊，已在中间件注释）。
  `tests/repeater-runtime.test.ts` 覆盖阈值与同用户去重。
- 已迁移：`@zhin.js/plugin-short-url` 改为约定式 `definePlugin` +
  `commands/shorten/[url:string].ts` / `commands/expand/[url:string].ts`；纯函数留在
  `src/short-url-lib.ts`；旧中文「短链 / 展开」改为英文路由；`agent/tools` 保留；
  `tests/short-url-runtime.test.ts` 覆盖定义与 URL 校验。
- 已迁移：`@zhin.js/plugin-code-runner` 改为约定式 `definePlugin` +
  `commands/run/[language:string].ts`（code 从 `args` 取；约定式命令只支持
  单个动态**文件**参数，动态目录段不会被发现）；glot.io 执行逻辑留在
  `src/run-code.ts`；`agent/tools` 保留；`tests/code-runner-runtime.test.ts`
  覆盖品牌与不支持语言。
- 已迁移：`@zhin.js/plugin-link-poster` 改为约定式 `definePlugin` +
  `middlewares/link-poster.ts`（`defineMiddleware`）；海报 HTML / 平台解析留在 `src/`；
  Runtime `Message.content` 替代 legacy `$raw`；`tests/link-poster-runtime.test.ts`
  覆盖中间件品牌与海报 HTML。
- 已迁移：`@zhin.js/plugin-music` 改为约定式 `definePlugin` +
  `components/share-music.ts` + `tools/music-search.ts` / `tools/music-share.ts`
  （`defineAgentTool`）；搜索/详情纯函数落在 `src/music-lib.ts`；删除旧
  `usePlugin`/`addComponent`/`ZhinTool` 入口；`tests/music-runtime.test.ts` 覆盖品牌。
- 已迁移（slice-2）：`@zhin.js/plugin-lottery` — 约定式 `definePlugin` + `schema.json` +
  `commands/lottery*`；`setup` 优先 `databaseHostToken` / `outboundHostToken` /
  `scheduleHostToken`，无 Host 时回落 in-memory；`pushTargets` 经 OutboundHost 推送。
  破坏性收口：删除依赖 legacy Plugin 的 AI narrative/master 推送；确定性报告与
  Runtime OutboundHost 是唯一生产路径。
  `tests/lottery-runtime.test.ts` 覆盖内存态 today/history/pipeline。
- 已迁移（slice-2）：`@zhin.js/plugin-rss` — 约定式 `definePlugin` + `schema.json` +
  `commands/rss-*`；`setup` 优先 `databaseHostToken` / `outboundHostToken` /
  `scheduleHostToken`，无 Host 时回落 in-memory；频道键从 Runtime `Message` 提取；
  `rss-check` / `pollAllFeeds` 经 OutboundHost 推新条目。无剩余 Host 缺口。
  `tests/rss-runtime.test.ts` 覆盖 list/add/remove/check 内存路径。
- 已迁移（slice-2）：`@zhin.js/plugin-group-suite` — 约定式 `definePlugin` +
  `schema.json` + `commands/checkin|mypoints|rank` + `keyword-*` +
  `teach|teach-list|teach-regex|forget` + `stats|stats-week|stats-rank|mystats`；
  `middlewares/keyword-reply|teach-reply|stats-count`；签到/问答/统计纯逻辑落在
  `src/checkin-lib.ts` / `src/teach-lib.ts` / `src/stats-lib.ts`；`setup` 优先
  `databaseHostToken`，无 Host 时 in-memory；stats 暂用文本排行（`formatRankText`）。
  破坏性收口：side-event welcome/recall、AI daily-analysis 与 HTML 报表不属于
  新 `group-suite` 契约，对应无效 schema 字段已删除。`tests/group-suite-runtime.test.ts` 覆盖内存态
  checkin / teach / stats / keyword。
- 已迁移（slice 2→出站接通）：`@zhin.js/service-activity-feedback` 约定式
  `definePlugin` + `schema.json`；setup 经 `activityFeedbackAiBus` 订阅 AI 事件；
  有 `outboundHostToken` 时用 `createOutboundEndpointAccess`（send / reaction /
  recall），否则 noop。配套：`AdapterIndex.resolve` 匹配 live `EndpointInstance.name`
  （多账号 uin）、icqq `addReaction`/`recallMessage`、私聊 reaction→status message。
  `tests/activity-feedback-runtime.test.ts` + `executor.test.ts` 覆盖 bus / recall。
- 历史 slice 1：游戏插件 `dice-duel` / `blackjack` / `idiom-chain` /
  `tic-tac-toe` / `rps` / `guess-number` / `text-adventure` / `word-riddle`
  改为约定式 `definePlugin` + `commands/<cmd>/[action:string=].ts`；help 始终可用，
  当时非 help 动作在无 Runtime database 时明确报「尚未就绪」；引擎/会话纯模块保留；
  legacy `commands.ts` / `hub-register.ts`（interactive、text middleware、game hub、
  cron）尚未挂载；删除 `plugin.yml`；该中间状态已由下一 slice 完整替换。
- 已迁移（slice-2）：上述 8 个游戏插件 `setup()` 挂载 **in-memory** SessionService
 （`src/memory-db.ts` + `@zhin.js/game-kit` `createInMemoryGameDb` /
  `messageFromCommandInput` / `plainTextFromSendContent`）；约定式命令非 help 经
  `getGameServices()` + `runXxxCommand(Text)` 走 game-flow，不再报「尚未就绪」。
  需 Plugin 发盘/编辑的玩法（dice / rps / bj / ttt / chain / adv / riddle）在
  `plugin === null` 时走 **text-only** 路径，不调用 `Adapter.editMessage`。
  已接线：Runtime hub 注册、`@zhin.js/plugin-game-hub`、stale-session cron、
  guess-number 数字中间件、idiom/riddle 文本中间件、dice/rps/bj choice middleware、
  Sandbox action→text。交互盘：dice/rps/bj/ttt/adv choice middleware 已挂；
  余量按需（少数 legacy 编辑盘细节）。约定式命令按 qualified 名注册
  （`<instanceKey> <cmd>`，如 `/blackjack bj start`）；legacy 中文命令
  （`/21点`、`/猜数` 等）经各游戏 `middlewares/*-alias.ts`
  （`@zhin.js/game-kit` `defineGameCommandAliasMiddleware`）恢复，
  与 game-hub 帮助文案一致。`*-runtime.test.ts` 覆盖 help + start/bot。
- 已迁移：`@zhin.js/process-monitor` 改为约定式 `definePlugin` + `schema.json` +
  `commands/process-status` + `tools/process-status.ts`（`defineAgentTool`）；
  文件态重启检测落在 `src/monitor.ts`（module-level + `setup()` lifecycle）；
  旧 `usePlugin` / `tools/*.tool.md` 入口已删除；`tests/process-monitor-runtime.test.ts`
  覆盖品牌与状态文案。
- 已迁移（ttt/adv + games DB）：`ttt-choice` / `adv-choice` middleware；8 游戏
  `databaseHostToken` + `createHostGameDb`（无 token 仍内存）。
- 已迁移（Adapter 二级连接大扫除）：QQ webhook、Discord interactions、OneBot11/12
  reverse-wss（+12 webhook）、NapCat http/wss、Milky webhook/wss/sse、Satori webhook
  均经 `httpHostToken`（Milky sse 用 fetch `text/event-stream`，无 EventSource 依赖）。
- 已迁移（idiom/riddle 文本 + interactive 薄切片）：idiom-chain / word-riddle
  Runtime 文本中间件；dice/rps/bj choice middleware；Sandbox action→text。
- 已迁移（Adapter webhook 早批）：Telegram / KOOK webhook。
- 已迁移（游戏 hub / stale / guess 文本）：Runtime hub + game-hub 插件 + stale cron +
  guess-digit。
- 已迁移（lottery / Database / Outbound / Schedule Host）：见上文各 Host Resource 条。
- 已迁移（host-api 续 2）：`files:tree` / `files:read` / `files:save` + `env:*`（allowlist
  与 legacy Console 一致）；demo 只读。`schema:get` / `schema:get-all` 读
  `node_modules/<pkg>/schema.json`；`db:*` 已统一接入 DatabaseHost console port，覆盖
  info/tables/select/insert/update/delete/drop/KV 与 SQLite 集成测试。
- 已迁移（host-api 续 3→真接线）：`endpoint.*` 经 `ImRuntime` → `AdapterIndex.describe/resolve`
  （`zhin runtime start` 传入 `im`）；orchestration REST 动态
  `import('@zhin.js/agent').getOrchestrationRuntime()`（已 init 返回数据，否则 503）；
  `system:restart` full scope → `process.exit(51)`（CLI 守护进程约定）。
- 平台 Adapter / utils / services / games / process-monitor 的约定式 cutover 已齐
  （`plugins/**` 生产路径无 `usePlugin`）。机器可读档案
  [migration-topology.json](./migration-topology.json) 的 `pending` 为空。
- 已迁移（厨房水槽验证入口）：`examples/test-bot` 默认 `zhin runtime start`，
  **平台配置对齐** `zhin.config.legacy.yml` 可运行 endpoints：
  Sandbox + icqq×5 + slack + github + qq×2（含 `bots.l2cl.link` 代理）+ legacy 同款 games；
  `${ENV}` 由 runtime start load `.env` 后展开。冒烟：`plugins: 22`、无 `adapters_unconfigured`。
  本地约定已补：`/ping` `/mem` `/status` `/heap` `/send` `/zt`(卡片) `/weather`；
  **`gh *` 聊天子命令**已迁（含 `bind`/`unbind`/`whoami`：DatabaseHost `github_oauth_users` +
  GithubEndpoint 用户 token 解析）。
  **Agent Host**：顶层 `ai`；`ai:` / 私聊无前缀 → **`ZhinAgent.process`**
  （`composeZhinAgentRuntime` + synthetic core `Message` + 入站队列 + IM session）+
  CapabilityIngress tools/skills + `ai.mcpServers` + **SOUL/AGENTS/TOOLS bootstrap**；
  **`SubagentSystem` + `spawn_task`**（workspace `agents/*.agent.md` presets）+
  deferred meta（`discover` / `load_tool` / `load_skill`）；
  providers 对齐 legacy（缺凭据 soft-prune）；test-bot 有 `agents/*.agent.md`。
  **Speech Host**：顶层 `speech:` → pipeline seed + `voice_stt`/`voice_tts` 注入 Agent Host。
  厨房水槽 tools/commands：`weather`（wttr 实时）、`calculator`（安全算术、无 eval）、
  `dice` / `system_info` / `mem-debug` / `gc`；与命令共享 `lib/`。
  **Agent Host 辅**：入站 STT（`metadata.audio_url` / `[audio:url]`）；专家 `@agentName`
  指令注入 bootstrap（非完整 agent binding 切换）；activity-feedback 出站已通；
  **ADR 0009 DB 持久化**：`defineAiDatabaseModels` → DatabaseHost →
  `activateAiDatabaseStorage`（日志 `agent_host_persistence mode=database`）；
  **`registerAIHook` / `aiHookRuntimeBus`**（无 host Plugin 也可扇出）；
  **ScheduleJobEngine + `schedule_*`**（`data/schedule-jobs.json`，ready 日志 `schedule: on`）；
  **assistant profile + Event Ingress**（`assistant.enabled` → profile sync；
  `POST /api/assistant/events` / `GET /api/assistant/jobs`）；
  **collaboration Runtime 门闸**（peer/at/handback/dispatch + DB wire）；
  **bash** + Owner **`/approve`**（`data/owner-approve-always.json`；需插件 `master`/`owner`）。
  Adapter start：超时改为 **deferred**（不再 `stop()` 杀掉慢启动的 QQ/Slack/GitHub）。
- 配套修复：`ConfigComposer` 接受顶层 `http`/`database`/`ai`/`speech`/`log_level` +
  `allowUnionTypes`；`NodePackageResolver` example `workspace:*` 回退；
  `ensureTypeScriptSpecifierRemap`；schedule holiday JSON `with { type: 'json' }`；
  AdapterIndex soft-fail + live-name resolve + `pickCredential`；
  ConfigView `expandMissingAsEmpty`；HttpHost `EADDRINUSE` soft-skip。
- 完成定义：`rg '@zhin.js/next-|packages/next'` 只允许出现在历史 ADR，workspace 中不存在
  `packages/next`，Stable 示例直接由新 Root Runtime 启动（已满足）。

## 完成盘点（2026-07-20）

结构与官方行为迁移均已收口：

| 区域 | 状态 | 证据 |
|---|---|---|
| Agent Host | 完成 | DB / hook / schedule / assistant / collaboration / approval + MCP/A2A |
| Console Database | 完成 | info/tables/select/insert/update/delete/drop/KV，SQLite 与 RPC 测试 |
| full-bot | 完成 | `runtime start`、Feature/child manifest、Page、MCP/A2A 鉴权 smoke |
| Tool 权限 | 完成 | platform/scope/permission/hidden + Adapter checker 生命周期 |
| 官方示例 | 完成 | 全部使用 `zhin runtime start` 与 `package.json#zhin` |
| Plugin 发布契约 | 完成 | 原生 TS entry + files/schema/README/agent publish harness |
| 旧入口 | 完成 | `zhin dev/start` 不再出现在官方示例；迁移 Skill 为唯一迁移路径 |

仓库定义的四项完成度均为 **100%**。真实平台凭据验收与 npm promotion 归入发布操作清单。
