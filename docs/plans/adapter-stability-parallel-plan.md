---
sidebar: false
---

# 适配器稳定性补齐与并行实施计划

日期：2026-09-30。探索基线：`004348cf9`。实施已启动；最终验证证据以交付记录为准。

用户最新安排：开发与离线/产物验收完成后，由用户验证真实平台。因此本轮交付包含实机执行器和操作说明，
不要求预先取得账号凭据，也不将实机或 72h 长跑标为通过；稳定档位保持原状。

## 目标与首批范围

让真实平台具备可验证的安装、收发、回执、隔离、恢复、热重载、生产重启和持续运行能力。
首批覆盖 NapCat / OneBot11、QQ 官方、Telegram。用户已确认三组真实账号均可准备。
NapCat / OneBot11 优先用于验证常见 QQ 用户路径；QQ 官方与 Telegram 延续已有稳定候选工作。
ICQQ 本轮修复明确的回执问题，完整平台认证作为下一批，避免把登录/签名条件扩大为首批阻塞。

认证以平台、接入模式、SDK/桥版本为单位，不能用一个模式通过代表整个平台通过。
支持能力依据平台权限与实际实现记录：不支持记 unsupported，缺环境记 blocked，失败记 failed。

## 已有保障与本次验证

- 统一 Endpoint 入站与 Core 出站管道，generation 快照、候选准入、退役代屏蔽已有实现。
- 共享生命周期提供幂等启动停止、连接代次、退避与心跳能力；QQ / Telegram 已有账号隔离与异常场景测试。
- `check:created-project` 已验证候选 tarball、干净安装、Sandbox /hello、HMR、生产重启、doctor；缺口是平台覆盖。
- `check:platform-auth` 只做 QQ token/网关发现、Telegram getMe，不是收发验收。
- 本次 `pnpm check:stable`：22 文件、327 测试全部通过。
- 本次 NapCat / OneBot11 / ICQQ 测试：22 文件、250 测试全部通过。
- 上述两组测试最初因沙箱禁止本地 listen 出现 EPERM，在允许本地监听后均通过。不能将其算作代码失败。
- 共享层独立测试：4 文件、76 测试通过。另用只读脚本复现了下述微任务连接竞态。
- 本次没有真实账号运行证据，也未验证 npm latest 或已部署服务。

## 具体缺口

| 优先级 | 证据与性质 | 补齐方向 |
| --- | --- | --- |
| P1 | **已复现**：`endpoint-lifecycle.ts:195-211,294-299`，connect resolve 后微任务立即 notifyClosed，仍被标为 open | 为每次连接尝试保存关闭事实，初连与重连均覆盖；不可漏闭或重复启动重连 |
| P1 | **代码确认**：`adapter-index.ts:140-142,394-397` 的 connected/online 来源是 admission；CLI `readiness.ts:62-64` 使用它 | 分离 generation 准入与物理连接健康，支持断开、恢复、等待反向连接；保留公开 ready 的最小输出 |
| P1 | **代码确认**：NapCat WS/WSS、OneBot11 WS 的 message 回调缺旧 socket 身份屏蔽；NapCat WSS 替换及关闭时未拒绝旧 pending；OneBot11 WSS 已有相应保护 | 补旧连接消息/回执隔离、断开与替换 pending 结算、停止竞态和双账号测试 |
| P1 | **代码确认**：OneBot11/NapCat ws-transport 先注册 pending 再裸 send；send 同步抛错后 pending/timer 留到 30 秒 | 同步失败即释放 pending/timer；区分尚未发送与发送后结果未知 |
| P1 | **代码确认**：OneBot11 缺 message_id 返回空串；ICQQ 缺 ID 生成 sent_timestamp；Core 对 string 直接标 sent，通用错误标 retryable:true | 确认成功必须有可证明的回执；网络超时/回执丢失不能当作安全重试的失败 |
| P1 | **代码确认、损失范围待故障测试**：Telegram closed Webhook 及内部异常返回 200；Polling 在 handleUpdate 前推进 offset，offset 为内存状态 | 明确接收/处理/确认边界、重投与去重语义、重启游标；关闭或暂时无法接收不得静默确认 |
| P1 | **代码确认**：Telegram 普通 callApi/Form 没有默认 deadline；Polling signal 不代表所有 API 有超时 | 按调用类型制定超时/取消合同；长轮询独立预算；不无条件重发副作用请求 |
| P2 | **待验证风险**：AdapterIndex factory 返回后 abort/validation/bind 失败可能未纳入回滚 records | 先复现资源分配与失败路径，再补准确一次释放和补偿错误报告 |
| P2 | **代码确认**：Endpoint commit 前 buffer 上限 256，溢出 shift；flush receive rejection 被吞 | 有界缓冲保留，明确溢出与派发失败诊断/计数，避免无限排队 |
| P2 | **确认漂移**：adapter README 与 lifecycle 文档仍写 name 必填/非法项跳过；实现要求 id 且非法重复 throw | 统一 README、向导、示例与真实公共配置合同 |
| P1 | **证据缺口**：平台产物安装、真实模式故障、长期运行无完整可校验记录 | 扩现有产物门禁并建设 opt-in 实机 runner 和长跑报告 |

发送未知结果和 Telegram 更新可靠性需要先明确公共合同。不能直接添加自动重试，也不能未经选择便承诺 exactly-once；若需要耐久 inbox/cursor，使用已有 Host 存储投影，不让低层 adapter 反向依赖 CLI/Core。

## 并行工作包与所有权

实施前由主 agent 冻结三个合同：transport 健康投影、发送结果/未知结果、验收场景与报告 schema。涉及公共类型变化，先评估兼容性和 changeset；这一步是短串行关口。

| 包 | Agent 所有权 | 交付与验收 | 依赖 |
| --- | --- | --- | --- |
| A 共享生命周期 | `packages/im/adapter/src/endpoint-lifecycle.ts` 及对应测试 | 初连/重连 resolve→微任务 close、stop-during-connect、watchdog、延迟/抛错关闭；单一重连循环、无遗留 timer | 可立即开始 |
| B 状态与资源所有权 | `adapter-index.ts`、Endpoint 健康公共合同、CLI readiness/Console 消费者；共享 `endpoint.ts` 缓冲诊断也归 B | admitted 与 transport 分开；断开时不谎报在线；旧代不能污染新代；factory 失败资源清一次；溢出可观测 | 健康合同先冻结；同一文件只有 B 修改 |
| C OneBot/NapCat | `plugins/adapters/{onebot11,napcat}/` | WS/WSS/HTTP 各自测试；旧 socket 事件和 ack 隔离、替换/断开结算、send 抛错清理、心跳黑洞、双账号 | 使用 A/B 公共合同；不修改共享层 |
| D Telegram | `plugins/adapters/telegram/` | Webhook 暂不可用响应、重复 update、处理失败与 offset、重启、取消/deadline、双账号；说明确认与重投语义 | 确认合同冻结；复用 B 健康投影 |
| E 发送回执与 QQ/ICQQ | Core outbound receipt、必要 im-contract 类型、`plugins/adapters/{qq,icqq}/` | 缺 ID 不假报 sent；unknown 不标安全重试；QQ WS/HTTP 停机/恢复/限流/审核拒绝；ICQQ 不伪造 ID | 发送合同先冻结；C/D 平台内部分别由其 owner 适配 |
| F 平台安装与实机执行器 | 新 acceptance runner/report fixtures、`check-created-project` 扩展、CI | 候选包干净安装接可控网关；配置→命令收发→HMR→生产重启；opt-in live/soak、白名单目标、脱敏报告 | report schema 冻结后可立即做；最后集成 A–E |
| G 文档与认证 | adapter README/docs、scaffold 相关配置文档、`adapter-meta.mjs` | 配置合同修正、平台×模式矩阵、运行步骤、限制；只有证据齐备才升档 | 可先修文档；认证等待 F 实机收据 |

并发限制为 4 个 agent（含主 agent）时采用三条实施线：

1. 第一轮：A、B、F；主 agent 冻结合同并审阅集成。
2. 第二轮：C、D、E；F 已交付的 runner 可开始使用，用户同步准备账号。
3. 第三轮：F 完成实机/长跑工具与产物验收，G 补齐操作文档，第三个 slot 独立审阅与回修；主 agent 做跨包验证。真实场景与长跑由用户在开发交付后执行。

各 agent 交付应含小范围提交/补丁、复现与回归结果、未覆盖项。共享 types/CI/package.json 的改动只由指定 owner 或主 agent 合入，不在共享工作区多方编辑同一文件。

## 真实账号准备

凭据放本地 `.env` 并以环境变量引用，不在聊天/报告/仓库中贴 secret。用户负责账号登录；测试程序只使用已配置的服务入口。

| 平台 | 最低准备 | 完整认证追加 |
| --- | --- | --- |
| NapCat / OneBot11 | 一个已登录专用 QQ 桥实例；桥版本、可访问的 WS 地址与本地 token；专用测试好友和群 | 第二个 QQ/桥实例用于隔离；正向 WS、反向 WS、HTTP 模式逐项；群内媒体/引用/撤回权限 |
| Telegram | 一个 Bot token；测试私聊和群；能访问 Bot API 的网络；先跑 Polling | 第二个 Bot；Webhook 公网 HTTPS 与 secretToken；撤回所需权限；同一 Bot 不同时跑 Polling/Webhook |
| QQ 官方 | 一组 AppID/Secret；应用类型及沙箱/上线属性；已授权测试用户、群/频道；所需 intents/权限 | 第二个独立应用用于隔离；HTTP 模式公网回调；分别记录公域/私域及平台主动发送限制 |

本地验收配置必须给出允许触达的目标、允许执行的动作和发送频率。限流/权限拒绝先做本地故障注入；实机不通过轰炸平台制造限流。断网只针对测试进程/连接，不改整机网络。
凭据与单账号足够启动首轮实机；第二账号及公网 Webhook 可随后补齐，缺少的模式保留 blocked。

## 实机场景与完成标准

1. 从候选安装包启动，校验连接与诊断；鉴权失败给出可行动错误，无凭据泄漏。
2. 私聊/群聊文本、引用、图片、平台允许的撤回/交互；每次发送保存真实平台回执与对应受控目标观察，平台不支持项明确记录。
3. 双账号同时运行，消息、权限缓存、游标、回执、存储不串号。
4. 断连恢复、半开/黑洞、平台拒绝、超时与迟到回执；统计恢复时间，旧连接不继续投递。
5. 收发期间 HMR、失败候选回滚、生产重启；用唯一测试标记核对重复和缺失，并记录设计允许的语义。
6. 正常停止后无重连、无新增业务事件，pending/timer/listener 回到基线。
7. 先 24h 初验，再 72h 升档候选长跑。这是建议的新标准，尚不是既有门禁。

建议验收阈值：受控场景不允许串号、假成功、静默确认后丢弃或无解释重复；停止/本地故障恢复以明确配置预算验收，实机报告恢复 p50/p95/max；pending 和监听器不得持续累积。成功率分母只计平台允许且实际触发的测试发送，限流/权限/未知结果分别统计。资源增长用稳定负载、预热后多窗口趋势判断，先形成基线再定 RSS 数值，不凭空设固定 MB。

最终报告包含 commit、工作区状态、包/SDK/桥版本、Node/OS、模式、UTC 时间、样本量、逐项结果、延迟/恢复、资源趋势和脱敏证据路径。通过报告校验后才修改稳定档位；未验模式不继承已验模式认证。

## 集成验证

每包先跑受影响测试；集成跑 `check:stable`、新增 transport/receipt 故障矩阵、平台产物验收；涉及公共契约再跑 architecture、type-check、相关 harness 和文档链接/SSOT 门禁。不要用工作区单测代替产物安装或真实账号证据。

## 开发交付记录（2026-09-30）

A–G 的开发与本地验收已实施，补丁留在当前工作区，并附 changeset；未发布新版本。
独立 agent 审阅后追加了同步派发/停止异常、未观测健康、watchdog 手动重启、
Telegram 部分发送与文件下载边界，以及验收报告的反证回归。

- 四个平台产物主链均通过：候选 tarball → 干净安装 → 本地假平台入站 → 统一消息回复回执 → HMR → 生产重启 → acceptance probe。
  覆盖模式为 OneBot11/NapCat 正向 WS、QQ WebSocket、Telegram Polling。
- `HARNESS_SKIP_TEST=1 HARNESS_SEQUENTIAL=1 pnpm check:all`：56 项通过，包括 architecture、lint、type-check、L4-CI、Stable smoke 和 IM 安装体积。
- 最终 `pnpm exec vitest run --maxWorkers=4`：925 文件通过、3 文件跳过；7,150 测试通过、12 跳过。
  另有 20 项 runner/report 反证测试；最终 type-check、lint 与文档链接/同步/导航检查通过。
  全量高并发曾触发既有 pagemanager 100ms 性能断言（103.75ms），单独复测及限制并发后的全套均通过，未修改该断言。
- 用户实机操作入口：[平台验收执行器](../contributing/platform-acceptance-runner.md)，本地配置示例位于 `scripts/platform-acceptance/`。
  四平台安装门禁为 `pnpm check:created-project:{onebot11,napcat,telegram,qq}`，CI 分别运行四个 matrix job。
- 实机报告按目标与阶段关联故障、HMR、重启证据；无样本、身份未变化、未知结果或无对应进程的完整 RSS 采样不能被人工 pass 转为自动通过。

开发交付不等于真实平台认证：实际账号、其他接入模式、24h/72h 长跑仍由用户后续执行。
Telegram 跨代与重启采用至少一次语义；本轮没有实现耐久 inbox/checkpoint 或承诺 exactly-once。
生命周期 `onForceClose` 仍为同步 void 合同，不能将它表述为等待物理连接完全关闭。
平台公开稳定档位保持原状，未经真实证据不会自动升档。

## 用户实机文本验收记录（2026-09-30）

用户明确反馈“全部验证通过”，并提供四张接收端截图。四个平台均收到
`/acceptance probe:sample0001` 后，回复了对应平台别名与原样样本标记：

| 平台 | 本例接入模式 | 接收端实际回复 | 结论 |
| --- | --- | --- | --- |
| Telegram | Polling | `acceptance:telegram-a:sample0001` | 真实文本收发通过 |
| OneBot11 | 正向 WS | `acceptance:onebot11-a:sample0001` | 真实文本收发通过 |
| QQ 官方 | WebSocket | `acceptance:qq-a:sample0001` | 真实文本收发通过 |
| NapCat | 正向 WS | `acceptance:napcat-a:sample0001` | 真实文本收发通过 |

证据来源为本会话用户确认与接收端截图；不记录账号、Token 或会话 ID。
这是首轮文本收发证据，不扩展为其他模式、双账号隔离、媒体/引用/撤回、故障恢复、
实机 HMR/生产重启或 24h/72h 长跑通过。公开稳定档位保持原状。

## 第二轮验收扩展（2026-09-30）

用户要求同时推进原四个平台进阶验收和其他适配器，并确认 Discord、Slack、KOOK、Email 账号已准备。

- example 已新增这四个平台的独立启动、策略、观察报告入口；Slack 使用 `!` 命令前缀。
- 原四个平台新增反向 WS、NapCat HTTP、QQ Webhook/Middleware、Telegram Webhook 配置；各模式证据目录独立。
- 账号 B 使用独立凭据、端点、白名单与 readiness，缺失凭据及入站路径冲突会阻止生成。
- 新四个平台现有回归及配置 resolver 测试共 196 项通过；扩展 example 与报告回归共 29 项通过。
- 上述测试数量是本地验证；双账号及进阶模式仍等待用户实际运行结果。
- 用户已确认 Discord 私信和服务器文字频道、Slack 文本、KOOK WebSocket 频道文本往返成功。Discord 频道发送权限不足（50013）在用户补齐权限后通过；KOOK 启动黑名单预加载的权限拒绝已降级，频道回复成功。
- Email SMTP/IMAP 文本往返已通过，接收端截图显示 `acceptance:email-a:email0001`。发件人归一化为纯邮箱地址后，用户将白名单与实际发件人对齐并收到回复。日志另观察到一次 IMAP 超时及自动重连成功，但尚未完成受控断线后再次收发验收。
- 飞书、钉钉、LINE 已移除合成消息 ID；缺失真实回执及请求结果不明保留 unknown。LINE 不再收到任意 HTTP 400 后自动 push，避免重复发送。三适配器 107 项回归通过，新增回执合同测试最终 26 项通过；各包构建与相关 lint 通过。

操作入口：[新增平台准备与启动](https://github.com/zhinjs/zhin/blob/main/examples/platform-acceptance-bot/ADDITIONAL-PLATFORMS.md)、[第二轮操作单](https://github.com/zhinjs/zhin/blob/main/examples/platform-acceptance-bot/NEXT-TESTS.md)。

### Telegram 双账号浏览器复核（2026-09-30）

经用户授权，使用已登录的 Telegram Web 向两个测试 Bot 发送相同样本 `browserdual01`。账号 A、B 分别显示 `acceptance:telegram-a:browserdual01`、`acceptance:telegram-b:browserdual01`；本地执行记录均为 confirmed。重复发送的执行记录为 blocked，接收端未出现第二条回复。旧人工样本和本轮样本的 PID 不同，证明进程已更换，但本轮尚未直接复发旧样本验证跨重启去重；单端点停止与恢复仍待测。

后续复发旧进程成功的 `dual0001`：A、B 在新进程下均记录 blocked，Telegram Web 未出现新回复，补齐跨进程重启的探针持久化去重证据。

### Discord 浏览器与进程重启复核（2026-09-30）

在现有白名单频道，独立端口启动测试进程后发送 `browserdiscord01`，平台显示对应 Bot 回复，本地记录 confirmed；复发记录 blocked。停止该测试进程，再以 production 模式启动：PID 改变，旧样本仍 blocked；新样本 `browserdiscord02` 显示真实回复并记录 confirmed。测试完成后停止临时进程。仅证明文本往返、探针持久化去重和进程重启恢复；不扩展为 Gateway 受控断线、媒体或双账号隔离通过。

进阶实机发现两项缺陷：未命名 PNG 发为无扩展名普通附件；reply 段未映射到 Gateway SDK，引用探针只显示文本。已修复 MIME 默认扩展名和 reply 映射，30 项运行时回归与构建通过。图片修复后的探针有成功回执，浏览器未再显示 unknown 普通附件，但当前 1×1 图片未取得可见解码证据，仍不标记图片显示通过。引用修复待加载新产物实机复测。

后续加载修复产物：`discordquote02` 在接收端明确引用本次探针原文，执行记录 confirmed；`discordrecall01` 撤回调用完成后记录 confirmed，浏览器回复消息不存在。图片探针升级为可见的 48×48 彩色棋盘 PNG，两份探针源码保持一致；`discordimage03` 接收端显示图片，DOM 读取实际解码尺寸 48×48，执行记录 confirmed。因此 Discord Gateway 白名单频道的图片、引用、撤回实机验收通过。

### KOOK 传输状态准备（2026-09-30）

补齐 RuntimeKookClient 对实际 SDK WebsocketReceiver.State 的只读映射，端点向框架提供 open、connecting、reconnecting、closed；未知 transport 保留未观测，不以 connect 返回推断在线。实际 SDK 状态转换与运行时回归共 23 项通过，构建通过。独立端口实机实例完成 WebSocket 连接及资源预加载，本地 readiness 返回 ready=true。仍待通过聊天入口验收新样本、受控故障恢复和媒体能力。

随后用户提供已登录的 KOOK 频道：浏览器发送 `browserkook01`，接收端显示真实回复，执行记录 confirmed 且 transportState=open、admitted=true；复发记录 blocked。受控故障、媒体和双账号仍待测。

### Slack 浏览器进阶验收（2026-09-30）

用户切回既有白名单频道后，独立实例发送 `browserslack01`，浏览器显示真实 Bot 回复且执行记录 confirmed；复发记录 blocked。`slackquote01` 虽有发送回执，但接收端出现 `[reply]` 字面量，没有关联原消息。已修复 canonical reply 到 Slack thread_ts 的映射；已有会话线程优先，文件上传随相同线程路由。24 项出站回归通过，实机修复复测待进行。Socket 传输状态仍未观测，不以文本发送成功冒充恢复验收。

加载新产物后，`slackquote02` 原消息出现一条回复，打开线程可见对应 Bot 的真实回复，引用以 Slack 原生线程语义通过。`slackrecall01` 撤回返回后记录 confirmed，接收端不再存在回复消息。`slackimage01` 上传有回执，但 SDK 警告 filename=image 无扩展名；已补齐 MIME 默认文件名并保留明确文件名，25 项出站回归及构建通过，媒体修复仍待实机复测。

再次加载产物后，`slackimage02` 接收端显示 image.png，实际解码尺寸 48×48，执行记录 confirmed，图片显示实机通过。旧样本 `browserslack01` 在新 PID 下记录 blocked，补齐跨进程探针去重证据。


### 飞书长连接与钉钉 Stream 接线（2026-09-30）

按实机验收需求新增飞书 `mode: websocket` 与钉钉 `mode: stream`，适配器默认保留 webhook 兼容，验收示例默认使用新模式。飞书采用已安装官方 SDK 1.67.0，等待 onReady 真实握手；钉钉实现官方 Stream 网关协议，以 WSS open 握手完成报告 open；实机纠正了将可选 REGISTERED 帧当作必需条件导致的误超时。两者复用统一 Endpoint Lifecycle 处理断线与停止，未修改用户 `.env`。

飞书 48 项回归与构建/Lint、钉钉 39 项回归与构建/Lint 通过。验收示例配置测试 3 项、启动入口 7 项、报告 21 项通过。应用账号已由用户创建，长连接模式的真实消息收发、重复消息与断线恢复仍待实机，不计为已通过。中文配置步骤见 examples/platform-acceptance-bot/WEBHOOK-ACCOUNT-PREPARATION.md。

后台实机接线：飞书长连接验证成功、单聊读取权限经用户确认开通、1.0.0 版本已发布且仅本人可用；钉钉机器人 Stream 配置已发布，修复握手判断后实例成功启动。两边聊天 ID 仍为 pending，尚未计入消息收发通过。


### LINE 验收入口与入站确认（2026-09-30）

新增 LINE 验收项目模式、模板和中文账号指南，未改真实 .env。修复 HTTP 回调提前确认：等待真实入站处理完成才返回 200；非空事件在关闭或处理失败时返回 503，畸形请求返回 400，空 events 验证请求保留 200。36 项本地回归、构建与 Lint 通过，尚无 LINE 实机证据。没有持久去重，多事件部分成功后的重投仍可能重复处理，不能宣称 exactly-once。


### 飞书与钉钉本地客户端实机（2026-09-30）

获得本地应用控制权限后，核验此前飞书消息发在同名全员群及智能体会话；正确应用机器人 zhin robot 私聊已入站。私聊验收出站返回 HTTP 400/platform_code 99991672；已修复平台拒绝被包装 unknown 的错误分类，并仅记录 status/code，15 项出站回归与构建/Lint通过。发送权限尚待补齐复测。

钉钉正确机器人私聊已入站，dinglive0001 在客户端明确显示 acceptance:dingtalk-a:dinglive0001，Stream transport=open/admitted=true。sessionWebhook响应缺少消息ID，执行记录保留unknown，不能据此宣称消息ID回执confirmed。复发同样本记录blocked，尚未覆盖跨重启/双账号/故障恢复。临时白名单通过启动参数传入，未改 .env。

独立启动边界修复：同步abort后throw可能使取消Promise产生额外unhandledRejection；先绑定Promise竞态再执行start。adapter 96 项本地回归、构建和Lint通过，普通CLI主错误输出不作为该缺陷证据。

### 2026-09-30 飞书与钉钉新增实机证据

- 飞书：后台 `im:message:send_as_bot` 已开通且发布。19:31 长连接私聊探针 `larklive0003` 获得真实回复 `acceptance:lark-a:larklive0003`，发送接口返回消息 ID，验收记录为 `confirmed`，耗时 710 ms。此前缺权限的拒绝不计为通过。
- 钉钉：Stream 进程由 PID 42113 重启为 49016；重放 `dinglive0001` 被持久化探针去重阻止，客户端仍只有一条该样本回复。新探针 `dinglive0002` 在客户端获得真实回复，证明进程重启后的收发恢复。sessionWebhook 未返回消息 ID，发送回执仍记为 `unknown`，不将客户端可见回复改写为接口确认。
- 以上仅证明私聊文本、钉钉进程重启和样本去重；群聊、媒体、双账号、网络中断恢复仍需分别验收。

- 飞书进阶实测（19:33–19:35）：重复 `larklive0003` 被阻止；`larkrecall0001` 客户端显示机器人撤回消息，撤回通过。引用探针实际显示字面量 `[reply]`，引用语义失败，已进入修复。图片上传缺应用资源权限，降级为字面量 `[image]`，图片验收失败；发送接口成功只证明降级文字已发送，不能算媒体通过。

- 飞书资源权限：经用户确认开通应用 `im:resource`，后台显示已开通且当前修改均已发布。19:37 `larkimage0002` 在客户端显示 48×48 棋盘 PNG，图片上传及发送实机通过；复合 text+image 的文字段未显示，混合消息保真仍失败，已进入修复，不计复合消息通过。

- 19:41–19:42 飞书修复后重启实机：`larkquote0002` 显示原生“回复 刘春浪”及原探针，引用通过；`larkimage0003` 同一消息显示 acceptance 文本与 48×48 棋盘图片，图文保真通过。飞书 58 项回归/build/lint 已通过。图片上传失败现为明确拒绝或未知，不再用文字代替冒充成功。
- KOOK 19:40 进阶实测：`kookquote0001` 未呈现引用；`kookimage0001` 仅显示 `[image]` 文本，两项失败，正在修复。验收报告已要求图片/引用/撤回有同目标、探针之后的可见证据；22 项报告回归通过。

- 19:45 飞书进程重启验收：PID 44587→69086，旧 `larklive0003` 在新进程记录 blocked，无第二条回复；新 `larkrestart0001` 在客户端显示对应回复，接口 confirmed、transport open、admitted true。此项证明进程重启后的收发恢复和探针持久去重，不等同于平台入站事件持久去重或网络中断恢复。

- QQ 本地修复：canonical reply 的 message_id 正确映射 SDK 引用；缺撤回接口或空原生 ID 明确失败，防止假成功。QQ/NapCat/OneBot11 聚焦 112 项回归通过，QQ build/lint 通过；双 Endpoint 隔离仍只证明本地测试，不升级实机状态。

- 用户已确认本地 QQ 三个测试会话：凉菜 BOT→OneBot11，蓝色机器人标识 zhin→QQ 官方，普通 zhin→NapCat。2026-09-30 19:49 QQ native automation getApp 连续超时，虽然 inventory 显示应用运行，当前不能自动发探针；会话准备完成不算进阶实测完成。Telegram API 代理入口配置 8 项 example 回归通过；初次沙箱内启动测试超时，允许本地监听后同一套测试通过。

- 19:51–19:52 KOOK 修复后实机：`kookquote0002` 展示原生引用的发送者与原探针；`kookimage0002` 同卡片显示文字和 48×48 棋盘图片。截图人工核验，两项语义通过。上传使用真实二进制 multipart，失败不降级假成功；45 项全包回归/build与6项上传合同回归/lint通过。

- 19:53–19:54 KOOK：新进程 PID 81157 重放旧 browserkook01 记录 blocked；新 kookrestart0001 实际收到回复，重启恢复及探针去重通过。kookrecall0001 记录 confirmed 但消息仍可见，撤回失败，已转修复；不能凭发送接口成功计撤回通过。

- Telegram Polling 可控真实网络恢复：19:59:17 tgnetworkbase01 获得客户端回复；专用 loopback fault-proxy 执行 cut 后 19:59:49–57 getUpdates 明确网络失败，未重启 Bot；recover 后 20:00:16 tgnetworkafter01 客户端收到回复。前后为同一进程且接口 confirmed。仅验证本次 API 代理连接切断恢复，不代表QQ动态gateway或其他平台已通过。

- 20:02 KOOK 撤回修复实机通过：kookrecall0002 发送成功，真实 channel 删除接口完成后客户端该回复消失；先前 kookrecall0001 未撤回的失败证据仍保留。SDK不存在recallMsg的optional noop已删除，改按会话路由调用实际channel/private删除方法；49项回归及4项SDK删除合同通过。

- 20:04 Telegram 私聊进阶实机通过：tgimage0001 显示棋盘图片和完整caption；tgquote0001 原生引用关联正确原探针；tgrecall0001 发送后删除，客户端不再显示回复。图文、引用、撤回可见证据已保留。期间一次自然getUpdates网络错误后仍继续收发，不替代已记录的受控断线证据。

- 能力结果分类修复：Core及两份实机probe将 `unsupported_operation + not_sent` 明确记unsupported；同code交付未知仍unknown，其他not_sent失败不变。62项回归、Core和example构建通过。高阶markdown/button/share探针与映射正在扩展，尚未计实机通过。

- 20:13–20:14 Telegram 高阶实机：tgmarkdown0001 实际显示粗体、inline code、Zhin链接及正确 &<>转义，Markdown通过。tgshare0001 显示正确标题、https://zhin.dev/链接与描述，仅证明HTML链接分享映射通过，不证明原生分享卡片。button尚未完成点击验收。

### 2026-09-30 高阶消息真实验收补充

Telegram `tgmarkdown0001` 的加粗、内联代码和链接已在客户端确认；`tgshare0001` 标题、URL、描述可见，表现为 HTML 链接分享，不能称为原生分享卡片。截图保存在本地忽略的 Telegram evidence 目录。

按钮 `tgbutton0001` 网络结果不确定，保留 unknown；新样本 `tgbutton0002` 原生按钮可见且在 60 秒内实际点击，但命令等待回调导致 Polling 无法继续处理 update：attempt 为 12:17:42.893Z，12:18:42.898Z 超时结果 callbackObserved=false，之后 20:18:43.689（本地时间）才收到对应 action 入站。这是实机发现的阻塞缺陷，不能算按钮通过。修复后需新样本重复真实点击验收。

Telegram 非阻塞观察器修复后，`tgbutton0003` 实际点击在 12:27:12.822Z 记录 confirmed、callbackObserved=true，命令早在 20:26:54.863 本地时间返回；重复点击后仍只有一条最终结果。KOOK `kookmarkdown0001` 加粗、代码与链接正确；`kookshare0001` 标题描述及按钮卡片可见，按钮打开 https://zhin.dev/（目标网站当前返回 404，URL 映射正确）。`kookbutton0001` 原生按钮可见，但 callback 被错误路由为 private:1910067219，保留未通过，正在修复。

KOOK 路由修复后新样本 `kookbutton0002` 于 12:35:00.686Z 记录 confirmed、callbackObserved=true，入站保留原频道与 guild parent。Slack `slackmarkdown0001` 客户端 b 标签/fontWeight=700、code 与链接正确，`slackshare0001` 原生附件标题/描述/URL 正确；`slackbutton0001` 于 12:31:44.129Z 真实点击回调 confirmed。Discord Markdown/分享 embed 均客户端可见正确，但 `discordbutton0001` 点击后显示“zhin Bot 未能及时响应”，62 秒结果 unknown/false，未通过并继续排查。

Discord 官方后台已确认旧 HTTP Interactions URL 与 Gateway 互斥；经用户明确批准清空并保存。补齐按钮 guildId 后，新样本 `discordbutton0002` 于 12:42:21.810Z 真实 callback confirmed，ACK confirmed，客户端无超时错误；重复点击结果仍单条。飞书已在原应用本人可用范围发布 1.0.1（仅卡片回调变更，无权限新增），订阅 card.action.trigger 长连接。`larkshare0001` 标题/描述/打开链接按钮真实可见；`larkbutton0001` 12:48:14.381Z callbackObserved=true/confirmed，重复点击不新增结果。`larkmarkdown0001` 加粗、链接和转义正确，但内联代码显示反引号原文，保留部分通过/待核验，不能称完整 Markdown 通过。

飞书 Markdown 切为 JSON 2.0 原生 markdown 组件后，`larkmarkdown0002` 客户端确认加粗、等宽背景内联代码、链接与转义正确，20:51:29.602 本地时间回执 confirmed。原样反引号缺陷已真实复测修复，截图 lark/evidence/zhin-lark-markdown-v2.jpg，已追加独立 operator observation。本轮 Telegram/Slack/Discord/KOOK/飞书高阶三项在指定私聊/频道范围实测通过，不外推为所有会话/传输/双账号均通过。

## 2026-10-01 实机后续证据

QQ实际平台预上传首片index1，SDK按index0公式上传空片。补丁依据完整连续分片集合兼容0/1起点，保留平台ACK序号并拒绝异常集合。安装后QQ136项本地回归通过；真实RGB与原RGBA上传/发送成功，客户端AX呈现图片节点。原失败记录保留。

钉钉、飞书均已通过专用透明TCP代理进行实际Stream cut/recover，同一实例重连后真实入站和回复恢复。仅覆盖Stream入站，平台HTTP出站未切断；钉钉sessionWebhook回执仍unknown。详见[当前实机验收与剩余项](https://github.com/zhinjs/zhin/blob/main/examples/platform-acceptance-bot/CURRENT-ACCEPTANCE.md)。

Slack/Discord受控故障入口继续并行调查，LINE重放/重复稳定性另行审查。NapCat本地桥无监听、账号B和Email/LINE实际入口仍未齐全，不能标全目标完成。真实.env未修改。
