# 当前实机验收与剩余项

更新时间：2026-10-01 11:22（Asia/Manila）。本表是已有证据索引，不是全平台稳定性认证。历史失败保留，修复后使用新样本复测；API confirmed 不能替代客户端语义验证。

| 平台 | 已有真实证据 | 下一项 / 限制 |
| --- | --- | --- |
| NapCat | 用户确认基础私聊文本 | 图片、引用、撤回、重启、双账号和桥断线；本地 QQ 自动化读取超时 |
| OneBot11 | 用户确认基础私聊文本 | 同上；本轮远端WSS握手返回503，实例退出，需恢复桥服务 |
| QQ 官方 | 基础私聊文本；原生按钮回调与重复点击阻止；引用结构与撤回客户端 AX 证据 | 图片分片偏移已修复，RGB/原图 API 与客户端 AX 复测通过；分享明确 unsupported，旧假成功记录保留；WSS受控恢复API/客户端AX通过；Markdown完整视觉、双账号、API出站故障未证明 |
| Telegram | 私聊文本、图文、原生引用、撤回；A/B 别名隔离；旧样本跨进程阻止；专用 API 代理切断恢复；Markdown 加粗/代码/链接渲染、HTML 链接分享、原生按钮点击回调与重复点击阻止 | 群聊及其他传输模式分别验收；本次故障恢复只覆盖 Polling |
| Discord | 私信/频道文本；图片、引用、撤回；跨进程探针阻止；Markdown、分享 embed、原生按钮正确回调及重复点击阻止；独立 REST 连接拒断/恢复同进程通过，旧样本不补发、新回复一次 | Gateway 受控 cut/recover 同进程实测通过，恢复后文本及按钮回调成功；双账号、平台收到完整 POST 后丢响应未证明 |
| Slack | 白名单频道文本、图片；原生线程引用、撤回；跨进程探针阻止；Markdown、分享附件、按钮正确回调 | WSS 入站与独立 Web API 出站连接拒断/恢复同进程实测通过；恢复未见旧样本补发，新样本回复一次。双账号、平台已收到 POST 后丢响应的实机情况仍未证明 |
| KOOK | 频道文本、图文、原生引用、撤回；重启恢复、旧样本阻止；Markdown、链接分享卡片、原生按钮正确频道回调；独立 API 连接拒断/恢复同进程通过，旧样本未补发，新回复一次 | WSS入站受控断线恢复后文本与按钮回调实测通过；私聊、双账号、平台收到完整 POST 后丢响应未证明；旧撤回与媒体失败记录仍保留 |
| Email | 用户确认 SMTP/IMAP 往返；探针去重；自然超时重连日志；Markdown邮件正文strong/code/链接及转义、HTML分享链接与图片呈现实机通过 | IMAP入站受控断线恢复同进程实测通过；SMTP新连接切断后unknown及恢复新样本实测通过；双账号、DATA后实机断线仍未证明；引用/按钮/撤回限制见中文能力表 |
| 飞书 | 长连接私聊文本、图文、引用、撤回；重启去重；Markdown、分享卡片、按钮回调；同进程Stream受控断线后重连及收发 | 群聊、双账号未覆盖；OpenAPI新连接断网/恢复账本通过，恢复后客户端核对待完成；文件/音视频物化未覆盖；恢复后回复有API及客户端AX预览证据，截图未覆盖新消息 |
| 钉钉 | Stream 私聊实际回复、重启恢复、旧样本阻止；Markdown 与链接分享客户端证据；同进程 Stream 受控断线后重连及收发 | sessionWebhook 无消息 ID，回执保留 unknown；出站故障范围未覆盖；按钮等待互动卡片写权限；引用/撤回及媒体适用性审查中 |
| LINE | 账号指南与 HTTP 回调本地修复 | 账号与公网回调实机未通过；无持久事件去重 |

## 证据位置与边界

实机事件在 `.acceptance/<平台>/events.jsonl`；可见截图已保存在各平台 `.acceptance/<平台>/evidence/`，均为本地忽略文件。部分早期截图仍位于临时目录，需在分享或清理前复制留存。日志和截图不要连同凭据公开上传。

完整修复与验收记录见 [适配器稳定性计划](../../docs/plans/adapter-stability-parallel-plan.md)。[可控故障代理](../../scripts/platform-acceptance/FAULT-PROXY.md) 仅影响专用测试实例，不改系统网络。探针持久去重只保证同样本不重复发送，不证明平台事件 exactly-once。长跑、额外传输模式、账号隔离各自需要独立证据。

Discord、KOOK、飞书新增专用 API TLS 代理已通过本地实际 SDK 回归（全包分别 82、75、77 项），构建与 lint 通过。保留证书校验、断线只提交一次、恢复不自动重投；这些本地结果自身不能证明实机故障通过。整体框架证据与剩余清单见 [框架验收记录](../../scripts/platform-acceptance/FRAMEWORK-ACCEPTANCE.zh-CN.md)。

后续 KOOK 与 Discord 实机均已通过 API 连接拒断/恢复；KOOK 还发现并修复 typed 403 导致预载退出的问题，最终全包 78 项通过。各平台证据在 `.acceptance/<平台>/evidence/20261001-api-*`，与本地初次回归分开记录。飞书 API 三阶段实机账本已完成，恢复后客户端核对待完成（见 2026-10-08 记录）。

## 高阶能力补充验收（用户明确要求）

高阶验收尚未全平台完成。Telegram 已验证 Markdown 渲染与 HTML 链接分享；后者不是原生分享卡片。Telegram 按钮原死锁已修复并实测正确回调；KOOK 点击会话误归私聊已修复并实测正确频道回调；Slack 三项实测通过。Discord 三项实测通过（旧 HTTP 交互回调经用户批准清空）；飞书三项已实测通过（Markdown 使用 JSON2 卡片修复内联代码）。普通文本或仅发送成功不能替代高级语义验收。

| 能力 | 通过必须核对 | 当前工作 |
| --- | --- | --- |
| markdown | 加粗、链接、代码等客户端实际渲染；必要时核对转义与边界 | Telegram 已实测；其他平台继续核对出站映射与实际渲染 |
| button | 可见原生按钮、点击后正确回调、目标/账号隔离、重复点击处理 | Telegram 原生按钮实际点击回调通过且重复点击不新增结果；KOOK 正确频道回调通过；Slack 正确回调通过；Discord Gateway 完整回调通过；飞书真实回调通过 |
| share | 正确URL/标题/描述及平台适用的分享表现；明确是否仅链接回退 | Telegram HTML 链接分享通过；KOOK 链接卡片标题/描述可见且按钮打开正确 URL（目标页面当前 404），原生卡片与链接回退分别记录 |

Telegram、Discord、Slack、KOOK、飞书及 QQ 按钮回调已有实际证据，各自关联与重复点击边界见续测记录。钉钉已发布模板但 API 缺互动卡片写权限；未投递成功。其余平台仍需单独核验，不默认不支持。

### 2026-09-30 21:58 续测

- QQ：应用 pnpm 固定 SDK 补丁后，WebSocket 真实连接恢复；`qqmarkdown0001` 出站成功，客户端 AX 已呈现样本正文、代码文本和 Zhin 链接。截图观测仍停在旧画面，因此不把完整视觉效果标为通过。`qqbutton0001` 出站成功且 AX 出现“确认验收”，点击后未观察到回调，继续定位。
- QQ/CLI：109 项本地回归通过，包含完整 CLI 的模拟认证 403 受控退出；独立审计另外复现停止后网关地址迟到导致旧连接创建，尚待补丁修复和回归。上述模拟认证证据不代替真实平台收发。
- Email：Markdown 双正文、原链接分享、CID 图片混排实现完成，29 项本地回归及构建/Lint 通过；高阶收件端实机验收未完成。
- 钉钉：互动卡片投递与 Stream 回调实现完成，60 项本地回归及构建/Lint 通过；后台已创建并关联 Zhin 的验收模板、保存八个变量和标题绑定，正文/按钮与发布尚未完成。后台富文本变量选择不接受普通文本变量，正在修正配置指南。

### 2026-09-30 22:13 续测

- QQ `qqbutton0002`：真实私聊发送原生按钮，点击后 Core 接收并产生 `confirmed`、`callbackObserved=true`，客户端 AX 显示“操作成功”；重复点击再次收到交互但结果仍只有一条。关联方式明确为 `payload-conversation-actor`，QQ 私聊未提供源消息 ID，不将此项等同于有源消息 ID 的验证。报告保留关联字段。
- QQ 修复的 122 项回归及构建通过，覆盖 SDK 退休后迟到认证/网关、按钮动作类型、交互订阅、canonical action 与 ACK。补丁已应用实际安装，重启后的 WebSocket 真实连接成功。
- 钉钉：专用双按钮验收模板已发布成功，模板 ID `8a4b0b05-0212-4c05-bcbb-12524ba5c010.schema`；正文使用富文本变量，两个按钮分别绑定 label/payload/visible，回传参数为 action。发布证据 `/tmp/zhin-dingtalk-card-published.jpg`。尚未实际调用模板投递与点击回调，不能标为实机通过。

### 2026-09-30 23:10 续测

- 钉钉新实例已加载真实模板，`dingbutton0001` 在白名单私聊实际入站，访问令牌获取成功，但模板投递失败 `http_error`。当前缺少平台状态/错误码，继续补诊断和核对 API 契约，卡片与回调未通过。
- 验收命令镜像的类型错误已修，example 构建与两文件 10 项探针回归通过。
- Email 新增 SMTP/IMAP `serverName` 配置与透明 TCP 故障代理，保持上游 TLS 证书主机名校验；Email 35 项本地回归及构建/Lint通过，代理 3 项本地回归通过。真实故障恢复尚未验收。

### 2026-09-30 23:14 续测

- 钉钉 `dingbutton0002`：安全诊断明确 HTTP 403 / `Forbidden.AccessDenied.AccessTokenPermissionDenied`，需应用互动卡片实例写权限。已请求用户授权，仅该权限；授权前不改后台权限。
- 钉钉 `dingmarkdown0001`：会话 AX 确认实际收到样本、代码文本、Zhin 链接及转义字符。sessionWebhook 响应未提供消息 ID，运行时 receipt 为 `delivery_unconfirmed`，不能据此声称可引用/撤回；客户端收件证据与 API receipt 边界分别记录。截图 `/tmp/zhin-dingtalk-markdown-actual.jpg`。
- 安全投递诊断 13 项本地回归、构建/Lint通过，不记录 URL、凭据或原始响应。

### 2026-09-30 23:18 续测

- QQ `qqshare0001`：运行时只发送 `acceptance:qq-a:qqshare0001` 文本，未保留分享 URL/标题/描述；探针误将 receipt sent 记为 confirmed。该样本属于分享失败，不算高阶通过，正在修正探针能力判定及核对统一渲染降级边界。历史 events.jsonl 原始错误结果保留作为问题证据，后续报告必须结合此负面观测。
- 报告关联边界白名单回归累计 24 项通过。

### 2026-09-30 23:27 续测

- QQ `qqimage0001`：实际白名单私聊入站，图片回复失败 `endpoint_send_failed`；缺平台错误分类，正在补诊断及排查媒体上传。不能算图片通过。
- QQ `qqquote0001`：API 实际发送成功，客户端 AX 呈现原发送者“归雨”、原探针及回复正文的引用结构；截图仍停在旧按钮画面，不将该截图当成引用视觉证据。
- QQ `qqrecall0001`：API 发送与 recall 调用成功，客户端 AX 出现“对方 撤回了一条消息”；实机撤回已观察。

### 2026-09-30 23:34 续测

- QQ 分享假成功修复覆盖探针、Core 支持段契约及端点直调：不支持的混排分享整体拒绝，不发送邻接样本文字；Markdown/按钮已声明的降级仍兼容。19 文件 257 项回归通过，Core/Adapter/QQ 构建与所改文件 Lint通过。
- 已重启专用 QQ 验收实例（PID 59140）；`qqshare0002` 实际入站，结果为 unsupported（3ms），无平台 send，不再假 confirmed。此结果证明拒绝边界，未证明 QQ 原生分享能力。
- `qqimage0002` 实际入站，上传完成阶段返回平台码 850019，安全诊断为 platform_rejected/rejected；正在核验平台错误码和 SDK 上传参数。图片仍失败。
- 报告 24 项回归通过；真实负面分享/图片及引用/撤回客户端 AX 观测已分别保留 operator evidence。

### 2026-09-30 23:36 续测

- QQ 专用实例从 PID 59090 重启至 59140。旧 `qqquote0001` 于 23:35:07 再次真实入站，持久探针结果 blocked，无再次平台发送；新 `qqrestart0001` 于 23:35:31 入站并成功回复。证明验收探针跨进程去重和重启后可收发，不代表 QQ 平台事件 exactly-once。

### 2026-09-30 23:41 续测

- 钉钉 `dingshare0001`：真实私聊实际收到原生链接卡片，AX与截图呈现标题及样本文字/描述。实际点击打开 Chrome `https://zhin.dev/`，目标站当前404；地址映射正确。sessionWebhook 无消息 ID，因此 receipt 仍 delivery_unconfirmed，客户端可见收件不替换该 unknown。截图 `/tmp/zhin-dingtalk-share-actual.jpg`。
- QQ 850019 经官方单聊富媒体上传文档核验为“不支持的文件格式”（建议检查 file_type），不是权限码。已装 SDK 全上传链本地 fixture 验证 numeric file_type=1、image.png、原PNG字节、MD5、upload_id完整；没有丢 metadata 证据。接下来用不同标准图片实机鉴别，当前图片未通过。主源：https://bot.q.qq.com/wiki/develop/api-v2/autogen/api/v2_users_user_openid_files.post.html 。

### 2026-09-30 23:46 续测

- 新增显式固定 `image:rgb`（128×128、8-bit RGB、无 alpha）；默认原48×48 RGBA样本保留，探针白名单只接受 rgb/legacy，hash区分图样，不接受任意URL/path。12 项相关回归、example与QQ build通过。
- 专用实例已重启加载，`qqrgb0001` 于 23:45:51 实际入站，23:45:52 仍在 upload_complete 返回850019/platform_rejected。两个合法PNG均失败，不能归因单一旧透明图样本；继续查分片协议。
- 钉钉分享截图及 AX/点击目标观测已复制到 `.acceptance/dingtalk/evidence/`，operator visible observation 保持与 API unknown 分离。

### 2026-09-30 23:51 续测

- 钉钉 Stream 专用透明TCP代理已实际连接官方网关，证书校验保持开启。基线 dingfaultbase0001 实际入站与客户端回显；23:50代理cut，适配器disconnect/reconnect（首轮失败、第二轮成功）；恢复后代理connections从1增至2、activeSockets=2，同一实例 dingfaultafter0001 实际入站且客户端回显。证明本次Stream入站受控断线恢复；sessionWebhook出站不在故障范围且receipt仍unknown，不将本次结果冒充双向故障或API确认。

### 2026-09-30 23:56 QQ 图片根因证据

- `qqrgb0002` 真实安全诊断：输入257bytes、fileType1、sizeMatch/hashMatch；平台prepared blockSize257、partsCount1、min/maxIndex=1、partSize257、coverageMatch=false；SDK finish index1却blockSize0，随后850019。实际平台首片从1开始，而文档及SDKoffset按0开始，因此实际上传空片。
- 修复正在按完整连续parts序号集合辨识0/1基准，finish保留平台原序号；异常重复/缺片拒绝，避免空上传。修复与实机成功尚未完成，不提前标通过。
- 新安全诊断QQ全包124项回归/build/lint通过；钉钉实际恢复截图与观察记录已留存。

### 2026-09-30 23:59 续测

- QQ 实机空分片数值证据独立留存 `.acceptance/qq/evidence/20260930-upload-offset-failure.md`，不含账号ID、URL、Token或uploadID。SDK分片补丁已写入，0/1基准由完整连续集合推断，finish保留平台序号；尚待最终回归、重新安装补丁和实际复测。
- 报告现在仅保留 imageSample=rgb/legacy 标签，未知值、base64、URL、路径不导出；报告与探针30项回归通过。

### 2026-10-01 00:03 QQ 图片修复复测

- 分片补丁17项回归、build/lint通过，离线安装hash hmzc4tr6duw3yequlqssh4ga3q并重启实际实例。
- qqrgb0003（257bytes）和qqlegacy0003（182bytes）均真实上传/发送成功；平台index1被识别为base1，finish大小与原字节/哈希一致。客户端AX分别呈现图片节点与对应样本文字。
- 截图仍停在旧按钮画面，不将旧图冒充新图片像素证据；实际AX与API证据留存 `.acceptance/qq/evidence/20261001-image-fixed-ax.md`。历史图片失败保留。

### 2026-10-01 00:05 安装后回归

- 已安装分片补丁后独立运行 SDK 上传/诊断回归13项全部通过。原诊断fixture空parts仍期望成功，已改为明确异常拒绝断言，并继续验证无敏感输出及release停止观测。
- 本次默认沙箱loopback监听EPERM导致初次测试超时；以获准本地网络范围复跑，12项分片通过，随后修正上述过时断言后13项全部通过。
- NapCat 本地3000/6099均无监听，桥实机入口仍未恢复，不将已有QQ官方进展推广到NapCat/OneBot11。飞书长连接受控故障入口继续独立审查。

### 2026-10-01 00:08 安装后完整 QQ 回归

- 实际安装最新补丁后，QQ 16 文件136项回归全部通过，覆盖原有生命周期/停止、认证、按钮、媒体与分片修复；与真实PNG收件证据分开记录。
- 再尝试前置QQ窗口截图仍停旧按钮，客户端AX显示两种新PNG图像节点；不把旧截图用于图片像素验收。
- 飞书长连接专用代理已经完成实现/build/lint，正在真实已装SDK的本地TLS/WSS握手及断线恢复验证，尚未真实飞书故障测试。

### 2026-10-01 00:11 飞书故障准备

- 飞书真实已装SDK本地TLS/WSS代理cut/recover与身份失配受控拒绝验证通过；通过placeholder实机安全发现msg-frontier.feishu.cn，专用透明TCP代理18490/control18491已启动，重新启动白名单长连接实例。尚待真实基线/cut/recover/后续消息验收。
- 统一发送链路门禁check:harness-paths通过。QQ邮箱入口尝试只打开空白窗口，Email实际收件入口仍不足，未向其他邮箱发测试消息。

### 2026-10-01 00:15 飞书真实受控恢复

- 专用代理cut后disconnect，首轮重连失败、第二轮成功；proxy connections从1增到2，同一PID9651。恢复后larkfaultafter0001真实入站并API成功发送；客户端会话预览AX显示对应回复。基线回复正文AX可见。
- 此次只覆盖Stream入站，OpenAPI出站保持直连。截图仍停旧Markdown，未当新收件像素证据；数值日志及客户端AX边界留存 `.acceptance/lark/evidence/20261001-stream-recovery.md`。

### 2026-10-01 00:18 剩余验收配置核对

- 只读检查真实.env字段是否非空，没有打印值或修改文件：仅TELEGRAM_B_TEST_CHAT_ID非空；其他平台B测试会话均空。说明本地双账号验收入口未配齐，不代表用户未创建账号。
- Slack专用WS代理与统一生命周期接管继续实现；Discord正式IShardingStrategy入口继续实现，需要同时代理初始gateway和Resume gateway，避免恢复绕过故障链路。LINE实例内重放去重继续实现，跨进程持久交付仍未证明。

### 2026-10-01 00:31 Slack 实机受控恢复与 LINE 本地去重

- Slack SDK 自动重连关闭，统一 lifecycle 接管；固定 WSS 代理真实 cut/recover 后首轮重连失败、第二轮成功。同一 PID32682，代理连接数1→2，恢复后探针实际收到、回复正文及截图可见。证据 `.acceptance/slack/evidence/20261001-stream-recovery.md`。范围仅 WSS 入站，Web API 出站未切断。
- LINE 实例内 webhookEventId 重放去重、本地并发与失败重试回归通过；完整39项测试与构建/lint通过，父复核5项。跨进程持久事件去重与真实 LINE 验收仍待完成。
- Discord 正式 SDK 代理依赖已安装，继续验证初始/Resume 网关代理及统一生命周期。

### 2026-10-01 00:37 Discord 实机发现配置与会话映射问题

- 插值前 schema 拒绝标准环境变量引用已修复，真实 Ajv 回归与构建通过。
- 初次官方 Gateway 连接已进入代理（upgrades1），但后续 session 读取抛 Invalid Discord gateway host，实例退出；当前未通过受控故障验收。正在修复连续 Dispatch 更新导致 Resume URL 二次映射的边界，并补真实 SDK 回归。
- Slack undefined SDK 拒绝现归一为安全且明确的 Error，父复核3项回归通过；未修改真实 .env。

### 2026-10-01 00:48 Discord 实机受控恢复

- schema和会话URL二次映射修复后，同一PID49378通过Gateway代理cut/recover，连接数新增；恢复后文本客户端正文可见，按钮新样本点击得到正确source-message关联、Core确认及SDK ACK。证据 `.acceptance/discord/evidence/20261001-gateway-recovery.md` 与同名截图。
- 首个按钮样本点击晚于60秒观察窗口，unknown保留；第二个样本在窗口内confirmed。真实未记录op6帧，只有本地真实SDK回归证明Resume路径；实机结论为Gateway自动恢复，不扩展为REST故障恢复。
- QQ与KOOK专用SDK可选连接扩展补丁已离线安装，继续全包回归及生命周期资源清理检查，尚未标实机通过。

### 2026-10-01 00:55 QQ WSS 受控恢复的部分证据

- 同一PID61687经固定官方WSS代理cut/recover后重连，恢复后探针入站并实际发送成功。客户端仍呈旧消息，收件证据不足，不标完整通过；范围仅WSS入站。证据 `.acceptance/qq/evidence/20261001-wss-recovery-api.md`。
- 连续失败attempt日志始终1，统一lifecycle退避边界继续检查；KOOK最终已装补丁58项回归/build/lint通过，进入实机网关发现。真实.env未修改。

### 2026-10-01 00:58 统一生命周期退避修复

- QQ实机切断发现的连续attempt1已确认共享层缺陷：工厂在SDK关闭后正常resolve被误认成功、重置计数。现在未健康打开的工厂累计失败，10/20/40递增退避并遵守上限，真正健康恢复后才复位。237项adapter+QQ回归/build/lint通过，尚待加载新lib后实机连续失败复测。
- KOOK已通过固定nws.kaiheila.cn透明TCP代理18520/control18521启动；预加载约57秒才完成，ready前样本被丢弃，已用新样本继续基线；cut/recover尚未完成。

### 2026-10-01 01:02 QQ 退避实机复测与 KOOK 恢复失败

- QQ 首轮恢复后客户端AX正文证据补齐；第二轮PID72856真实连续失败退避约5/10/20/40秒，恢复后新探针入站/发送成功。原图证据文件补充，范围仅WSS入站。
- KOOK cut/recover后新连接Hello成功但数十毫秒内关闭，预加载结束又重试，尚未通过。精确PID68589已停以修复循环；恢复日志交agent分析SDK会话与资源边界。

### 2026-10-01 KOOK 会话协议与验收报告边界继续修复

- KOOK补丁增加正常断线使用原会话恢复、服务器s5指令清空序号/队列重新发现；正在补同一个Runtime Client真实TLS回归，以及s6确认前离线事件缓存后顺序派发。此前两个新Client的fixture不足以证明复用会话恢复，未标通过。
- 验收报告修复跨账号借证据、重复抑制跨target/action借结果、同sample改绑覆盖unknown三个误判；49项验收测试/lint/语法验证通过。这是报告正确性修复，不能代替真实B账号验收。

### 2026-10-01 01:32 KOOK 恢复实测与 Email 本地复核

- KOOK最终会话补丁加载后，同一PID98858真实cut/recover成功；恢复后新文本客户端正文可见，新按钮在60秒内收到source-message关联回调。证据 `.acceptance/kook/evidence/20261001-wss-recovery-fixed.md` 及同名PNG。此前失败保留，范围仅WSS入站。
- Email统一生命周期、连接owner隔离、解析/分发锁及UIDVALIDITY/UID有界去重修复完成，父复核6文件43测试通过；本地真实SMTP DATA后断线不会自动重发。尚无本轮真实邮箱进阶/受控故障证据，24小时缓存与停止/重启不提供永久去重，markSeen是fetch时已读而非业务ACK。

### 2026-10-01 01:35 实机入口复核

- NapCat配置指向本机3000，实际无监听。OneBot11配置指向远端WSS，真实启动握手返回503后退出；不能用本机6099无监听推断远端状态。
- 只读配置存在性：除Telegram外各平台B_TEST_CHAT_ID为空；LINE主白名单为空。已请求恢复桥及补充B入口。
- QQ客户端补见qqbackoffafter0001实际回复正文，补齐第二轮共享退避复测的客户端AX证据。
- QQ邮箱已登录且身份匹配既有验收白名单，准备继续真实邮件验收。

### 2026-10-01 01:39 Email Markdown 实机证据

- PID18803通过空标题emailmarkdownlive0002实际往返，收件正文strong/code/链接/转义可见；证据 `.acceptance/email/evidence/20261001-markdown-live.md` 与同名PNG。带标题样本入站但Subject前缀未匹配命令，不标通过。其余邮件高阶与故障继续测试。

### 2026-10-01 01:43 Email 分享与图片实机证据

- emailsharelive0001与emailimagelive0001实际往返，收件端显示标题、描述、正确公开href与蓝色测试图。证据 `.acceptance/email/evidence/20261001-image-share-live.md` 和同名PNG；范围是HTML链接分享，不是原生聊天分享卡片。SMTP/IMAP受控故障及双账号继续验收。

### 2026-10-01 01:48 Email IMAP受控恢复实测

- PID29341经透明代理cut/recover，5/10/20递增退避后同进程重连；恢复后新探针实际往返，收件正文可见。证据 `.acceptance/email/evidence/20261001-imap-recovery.md` 与同名PNG，范围仅IMAP入站。

### 2026-10-01 01:50 SMTP结果分类审查

- 已准备回环透明SMTP代理18540/control18541，尚未切换实机发送链路。Email.send直接await sendMail并依赖messageId，DATA后断线的unknown分类及accepted/rejected收件回执仍缺回归，交由agent修复；不将本地“不重试”夹具当作准确交付分类或真实SMTP故障通过。

### 2026-10-01 框架门禁与SMTP分类复核

- 当前工作树check:architecture、check:harness-paths、check:plugin-capability-publish通过。
- Core普通发送异常已有deliveryUnknown=true，不能说它是安全明确失败；Email显式SMTP拒绝/接受/部分接受仍由agent补EndpointDeliveryError与完整收件回执校验。真实SMTP故障验收暂未标通过。

### 2026-10-01 01:57 QQ Markdown视觉复核与SMTP测试阻碍

- 新qqmarkdownvisual0001实际入站及API发送成功，截图仍展示旧qqbutton样本，随后原窗口不可用；新Markdown完整视觉未证明，不能用旧截图升格。
- SMTP分类父测试42passed，两新suite因测试helper的plugin-runtime入口解析失败，已交agent修复；未加载新lib或标SMTP实机通过。

### 2026-10-01 高阶语义审查与SMTP回执修复

- 中文适用表位于 `scripts/platform-acceptance/CAPABILITIES.zh-CN.md`，已从示例README链接。OneBot11与钉钉share的audio/artist/duration/config静默丢失已改为发送前明确拒绝；agent两包130测试/build/lint通过，本轮未新增这两平台实机结论。
- Email引用段未实现须请求前明确拒绝，不把普通SMTP邮件当引用通过。真实本地SMTP/Core夹具已覆盖DATA后断线的deliveryUnknown与不重试，最终全包检查进行中；实机SMTP出站仍待验证。

### 2026-10-01 02:06 SMTP受控恢复实机证据

- Email61回归/build/lint通过并加载新lib，PID50330实际SMTP代理cut期间记录unknown，recover后新样本实际收件正文可见。证据 `.acceptance/email/evidence/20261001-smtp-recovery.md` 与同名PNG。实机仅新连接前cut，不冒充DATA后切断；unknown记录保留。

### 2026-10-01 02:08 剩余入口与QQ可访问树证据

- QQ新Markdown正文及链接AX已明确取得，证据 `.acceptance/qq/evidence/20261001-markdown-ax.md`；截图仍旧，完整视觉不升格。
- 只读复核B白名单仍仅Telegram已填；LINE三关键变量空，NapCat3000无监听。已请求用户提供剩余入口状态，未编辑.env。钉钉卡片权限仍待批准。

### 2026-10-01 02:11 联合回归

- 当前工作树十一平台适配器tests及共享adapter tests联合Vitest通过：112文件、934测试。验证并行修复集成结果，不代替实机。
- 文档链接检查245文件通过；适配器文档同步20平台通过。架构/发送链路/发布入口门禁此前本轮通过。
- 未完成：非Telegram平台B真实隔离、NapCat/OneBot11桥恢复后进阶与故障、LINE真实账号及回调、钉钉卡片权限后的按钮、QQ完整视觉。其余扩展模式与群聊保留单独证据范围，不能从私聊模式泛化。

### 2026-10-08 飞书 OpenAPI 断网与恢复

专用 TLS 代理 18590/control 18591 的三阶段真实探针，均由 PID 43854/generation 1 处理：基线 `larkapibase0001` confirmed（用户确认客户端仅一次）；切断新连接后的 `larkapicut0001` unknown；恢复后的新探针 `larkapiafter0001` confirmed。账本每个样本各一条 attempt 和 result，当前无旧样本重投。代理已恢复 forwarding，服务继续运行。用户已确认收到恢复后的 `acceptance:lark-a:larkapiafter0001` 且只有一次；旧断网消息是否补发仍待客户端核对，不能据此声明完整客户端验收通过。证据：`.acceptance/lark/evidence/20261008-api-ledger.json`。此项只覆盖 API 新连接切断，不覆盖平台已接受完整 POST 后丢失响应；未修改用户 `.env`。

2026-10-08 用户确认NapCat仅一个账号：继续单账号断线重连、重启去重、消息组件与高阶能力验收；不要求新增NapCat账号B。双账号隔离保持未验证，不能借单账号结果声明通过。当前需恢复既有桥入口。
