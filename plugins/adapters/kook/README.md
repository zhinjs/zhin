# @zhin.js/adapter-kook

Zhin.js KOOK（开黑啦）适配器（Plugin Runtime），默认通过 **WebSocket Gateway**（`kook-client`）收发消息；可选 **Webhook** 模式经 `httpHostToken` 接收平台 POST 推送。

## 功能

- WebSocket Gateway 入站（默认；无需公网 HTTPS / host）
- Webhook 入站（`connection: webhook` + `httpHostToken` + `verify_token`）
- 解析频道与私聊文本消息
- 出站 `send({ conversation, payload })` → KOOK KMarkdown（`kind: 'channel' | 'private'`）
- canonical `markdown` 段原生保留为 [KMarkdown](https://developer.kookapp.cn/doc/kmarkdown-desc)
- 约定式 `defineAdapter` / `definePlugin`（无需 `usePlugin`）

## 安装

```bash
pnpm add @zhin.js/adapter-kook
```

## Plugin Runtime

- `@zhin.js/adapter` — 约定式 `adapters/kook/index.ts`（`defineAdapter`）
- `@zhin.js/core` — `Endpoint.emit(...)` 入站、`outboundMessageToken` 出站
- `@zhin.js/host-http` — Webhook 模式 POST 路由（WebSocket 不需要）
- `zhin.js` — `plugin.ts`（`definePlugin`）
- 配置经插件 `schema.json` 落到 `plugins.<instanceKey>`
- **WebSocket 路径无需** `@zhin.js/host-http` / `@zhin.js/host-router`

入站：`gateway.receive({ conversation, message, content, sender, metadata })`（ConversationRef：`channel` 频道消息带 guild `parent`，`private` 私聊）  
出站：`send({ conversation, payload })` → `sendChannelMsg` / `sendPrivateMsg`

## 前置条件

| 要求 | 说明 |
|------|------|
| **Bot Token** | 在 [KOOK 开发者平台](https://developer.kookapp.cn/) 创建应用并获取 |
| **邀请入服** | 将机器人邀请到目标服务器，并授予查看频道、发送消息等权限 |
| **WebSocket（默认）** | `kook-client` 正向连接；无需公网 URL |
| **Webhook** | 需公网 HTTPS + Host `httpHostToken`；与 WebSocket 互斥 |
| **host-http** | 仅 Webhook 模式需要 |

必填字段（`endpoints[i]`）：`id`、`token`。

## 最小配置

```yaml
# zhin.config.yml（Plugin Runtime）
plugins:
  kook:
    # connection: websocket   # 默认
    endpoints:
      - id: my-kook-bot
        token: ${KOOK_TOKEN}
```

根插件 `zhin.plugins`（或项目图）需引用 `@zhin.js/adapter-kook`（`instanceKey: kook`）。

## 环境变量

| 变量 | 说明 |
|------|------|
| `KOOK_TOKEN` | YAML 示例中 `token` 引用的 Bot Token |
| `KOOK_VERIFY_TOKEN` | YAML 中 `verify_token` 引用的 Webhook 验证令牌 |
| `KOOK_ENCRYPT_KEY` | YAML 中可选 `encrypt_key` 引用的消息加密密钥 |

## Webhook

在 KOOK 开发者后台选择 **WebHook** 连接模式，Callback URL 指向 Host 暴露的公网地址（建议在 URL 加 `?compress=0` 便于调试）。

```yaml
plugins:
  kook:
    connection: webhook
    webhookPath: /kook/webhook
    endpoints:
      - id: my-kook-bot
        token: ${KOOK_TOKEN}
        verify_token: ${KOOK_VERIFY_TOKEN}
        # encrypt_key: ${KOOK_ENCRYPT_KEY}   # 启用消息加密时必填
```

Host 需注入 `httpHostToken`。Challenge（`type: 255`）会校验 `verify_token` 并回显 `challenge`；普通事件经 `gateway.receive` 入站，出站仍走 KOOK HTTP API。

## AI 工具（Skill）

| 类别 | 路径 |
|------|------|
| Permit 词汇 | `PERMITS.md` |
| 平台工具 | `tools/`（角色、黑名单等） |
| 技能说明 | `agents/kook/skills/kook/SKILL.md` |

## 平台权限（platform permit）

platform permit checker 由 `plugin.ts` 的 generation 生命周期注册；CapabilityIngress 与 ToolSystem 统一经 Core `canAccessTool()` 消费工具的 platform permit 声明。

## 迁移后出站能力变化

出站统一经 `outboundMessageToken` 渲染。canonical `markdown` 保留 KMarkdown；图片上传后以原生卡片保留图文混排；canonical `reply` 通过 SDK quote 参数传递。视频、音频和文件 URL 表示为链接，本地这些文件的上传尚未接线。

canonical `keyboard` 映射为原生 Card `action-group`，每行 1–4 个按钮，`click: return-val` 将 payload 原样返回。WebSocket 和 Webhook 的 `message_btn_click` 事件进入可靠的 canonical `action` 消息段，携带实际点击人、会话和 `sourceMessageId`。按钮显示成功不能算交互通过，必须实际点击并核对回调。disabled 和 command 模式按钮当前明确 `unsupported_operation`。官方合同：[卡片按钮](https://developer.kookapp.cn/doc/cardmessage)、[按钮点击事件](https://developer.kookapp.cn/doc/event/user)。

canonical `share` 映射为含标题、描述/正文与“打开链接”按钮的 Card；只支持 HTTP(S) URL，不代表平台原生应用/音乐名片。share 的 image/audio/app metadata 尚未接线，明确拒绝。实机分享验收需核对标题、描述与点击后的目标 URL。

## 故障排查

| 现象 | 排查 |
| --- | --- |
| WebSocket 无法上线 | 检查 Bot Token、网络与机器人能力开关 |
| Webhook challenge 失败 | 检查公网路径、`verify_token` 与 HTTP Host |
| 频道消息未触发 | 检查应用订阅、频道权限与机器人是否已加入服务器 |
| 附件表现为链接 | 当前统一出站不上传附件；使用远程 URL 或按能力降级 |

## 许可证

MIT License

### 图片与引用

canonical reply 使用原生 `quote`，关联原消息 ID。canonical 图片（URL、本地路径、base64）先上传到 KOOK asset 接口，再用原生卡片发送；图片与文本混排按原顺序保留。上传失败不会用文字代替并确认成功，缺失真实消息 ID 为 unknown。文件/音视频暂仅支持既有 URL 链接，二进制上传会明确拒绝。

撤回通过 canonical control 的完整 MessageRef 区分频道与私聊，并调用对应正式删除接口。transport 未实现删除或平台返回 false 时明确失败，不允许静默成功；直接调用 `recallMessage` 须同时传入 ConversationRef。
# WSS 可控故障验收

`kook-client@1.0.5` 已在上游提供可选 `socketFactory`、`autoReconnect` 与 `handleProcessErrors`，无需本地 pnpm 补丁。Zhin 显式设置 `handleProcessErrors: false`，让框架管理进程错误，不扫描或删除其他全局监听。Zhin 关闭 SDK 内部重连/DNS 监视，由统一 Endpoint lifecycle 负责 start/stop/reconnect，SDK 保留协议心跳和事件转换。停止会取消 pending hello，迟到 discovery 不会再建连接。

可选 `streamProxy: { port: 18443, serverName: "实际网关域名" }` 仅改 TCP 路由到 `127.0.0.1`，真实 WSS URL、Host、SNI 和证书链/域名校验保留；网关变化拒绝并只记录安全 hostname，不输出私有 URL/query 或回退直连。验收项目支持 `KOOK_STREAM_PROXY_PORT` / `KOOK_STREAM_PROXY_SERVER_NAME` 临时进程覆盖，需同时提供，留空正常直连。先以占位域名获取安全日志中的实际 gateway hostname，随后启动固定上游 `tcp-fault-proxy.mjs --upstream-host 实际网关域名 --upstream-port 443 --port 18443 --control-port 18444` 并同步 serverName，不覆盖已有 `.env`。

正常入站后 POST `/cut`，观察 SDK断线和 lifecycle离开 open；POST `/recover` 后等待新连接 open，再发送唯一新 probe确认真实入站及可见回包。切断仅 WSS；HTTP discovery/出站仍直连，不能据此证明所有网络恢复、离线事件无损或发送重试。停止代理并移除临时覆盖后恢复常规运行。本地实际SDK/TLS回归与平台实机证据分开记录。

受控重连使用原会话 URL、已处理 SN 与 session_id 恢复。收到 Resume ACK 前缓存离线事件；确认后依 SN 连续顺序派发，重复事件不再次进入业务链。服务器要求新会话时清除旧 SN 和未派发数据，重新发现网关并初始化缓存。已初始化会话恢复成功时复用路由缓存，避免重复加载成员；停止会取消 Hello/Resume 等待和后续重连。上述本地 TLS 回归不替代真实平台 cut/recover 验收。

### 出站 HTTP 结果

HTTP 408 与所有 5xx 保持 unknown，即使正文包含拒绝码也不认定明确未发送；其他 4xx 和成功 HTTP 响应中的非零平台 code 为 rejected。Runtime 在 Axios 正式 transformResponse 阶段保留 HTTP 状态语义，避免 SDK 错误转换丢掉状态。真实已安装 SDK + loopback HTTP fixture 验证单次 POST、不自动重发。Stream 故障代理不影响出站 API；API 专用测试需另行配置 Axios httpsAgent 固定 loopback 转发，并保持实际域名/SNI/证书校验，当前验收配置尚未暴露。

### JSON API 故障验收代理

可选 `apiProxy: { port: 18580 }` 使用 SDK Axios 实例正式 `httpsAgent` 扩展，仅将 `www.kookapp.cn:443` 的 TCP 路由到 `127.0.0.1`；原 Host、SNI、证书链及域名验证保留，拒绝其他目标和重定向，无自动直连回退。默认关闭。它与 `streamProxy` 独立，覆盖 SDK JSON API（含网关查询、初始化、消息发送/撤回），不覆盖适配器的 fetch 图片上传及外部媒体下载。Axios 正式 agent 配置见 https://axios-http.com/docs/req_config 。

启动固定上游代理：`node scripts/platform-acceptance/tcp-fault-proxy.mjs --upstream-host www.kookapp.cn --upstream-port 443 --port 18580 --control-port 18581`。验收项目可用 `KOOK_API_PROXY_PORT=18580 pnpm --filter platform-acceptance-bot dev:kook` 临时覆盖；不改 `.env`。POST 已提交后断线只能记 unknown，不自动重发；恢复后使用新探针样本。
