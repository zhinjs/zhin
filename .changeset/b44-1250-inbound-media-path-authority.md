---
"@zhin.js/adapter": patch
"@zhin.js/core": patch
"@zhin.js/agent": patch
"@zhin.js/adapter-weixin-ilink": patch
"@zhin.js/adapter-email": patch
"@zhin.js/adapter-icqq": patch
---

入站消息里的本机路径不再绕过文件策略被 Agent 读盘（#1250 第 44 批）。

- Agent 只读一种入站本机路径（`MediaRef kind: 'path'`，包括平台引用物化出的路径）：产出这条消息的端点在 specification 里声明了入站媒体目录（新增可选钩子 `inboundMedia: { roots() }`，`@zhin.js/adapter` 导出 `EndpointInboundMediaPort`、`endpointInboundMediaOf`、`endpointInboundMediaRoots`，`AdapterIndex.inboundMediaRoots`，`ImRuntime.inboundMediaRoots`），且解析符号链接和 `..` 后的真实路径落在目录内；即使在目录内，仍要通过文件策略的敏感检查（`.zhin/`、`.env*`、密钥、数据库等）。可信入口把目录写进 `TurnInput.inboundMediaRoots`。
- 其他路径一律不读：记录 `op=inbound_media_rejected`（`reason=inbound_path_not_owned` 或 `inbound_path_sensitive`，不含路径），模型看到「这条消息里有个文件无法读取」的占位，回合照常进行。
- weixin-ilink 声明 `<dataDir>/<端点>/media/inbound`，email 在开启附件时声明 `attachments.downloadPath`，它们原有的入站媒体照常可读。其他适配器入站不产出本机路径。
- core 的旧字段兼容不再把 `data.file` 以 `/`、`./`、`~/` 开头的值猜成本机路径，统一视为平台不透明引用（`kind: 'file'`）；`data.path`、`data.file_path` 和 `media.kind: 'path'` 不变。可信插件代码若用 `data.file` 写本地文件，请改用 `data.path`。icqq 的 CQ 文本解析（如频道消息里用户写的 `[image:/root/.env]`）同样不再产出本机路径。
- `normalizeMediaRefsToPayloads()`、`publishOutboundElements()`、`authorizeOutboundMediaPath()` 不传 authority 时改为不读任何本地路径（与 `NO_MEDIA_AUTHORITY` 相同，URL 抓取规则不变）；仓内调用点都已显式传入。第三方插件直接调用它们读工作区文件时，需要显式传 `{ filesystem: { workspaceRoot }, fileRole }`。
- 行为变化：NapCat / OneBot 实现给出的 `data.path`（实现端本机路径）不再被读取，没有 URL 的语音、文件在 Agent 里显示为无法读取的占位。
