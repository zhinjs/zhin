# Zhin 整体稳定性验收

本轮目标由适配器扩大到框架整体；原平台验收继续保留，见
[平台验收记录](../../examples/platform-acceptance-bot/CURRENT-ACCEPTANCE.md)。
不覆盖用户 `.env`，不调用未经配置与授权的真实模型，不发布。

## 范围与完成证据

| 范围 | 必须验证的行为 | 当前状态 |
| --- | --- | --- |
| Plugin Runtime / HMR | 代切换、失败回滚、旧代在途隔离、资源释放；真实 CLI 文件编辑、失败后旧命令可用与恢复 | stop、前缀与中间件操作快照修复回归通过；真实 CLI 在途旧代/新代交错、回滚恢复、exit 0 与端口关闭通过；100 次循环与 4 次回滚完成，exit 0、端口关闭，活动资源无累计；有限约 135 秒观察，长期生产趋势未验证 |
| 命令 / 中间件 / 组件 | 结构化参数、权限拒绝、异常传播、并发隔离、取消迟到结果、统一出站 | 结构化前缀与复用投影操作快照已修复；新旧权限 Host 隔离回归通过；实际 CLI 新旧代交错、回滚恢复与退出通过 |
| 配置 / 定时 / 存储 | 无效配置、停止与取消、持久化和失败边界 | 配置事务与调度 claim 竞态已修复；真实 SQLite 三进程持久化、回滚、重开与关闭后独占锁通过，均自然 exit 0；外部数据库未配 |
| Host / Console | 控制面契约、消息与端点投影、生命周期及授权边界 | HTTP 终态与文件管理真实路径修复完成；实际 CLI HTTP/MCP 与独立双进程 A2A JSON-RPC/REST/SDK 调用通过，exit 0/端口关闭；既有远程 Console 页面渲染已见，当前源码 UI 与远程 MCP/A2A 租户未验证 |
| 可选 AI / Agent | 会话隔离、工具策略拒绝、取消与失败恢复、安全边界 | 工具取消、缓存、跨模块投影与工具操作快照已修复；实际 CLI/MCP 两代本地工具交错通过；独立 tarball 的公共 AI 入口与本地循环通过；已安装 TS CLI 真实启动/命令本地AI循环/退出通过；无TS纯JS启动与会话修复后单包重打包验收通过；真实模型未验证 |
| 平台适配器 | 原验收中的进阶消息、双账号、重启去重、故障恢复及新增平台 | 实机状态以平台表为准；三项新 API 代理本地回归完成；非 Telegram 账号 B、桥恢复、LINE、钉钉卡片权限与部分 API 故障实机仍缺证据 |

所有通过结论须标明测试层级：本地 fixture、真实本地进程、真实平台或真实模型。
完成要求是上述覆盖清单明确、已复现问题修复并回归、代表性真实运行证据与未验证限制记录完整；当前尚未完成。

## 下一轮验收入口

2026-10-08 已恢复推进：飞书 OpenAPI 基线、断网、恢复后三阶段均已入账；用户确认基线仅一次，并确认收到恢复后的回复。恢复后单次计数及旧消息未补发仍待核对。当前源码 Console 连接、实时事件、命令/Endpoint浏览器验收已通过；桥及其他真实账号入口仍未完成；历史 10-01 的阻塞记录保留为旧阶段，不能代表当前飞书进度。

- 本地必要验收：真实 CLI 在途与切代、100轮循环及回滚、HTTP/MCP/A2A、AI实际安装均已有代表性证据。24h/72h属于建议升档标准，不能无限延长本轮完成条件；真实远程入口另列未验证。
- 已有账号：Slack、Discord、KOOK 专用 API 代理实机基线、连接切断、unknown、恢复与新样本已通过；继续飞书 OpenAPI 实机验收。上述连接切断不证明平台已接受 POST 后丢失响应的交付边界，本地 TLS fixture 也不代替真实平台证据。
- 用户准备：NapCat/OneBot11 桥恢复、非 Telegram 平台账号 B、LINE 账号与回调、钉钉互动卡片写权限；不把缺少入口计为产品通过或失败。
- 可选服务：真实数据库与模型验收须有已配置且获授权的入口；当前保留未验证状态。

此处是当前目标的剩余验收清单。用户提出修改目标后，新方向尚待明确；不会将已完成子集直接改写为目标完成。

## 2026-10-01 本轮记录

- 12:03 近期修复组合中央回归：HTTP Host、A2A、pagemanager、AI会话/锁与Core复用operation投影合跑21文件185项全部通过；架构/反向依赖/Agent域边界门禁通过。
  该组合验证修复之间的本地兼容性，不能填补飞书OpenAPI实机、当前源码Console浏览器连接、账号B/桥/LINE或真实模型入口的缺证据。继续按原范围完成审计，避免无限扩展新增验收。

- 12:01 无TS纯JS安装验收中央完成：独立bare consumer的真实tarball pagemanager与当前build哈希一致，父核验virtual store无typescript@。PID79168/18685认证401/401/200，公共 `/hello` 返回 bare-js-installed-ok，exit0/signal null、端口关闭。
  惰性compiler保留同步API和optional peer；实际编译缺TS才明确报错。中央pagemanager全包3文件10项通过，build/lint已通过，证据 `bare-runtime/results.json` 与artifact.json；未增加默认IM依赖。

- AI会话修复后实际tarball验收完成：独立consumer公开MemoryAgentSessionStore并发同key同epoch；父重新计算tarball SHA256及installed session-store.js与当前build匹配，`post-session-fix.json`通过。
  仅重打包AI包，旧37包证据与原CLI74752保留；新CLI76424认证/命令本地AI循环/exit0/端口关闭再次通过。无真实provider调用。
  当时无TS纯JS路径尚待验收；后续12:01独立bareconsumer已通过，见上方记录。

- 11:58 已安装CLI真实运行中央验收：独立consumer PID74752/18684，无认证/错误认证401、正确认证200，stdin `/localai` 通过公共Command→`zhin.js/ai`确定性agentLoop返回 installed-cli-local-response并正常agent_end，同时Agent公共入口可导入。
  精确SIGINT退出code0/signal null、端口ECONNREFUSED。当前.ts fixture显式安装固定TS编译依赖，不证明无TS的JS启动缺口已解决；没有真实provider/model调用。
  原先TS缺失与fixture漏zhin manifest失败另存attempt1/2，原始 `test-results/ai-install-artifacts/runtime/results.json` 与cli.log保留；会话修复后的AI单包重打包与JS无TS路径继续验证。

- AI会话并发修复收尾：实例owned按session_key锁，Memory同epoch、真实SQLite仅1条active记录、Persistent失败释放及其他key独立通过；中央两文件9项通过，扩展4文件25项通过/1外部PG跳过，build/lint通过。
  `test-results/ai-session/creation-concurrency.md`记录仅单Store实例保证，跨进程原子性未验证；相关AI包需单独重打包复测。
- 已安装CLI首轮真实runtime启动exit1：Console链静态加载标为optional peer的TypeScript，help无法覆盖此路径；consumer prod/autopeersfalse无TS复现。
  TS模板本有devDependency，本次.ts fixture须显式补固定TS；纯JS无pages启动仍静态要求optionalTS是独立产品合同缺口，交Console agent修惰性装配，不能靠补fixture依赖掩盖。
  首轮退出/网络观察不足不作为端口泄漏证据；后续真实权限与端口验证单独记录。

- 11:54 安装后AI阶段中央核验：真实IM18/AI37个相关workspace包均canonical realpath在独立consumer内，公共可选入口通过，本地确定性agentLoop仅一次provider调用并正常agent_end；CLI help加载成功，runtime启动仍待验收，不把help当完整链路。
  无真实provider网络或模型推理，此证据固定修复前打包快照；后续AI源码修复需重新构建相关包与补tarball验证。
- 同轮AI会话新缺陷中央复现：MemoryAgentSessionStore同新session_key的两次并发getOrCreateActive返回不同session_id/epoch；4项旧回归通过、新并发用例失败。
  已安排Memory/Persistent单实例按key锁修复与不同key/失败释放回归。未宣称跨进程数据库原子约束或真实模型会话验证。

- 安装验收新增两个脚本的 Node 语法检查通过；ESLint配置忽略scripts，不能将其exit0记为有效lint覆盖。AI消费者仍未完成固定版本安装/CLI启动，不增加通过结论。
  在等待真实账号和浏览器答复期间，另行审查AI同会话并发、取消迟到写入与存储失败边界，先最小复现，暂不修改当前打包冻结的生产源码。

- AI 安装阶段推进：canonical consumer 比较修正后，IM档18个workspace tarball包realpath全在独立消费者内、公共入口probe通过。
  AI档离线安装遇 ai7.0.44 的 ERR_PNPM_NO_OFFLINE_META，本机缓存元数据缺失；保留失败，按固定版本从公开registry继续独立安装，不改根lock或调用模型。
  已增加验收要求：CLI `--help` 不代表runtime启动，须补已安装最小plugin的真实HTTP投影与正常退出；若没有真实模型仅记录本地确定性AI循环证据。

- AI 安装观察器第二轮误判中央确证：临时consumer路径 `/var/...`，模块realpath `/private/var/...`，比较未canonicalize consumer使实际独立安装被误报workspace污染。
  正式facade实际位于canonical consumer的node_modules；IM probe已验证默认入口不含AI，`zhin.js/agent` 与 `/ai` 缺依赖明确 ERR_MODULE_NOT_FOUND。修正比较并保留该失败记录后继续；未提前计AI档/CLI通过。

- AI 安装后首轮：37包相关闭包build/pack完成；IM消费者 offline install 因 sandbox EPERM 写既有pnpm store失败，未到probe。此为环境写权限，不能计产品缺陷或安装通过。
  attempt1结果/log保留；允许仅离线本地tarball缓存写入后继续，不因观察超时重启。消费者去除NODE_PATH/NODE_OPTIONS污染，并逐个已装workspace包确认realpath位于独立consumer，不借workspace源码证明安装。
- 飞书基线 `larkapibase0001` 当前ledger无匹配事件，未切断API，继续等待人工真实消息。

- 飞书原白名单恢复准备完成：PID55436/g1/HTTP18185、长连接已建立，18590/control18591 API代理forwarding/cuts0；父只读ps核验进程存活。白名单匹配历史唯一成功会话为true，仅进程覆盖，不改.env。等待人工基线，不计收发或故障验收通过。
- 安装后AI实际脚本已执行 `scripts/check-ai-install-artifacts.mjs --build`，37包相关闭包构建后将pack/独立offline消费者安装；消费者验证不能仅导入workspace。结果仍在运行，未提前标通过。

- Console 当前认证fixture PID52002/session68144/58850保留待浏览器验证。真实HTTP公开health200、认证状态/命令200、无认证状态401、官方origin CORS正确；Chrome只见health请求发出，无response/failed，连接pending，未宣布UI通过或定性本地网络权限故障。
  已询问用户可见浏览器权限提示；不绕过访问权限，不更改既有远程认证。此前tokenless fixture49972正常exit0。
- 飞书历史白名单已通过既有持久 conversation_events 与6条confirmed ledger哈希交叉确认唯一原private会话；仅用于临时启动覆盖，不接纳陌生会话，不修改.env，探针仍未开始。

- 11:44 当前源码 Console fixture HTTP 证据中央复核：`/pub/health`、`/api/system/status` 与命令投影200，CORS允许官方Console，Darwin/Node24进程及 hello/card 两命令可见；原始安全结果 `test-results/console-ui/fixture-http-read.json`。浏览器实际连接仍独立验收，HTTP成功不代替UI。
- AI 安装后链路开始实际tarball闭包与独立消费者 IM-only/可选AI 两档验证，不使用workspace源码链接或真实模型；分档SSOT门禁、打包闭包5项回归通过，真实安装结果仍待完成。

- 飞书 API 准备状态核验：旧实例精确核验后停止，新实例PID51533/HTTP18185/g1与独立API代理18590/control18591已启动，代理forwarding；尚未发探针或切断。
  当前用户配置 `LARK_TEST_CHAT_ID` 为 pending，属于会话ID获取模式、不会回复探针，不能计基线就绪。只允许复用历史已成功的原白名单做临时进程覆盖；未修改.env，尚待历史确认及用户手动探针答复。
- 官方 Console 新独立 profile 空 token 连接被前端要求输入 token，尚未发请求；已保留实际限制截图。继续采用独立fixture生成凭据，不读取用户认证、不保存登录信息，不将旧部署渲染计当前源码UI通过。

- A2A 最终补强：独立 server48283/client48284 增加 REST SSE、终态错误及 SDK Card 发现后调用，两进程 exit0/signal null、端口关闭；7文件34项/build/lint通过。前一成功46565与首轮失败分别保留，最终证据 `test-results/a2a-process/acceptance.md`。
- 飞书实机入口阻碍已核实：原生 `com.electron.lark` 界面读取调用挂住约966秒后中断，未取得可操作状态；期间未开API代理/未发探针/未改.env。改为准备独立实例与代理、请求用户手动发送三阶段探针，不虚构实机通过。

- 11:39 A2A 修复中央验收完成：7 文件34项通过。独立 server46565/client46568 真实 HTTP 请求鉴权401/401/200，JSON-RPC 完成/查询/失败/运行/取消，以及 REST 文本 `local-echo:rest-hello`、已装 SDK RestTransportFactory 文本 `local-echo:sdk-rest` 均符合预期。
  REST 请求/响应与 Card 使用公开 fromJSON/toJSON，正式相对路径支持并保留旧 `/v1` 别名；wire 无内部 `$case`，SDK 内部枚举数字属于解析后的对象，不能与 wire 混淆。
  两进程自然 exit0/signal null、18683端口关闭，首轮失败另存 attempt1，证据 `test-results/a2a-process/`。这是本地双进程协议验证，不代表远程租户或真实模型。
- Remote Console 既有登录页面只读渲染成功，实际连接既有远程 Linux 部署，状态与能力页截图已留存；不能证明当前本地修复版 UI 链路，继续隔离当前 CLI fixture 验收。

- 11:37 文件管理构建产物独立复测：与原始越界复现相同的临时项目/外部文件/`src` 符号链接，正式 lib API 读取与覆盖均明确 Access denied，外部 fixture 内容保持不变，进程 exit 0，临时目录删除。
  三项路径 fixture、HTTP 全包129项、build/lint 与 changeset 已收尾；未接触真实 `.env`。静态 symlink 越界问题修复完成。

- 11:36 Console 文件管理修复中央收尾回归：HTTP Host 全包 8 文件 129 项通过，相关 lint 通过；覆盖外部目录/叶子链接、新增文件父目录、dangling 链接、受禁目录别名、文件树与 env 存在性枚举，合法项目内链接仍可读写。
  这是静态路径及普通操作边界的验证，不证明对抗同机恶意并发替换路径的文件系统沙箱；构建产物与独立脚本复核继续收尾。A2A 协议修复的真实双进程复跑仍待结果。

- 11:35 A2A 真实本地独立 server/client 首轮发现 REST 协议缺陷：正式文本 parts 请求返回 200，但执行器收到空 prompt；响应与 AgentCard 泄露 SDK 内部 oneof `$case` 和枚举数字，未按正式 JSON 转换。
  JSON-RPC 鉴权 401/401/200、完成/查询/失败/运行/取消链路通过；REST 首轮失败不算全项通过。server40218 自然 exit 0、client40219 exit 1、18683 端口关闭，原始证据在 `test-results/a2a-process/`。
  已安排公开 SDK fromJSON/toJSON 边界修复与真实网络复跑，不使用外部租户或模型。
- HTTP 完整包中央阶段回归：126 项通过，新增文件边界两项在修复前如期失败，继续用于验证已复现问题；不能将这一开发中结果写成全包绿色。

- 11:33 HTTP Host 终态修复中央复核：关闭后拒绝 `listen`、并发监听共享结果、关闭等待在途监听；真实 TCP 两文件 22 项通过，构建产物独立 Node 关闭后重开被拒绝并自然结束。
  首轮网络测试因沙箱 EPERM 失败，放开本地监听权限后复跑通过，未将环境失败计为产品回归。
- 同轮新增 Console 文件管理符号链接越界复现：临时项目 `src` 指向临时外部目录，正式 `readProjectFile` 与 `saveProjectFile` 均越出项目根目录；外部 fixture 被读写，测试后删除。
  不涉及用户真实文件或密钥。已交由独立 agent 修复真实路径边界及新增文件父目录校验，尚未标通过。

- 11:30 新增真实 HTTP Host 生命周期复现：独立 Node 对随机本地端口先 `close()` 再 `listen()`，仍重新绑定 54644；第二次 `close()` 返回已缓存的完成结果，监听未关闭，进程残留。
  观察进程 session31654 已精确 SIGINT 停止（退出 130，不算正常关闭通过）。已交由 Host agent 修复终态拒绝重开及启动/关闭竞态；此项尚未回归通过，不涉及用户配置或业务实例。

- HMR：watcher disposer 可异步返回，原 stop 未 await，同步抛错还跳过在途 reload drain。
  修复后即使清理失败也等待已接纳 reload，并保持重复 stop 的 promise 与结果一致。
  Runtime / Plugin Runtime / CLI 生命周期聚焦 39 文件 252 项本地测试、Runtime build 和改动 lint 通过。
- 命令：文本匹配 trim 前导空白，而结构化 prefix 去除没有同步处理，图片参数因此回退成纯文本。
  修复保留结构化参数；命令权限失败、中间件并发错误、组件显式 signal 取消等聚焦 9 文件 206 项本地测试、Core build 与改动 lint 通过。
  取消证据只针对组件显式 signal，不代表任意作者任务都能强制取消。
- Console：`pnpm exec vitest run basic/cli/tests/plugin-runtime/console tests/contracts/console-endpoint-contract.test.ts`，15 文件 80 项通过。
- Stable 首跑被沙箱 `listen EPERM` 阻断（15 项失败，8 个异常）；允许本地回环监听后同一命令重跑，46 文件 576 项通过。
  不能将环境失败计为通过，也不能从这次失败直接判定产品缺陷。
- Host：`pnpm exec vitest run packages/host/http/tests packages/host/mcp/tests packages/host/a2a/tests`，18 文件 174 项通过。
  其中 HTTP 覆盖 demo 不得写配置、发消息、读环境与项目文件，以及 token 主体绑定/撤销/到期。
  这是本地契约与本地监听测试，不能代替远程 Console UI 或真实外部 MCP/A2A 对接。
- AI/Agent：异步文件/cwd 策略检查期间收到取消，原实现等 allowed 返回后仍启动工具。
  在策略 await 后重查 signal，新增受控策略 gate 回归确认工具未执行。
  安全策略/工具运行/队列等聚焦补充跨会话回归后，中央重跑 16 文件 203 项通过；Agent build 与改动 lint 通过。
  不承诺撤销已经提交的工具副作用；没有调用收费模型或验证跨进程存储。
- 真实 CLI：在 `/tmp` 无凭据 minimal-bot 副本，PTY 启动，独立 loopback 18671；watcher 编辑触发 generation 2 并回复 `HMR_REAL_V2`。
  故意引入语法错误后 esbuild 报错，原进程仍回复 V2；恢复后 generation 3 回复 `HMR_REAL_V3_RECOVERED`。
  card 输出包含 RSS/Heap；Ctrl+C 正常退出 0，数据库正常断开。
  此轮裸命令 hello/card 成功，文档所示 /hello /card 未匹配；仍须解决这个合同差异，不能将这项问题略去。
- Agent 确定性端到端：`packages/im/agent/tests/plugin-runtime/agent-runtime.test.ts`、`tests/ai/zhin-agent.test.ts`、`tests/core/agent-loop-standalone-deferred.test.ts` 共 3 文件 38 项通过。
  使用真实 AgentCore、会话与本地工具，模型流为确定性假应答；覆盖结果/journal、主体身份、并发绑定、审批拒绝及挂起模型取消。
  这是 Vitest 源码链路，不是发布包安装、真实 CLI 或真实 Provider HTTP 验收。
- AI 文件缓存：缓存过的文件被超限新内容替换时，原实现保留旧内容且扣掉字节，后续删除还能令计数为负。
  新回归旧码返回 `old` 实际失败；修复为超限替换同时删除旧视图，12 项聚焦回归、AI build 和改动 lint 通过。
- 调度：外部 store.claim 等待期间 stop/cancel/pause，迟到成功仍启动 handler，已复现；修复后重查运行/任务状态并释放 claim，回归与构建验收中。
- 配置：同一个 JsonConfigDocument 的同 revision 双事务并发 commit，旧实现两者都成功并覆盖。
  已加入对象内部 mutation queue，后者重新核 revision 并报 conflict；回归与构建验收中。
  这不提供不同 Document 对象、外部编辑器或跨进程的 OS 级 CAS。
- 中央配置/调度/数据库与 schedule/http Host installer 回归：55 文件通过、1 文件跳过，484 项通过、7 项跳过。
  跳过项为未配置的 live 数据库方言；不能据此声称远程数据库互通通过。
  调度还在补 timer/reconcile 同任务并发 claim 的证明，配置与调度构建结果待收尾。
- `pnpm check:l4-ci` 通过：L4 确定性子集 13 文件 159 项，附带 Workroom SSOT 22 文件 161 项。
  明确以 `L4_SKIP_PLATFORM=1` 运行，Provider 使用本地契约，不是新增真实平台或真实模型证据。
- 静态门禁：architecture、harness-paths、domain-module-boundaries、runtime-config-boundaries、plugin-runtime-api 与 llm-runtime-boundaries 通过。
  门禁证明依赖/API/配置边界规则满足，不能替代运行时行为验收。
- CLI 前缀修复后的 Stable 中央重跑：46 文件 577 项通过（包含新增能力 owner 前缀回归）；真实 CLI slash 命令验收待 agent 收尾。
- 调度并发补充：通过 public timer/reconcile 路径，claim pending 时推进多个 reconcile 周期，仅一次 claim；handler pending 时仍仅一次执行、没有提前 release；完成后释放一次。
  中央重跑 late-claim 与配置 concurrent-transaction 共 2 文件 7 项通过，覆盖停止/取消/暂停、claim 拒绝、并发领取与配置事务冲突恢复。
- 配置与调度最终全包验证：49 文件 342 项通过，两包 build、变更 lint 通过；README 与 patch changeset 已记录保护范围。
  配置文档对齐与枚举检查分别 12 项、5 项通过。
- CLI 前缀修复后实测完成：真实 `/hello`、`/card` 成功，generation 2 回复 V4，语法错误继续回复 V4，恢复 generation 3 回复 V5；Ctrl+C exit 0，独立端口关闭。
  前缀根因是 Core 将平台 literal 当 PluginId；现在通过 snapshot 能力 ID 找 owner，没有平台字符串 fallback。
  证据在 `test-results/runtime-cli/acceptance.md`（本地忽略目录），记录启动参数与源码解析边界：CLI lib 入口 + development 条件解析当前 Core/Runtime 源码。
  Core plugin-runtime 143 项、prefix/minimal 71 项、Core build 和改动 lint 通过。实跑没有构造在途阻塞请求，旧 lease 隔离仍由本地回归证明。
- 本轮框架/适配器组合回归：Runtime、Plugin Runtime、Core runtime、缓存、配置、调度以及 11 个适配器测试目录，198 文件 1558 项通过。
  这项总数不包含完整 AI/Agent 和 Host 全套，不将组合测试称为全仓测试。
- 10:16 入口复核：NapCat 本机 3000 端口 ECONNREFUSED；LINE 三个必要变量未配置（只输出存在性）。
  CLI 验收 18671 端口 ECONNREFUSED，确认停止后监听关闭。用户 `.env` 未改动。
  非 Telegram 双账号与桥/LINE入口仍待用户准备；独立推进 Discord/Slack/KOOK/飞书出站 API 故障边界审查。
- 出站审查正在验证 SDK 隐式重试：Slack WebClient 默认重试/限流队列，Discord REST 默认重试可能重发已提交请求；用真实 SDK + 本地 HTTP 请求计数确认和修复，不提前声明已消除重复投递。
  KOOK 的 5xx 错误分类与钉钉/QQ 交付边界同时审查中。
- 继续真实 CLI 有限重复热更新耐久性验收，单次回滚通过不代表资源在重复代切换后不会累计。
- 本轮框架修复已补 patch changeset：`framework-lifecycle-command-cancellation.md` 与 `config-schedule-admission.md`。
  仅记录后续发布需要的包与修复说明，没有执行版本升级或发布。
  HMR/缓存/工具取消/Core runtime 四个修复相关文件中央聚焦回归 118 项通过。
- 出站 SDK 中央实测：Slack、Discord 真实安装 SDK 对本地 HTTP，响应丢失/500/429/拒绝四种情况分别验证请求计数始终 1，共 2 文件 8 项通过。
  Slack 显式关闭重试与限流排队，Discord 分别关闭 REST 重试与限流排队；不修改 TLS 校验。
  此处证明本地 SDK 发送次数，不是已通过真实平台出站故障。
- 钉钉 HTTP 403 原记 unknown，QQ 同时返回非零 code 与 id 原误记 sent；均已复现并修复，完整两包回归中。
- 钉钉/QQ 出站最终验证：27 文件 216 项通过，两包 build 与改动 lint 通过。
  真实安装 QQ SDK 对本地 HTTP 的 403、完整 POST 接收后断线、200 缺 ID 均仅提交一次，分别 rejected/unknown/unknown。
  sessionWebhook 不保留原始错误响应；真实平台实际落地与卡片可见性仍需实机证明。
- 有限 CLI 循环首轮启动失败、0 代完成；隔离项目链接了根 node_modules，后续解析发现它不等于 minimal-bot 的完整 workspace 依赖链接。
  已核对当前 Core manifest 无 tool 引用，不能从首轮错误断言当前 Core 缺依赖。正在改隔离项目链接并重测；不改用户安装与 manifest。
- QQ SDK outbound failure 与钉钉 runtime 中央复核 2 文件 24 项通过；完整两包结果与 focused 结果分开记录，不累加当作新增覆盖数。
- 飞书 outbound-http 与 outbound-receipt 中央复核 2 文件 24 项通过，覆盖断线、500、408、429、403、业务拒绝，以及缺少确认的回执。
- CLI 循环原始 JSON 已记录 20 次成功代切换，每轮 5 条 hello、2 条 card，4/8/12/16 轮语法错误后旧代各回复两次。
  最终观察脚本报 `CLI exited early`，日志末尾是 Database disconnected；退出码与监听关闭仍在核验，不能将此记录直接当完整耐久性通过。
- 循环最终证据：`test-results/runtime-cli/cycles-attempt3.md` 与 JSON/log 独立留存；100 条 hello、40 条 card、8 条回滚旧代回复均与请求一致。
  精确进程消失、64413 端口关闭确认；Node 退出码未保留，记 null，不凭日志补 exit 0。
  RSS 暖机与 GC 后约 103–118 MiB 波动，短样本不证明长期无泄漏。
- 四平台出站收尾：Slack/Discord/KOOK/飞书全包 51 文件 315 项、四包 build、改动 lint 通过；adapter-docs 20 平台同步检查通过。
  真实本地 HTTP 21 项确认各仅一次 POST，包含 KOOK HTTP 500 正文错误码不能覆盖 HTTP unknown 分类。
  实机 API 故障尚未通过，继续实现 Slack 专用 TLS 出站代理入口；现有 WSS 入站代理不能代替它。
- Slack 实机入口重新核验：当前浏览器频道与 `.env` 白名单一致（仅输出比较布尔值），旧专用实例 PID 32682/session 51860 仍活着。
  新样本 `slackapiprepare0001` 实际入站、sent、客户端显示 `acceptance:slack-a:slackapiprepare0001`；截图 `/tmp/zhin-slack-api-prepare.png`。
  此实例是先前启动版本，本条只证明当前真实入口与基线可用，不证明本轮 no-retry 或尚未接入的 API 代理已实机生效。
- Slack API 代理 18560/control18561 已启动，透明转发到 slack.com:443；旧专用实例精确停止且正常退出，新实例 session63066/HTTP18187 已连接。
  新样本 `slackapitlsbase0001` 实际入站后 `dispatch_miss`，未回复。runner 明确生成 `commandPrefix: !`，正在复现 Core 前缀与验收命令合同差异。
  此前旧版本基线通过不能覆盖这次失败；尚未进行 API cut，代理保持 forwarding，未改 `.env`。
- Slack 专用 API TLS 最终本地验收：18 文件 122 项通过，build/lint/adapter-docs 通过；中央单独复核 TLS 8 项通过。
  独立受信 CA 的错误 SAN 证书被拒绝且 HTTP 计数 0；保持 slack.com SNI 与 rejectUnauthorized=true。
  本地服务收到完整 POST 后 cut 仅一次发送，recover 不自动补发；默认配置仍直连，Socket 入站独立。
  当前实机 command dispatch_miss 尚未解决，因此不执行 cut/recover，也不提前宣称实机出站通过。
- expanded Endpoint 前缀回归已修复：slot 直查失败时通过同代 AdapterIndex.owner(fullEndpointId)，不拆 opaque ID、不将平台名充当 PluginId。
  新回归真实扩展两个 Endpoint，分别 !/# 前缀命中 acceptance；208 项聚焦回归、Core build/lint 通过。
- Slack API 实机 cut/recover 完成：新实例 session23246，baseline `slackapitlsbase0002` sent；代理 cut 后 `slackapitlscut0001` 仍实际入站，ECONNRESET→delivery_unconfirmed；recover 后旧样本客户端回复数 0，新 `slackapitlsafter0001` sent 且回复数 1。
  代理连接计数 3→4，整个期间同一 runtime session，Socket 入站独立；恢复后代理为 forwarding。
  截图 `/tmp/zhin-slack-api-recovered.png`。这是实机连接拒断与恢复，不能代替平台接收完整 POST 后丢响应的实机证明；后者仅本地 TLS fixture 覆盖。
- 2026-10-01 10:42 收尾复核：Stable 47 文件 581 项通过；新增代理启动配置 6 项通过；KOOK 实际 SDK TLS 8 项中央复核通过。
  Slack 事件账本三个样本的结果分别为 confirmed / unknown / confirmed，均为 PID 57272、generation 1，与浏览器回复 1 / 0 / 1 对应。
  Discord 与飞书所需 undici 6.28.0 已统一安装，保留现有 KOOK/QQ SDK 补丁；两平台代理的最终回归仍待结果。此轮未修改用户 `.env`。
- 10:43 三平台代理收尾：Discord 全包 11 文件 82 项、飞书全包 12 文件 77 项、KOOK 全包 17 文件 75 项通过，三包 build 与改动 lint 通过。
  中央专门复核 KOOK TLS 8 项、飞书 TLS/配置 5 项、Discord TLS/配置 10 项通过（属于全包子集，不相加计算覆盖）。
  代理默认关闭，保留官方 Host/SNI 与证书校验；完整 POST 后断线只提交一次、保持 unknown，恢复不自动重发，手动新样本成功。
  飞书架构/依赖门禁、Discord adapter-docs 同步检查通过。三平台此项均为本地实际 SDK/TLS fixture，尚无真实平台 API 故障验收证据。
- 10:45 飞书生命周期补测：实际 loopback TCP 对端接收连接但不完成 TLS 握手，transport.close 后请求拒绝、对端 socket 关闭，后续请求明确 stopped。
  专用 TLS 文件 5 项与改动 lint 通过；文档链接检查 245 文件通过。此项是停止期间的资源释放证明，未触碰真实平台进程。
  正在并行补真实 CLI 旧代在途请求与更新交错，以及真实本地 HTTP/MCP Host 的鉴权、请求、退出验收；结果未回报前不标通过。
- 10:48 SQLite 实际子进程：正式 Registry API 写入后重开读取；失败事务回滚、后续事务成功；第三进程取得独占写锁后正常提交。
  三个进程自然 exit 0、无超时，数据库 build 与脚本语法检查通过。复跑入口 `scripts/database-acceptance/sqlite-real.mjs`，原始输出与数据库在 `test-results/database-real/2026-10-01T02-48-03-635Z/`。
  未改现有数据库或 `.env`；该项不证明外部数据库方言，原 7 项 live 跳过仍保留。
- 10:48 实际 CLI Host 第二轮：HTTP 与 MCP 无/错 Token 均 401、正确 Token status/initialize 200，精确进程 exit 0 且端口关闭。
  工具 list/call 虽 HTTP 200，却返回 JSON-RPC -32601 Method not found，因此工具执行不算通过，继续核验注册/配置合同。
  第一轮观察脚本只匹配 dev 日志而未识别 no-watch 正式 JSON started:true，导致假 readiness timeout；原尝试独立保留，未当作产品启动失败。
- 真实 CLI 在途交错候选缺陷：旧 WAIT_V1/g1 跨命令文件 HMR 后回复一次，新 HELLO_V2/g2 与恢复 HELLO_V3/g3 正常；未变更的出站 middleware 却持续报告 g1。
  正在最小复现 operation Generation View 与复用投影构造时 snapshot 的差异，未提前标修复。旧请求重复计数脚本首轮将四条合法出站混算，原失败记录保留。
  直接改 plugin.ts 返回 restartRequired 属当前 loader 显式边界，不能当能力文件 HMR 成功；未变更的根 resource 仅 shutdown dispose 一次，不据此要求代切换时提前释放。
- Slack API 实机截图已从临时目录复制到本地忽略目录 `.acceptance/slack/evidence/20261001-api-cut-recovered.png`。
  同目录 `20261001-api-cut-ledger.json` 保留六条脱敏 attempt/result 字段（不含目标、账号、Token），对应 confirmed / unknown / confirmed 与同 PID/generation，避免临时截图清理导致证据丢失。
- 在途上下文根因定位：Core 中间件 wrapper 已取得 operation snapshot，但 MiddlewareIndex.run 仍只用构造 snapshot。
  拟显式传入操作快照，保留旧请求的旧代上下文；修复与新旧代并发回归尚在进行，不使用裸 latest 单例。
- MCP 正式 built 条件重测仍然 tools/list 与 tools/call 为 -32601，排除仅 development 条件导致的假象。
  CapabilityIngress 的 constructor prototype 检查疑似将隔离模块的正式 ToolIndex 误判为空；正在用隔离投影确认并修复。HTTP/MCP 鉴权与退出证明有效，工具执行仍未通过。
- 10:54 中间件操作快照修复完成：Core 显式将当前 operation snapshot 传入 MiddlewareIndex.run，新链使用当前代，旧延迟链保持旧代。中央 2 文件 71 项通过，agent middleware/Core build 与 lint 通过。
  实际 CLI `lease-inflight-fixed.json/log`：PID 85861，g1 WAIT 跨 g2 hello 更新后只回复一次；新命令 middleware 为 g2，旧 WAIT middleware 为 g1；失败候选回滚仍 g2，恢复为 g3。
  不变根资源 shutdown dispose 一次；精确 exitCode 0、端口 58565 关闭。证据只覆盖该能力文件更新与该共享资源，不泛化为任意强制取消或长期无泄漏。
- 10:56 MCP 投影修复与实际 CLI 通过：四类正式投影采用版本标记 guard，代加载模块不再被静态 constructor prototype 误判；中央隔离模块/能力 seam/Host tool/MCP 4 文件 7 项通过。
  实际 CLI PID 88890：HTTP/MCP 无或错 Token 401，合法请求通过；tools/list 含 echo 与隔离验收工具。默认 echo 保持审批拒绝 isError:true，纯本地 acceptance_echo 返回 `accepted: host-real-echo`。
  精确 exit code 0/signal null、18681 端口关闭。`test-results/host-process/results.json` 与原始日志保留；未启用真实模型或覆盖用户配置。
  CommandIndex/ComponentIndex 同类构造快照风险已分别最小复现，新 operation 的 project/use 仍旧值；正在扩展显式操作快照传递，不将中间件修复泛化为已全部解决。
- Command/Component 操作快照实现已落地：Core 命令 dispatch 与组件 render 显式透传 snapshot；复用索引的新链 generation/project/use 与旧延迟链分别绑定新旧资源。
  中央 command/component/middleware 与新复用投影回归 4 文件 66 项通过，新增权限 Host 差异回归及真实 CLI 最终观察收尾仍在执行。
  实际 CLI 首轮已观察到仅组件 HMR 后未变命令为 g2、命令 HMR 后未变组件与 card 为 g3、旧 wait 为 g1 一次；退出 observer 发生 poll race 误报 earlyexit，原 JSON 保留，不改写成自动通过。
  MCP 空工具集合另发现合同缺口：声明 tools capability 却不安装 tools/list handler；正在补正式空集合/未知调用处理，既有有工具真实验收不替代该边界。
- 11:00 Command/Component 收尾：普通命令与 shortcut 的新代权限拒绝不执行、旧代延迟许可完成后执行一次，中央两文件 57 项通过。
  修正退出观察脚本后仅复跑一次真实 CLI，`lease-command-component-confirmed.json` 为自动 passed：PID 92326、旧回复一次、exit 0、60071 监听关闭；原 failed 观察记录保留。
- MCP 空集合收尾：实际 CLI PID 92741，tools/list 返回 []，未知调用 -32602，HTTP/MCP 鉴权继续满足 401/401/200，exit 0、端口关闭；中央 MCP/隔离投影两文件 7 项通过。
  六包 build、相关 65 项回归与 changeset 登记完成；没有执行发布。
- 本轮修复后 Stable 黄金路径：47 文件 584 项通过。该命令覆盖 IM 黄金路径及指定适配器，不是全仓或完整 AI/Host 测试。
  ToolIndex 构造快照仍在按独立证据核验：不将 Command/Component 的修复直接泛化成工具已解决，也不扩大到未经授权的真实模型。
- ToolIndex 同类问题已确证：真实 NativeDevelopmentModuleRuntime 投影被两代复用，新 Ingress 的工具执行仍返回旧 generation/config/resource/project；旧在途保持旧代本来正确。
  正在由 ToolIndex.execute 接收显式操作快照、Ingress 透传绑定快照，不采用 latest 单例；审批、权限与 turn scope retirement 保留。
- 四平台 API 代理中文操作指南已追加到 `FAULT-PROXY.md`：固定官方 TLS 上游、独立入口、环境启动覆盖、cut/recover 与证据边界。
  文档链接检查 245 文件通过，未改 `.env` 或实际进程；此文档更新不构成新增实机证据。
- Tool 操作快照修复聚焦回归：中央 5 文件 45 项通过，Tool/Agent build 通过。
  父独立执行真实 NativeDevelopmentModuleRuntime 复用投影脚本：同投影旧 pending 返回 g7/旧配置/旧资源/旧 projection，新调用返回 g8/新值，scope retirement 继续拒绝执行。
  这是实际模块加载与本地工具链路，尚不能替代正在执行的真实 CLI/MCP 热更新请求交错验收；没有真实模型调用。
- Tool 真实 CLI/MCP 热更新尝试：PID 1232，未编辑工具，仅 hello 命令变更；工具模块 call 计数连续，新调用 g2/新命令投影，旧调用 g1/旧投影；精确 exit 0/signal null、18682 关闭。
  后续时序核验发现临时 tool 未声明 wait inputSchema，SDK 将 wait 参数剥离，因此这一轮不能证明真实在途等待，也不能据此断言 Host handoff 的等待行为。
  该轮独立保留，正在修正正式 Schema 并断言延迟实际生效后复跑；并发隔离已有 Nativeprovider 双 snapshot 回归证明。
  首轮观察器解析过早响应失败、SIGINT 退出且 code null，已独立保留；不能补算 exit 0。修复后的真实结果单独记录。
- Tool 最终真实交错完成：PID 3585 的正式 Schema 包含 wait:boolean，marker 已进入后才改命令文件。
  旧 call2 在 1790824000168–1790824002169 等待 2001ms，仍返回 g1/旧命令投影；新 call4 在 1790824000280 已返回 g2/新投影，确实早于旧请求完成。
  同一工具模块 call 计数连续，未重载工具；精确 exit 0/signal null、18682 端口关闭。最终原始 JSON/log 与前三尝试独立保留。
  中央 Tool/Agent 五文件 46 项通过，覆盖当前 owner 图解析及退休调用范围保护；此为本地真实 CLI/MCP，不代表真实模型或远程 MCP 客户端对接。
- 工具最终机器 marker 补证：PID 5461 的旧请求 marker 入场后才编辑命令，旧调用等待 2002ms，新 g2 响应早 1891ms 返回；exit 0 与端口关闭。
  最新 `tool-hmr/results.json/log` 保留 marker、开始/完成时刻；PID 3585 的前一成功记录另存 attempt4，不覆盖为新进程。产品改动已收尾。
- KOOK API 实机专用实例已启动：PID 5911、HTTP18286，18580/18581 代理 forwarding；父只读核验进程存活及代理 connections119/cuts0。
  用户既有 Chrome 白名单已匹配，目前资源预加载，尚未发出已确认 baseline，不把代理连接计数当平台收发通过。
- KOOK 实机启动复现修复交互缺陷：PID 5911 预加载 blacklist 403 被新错误规范化转为 typed EndpointDeliveryError，旧容忍逻辑只识别 SDK 字符串前缀，实例退出 1。
  未进行 baseline 或 cut/recover。修复仅兼容 init 内 getBlacklist 的明确 permission 403；其他接口 403/500、网络错误及运行期黑名单调用仍抛出。
  中央 startup-permissions/outbound-http 两文件 12 项通过，完整包构建及重新实机启动仍在收尾；原启动失败保留，不要求扩大账号管理权限。
- KOOK 预加载修复全包收尾：17 文件 78 项、build/lint 通过，patch changeset 已登记；PID 5911 失败的安全摘录独立保留。
  新实例 PID 9771/HTTP18286，父只读核验存活与代理 forwarding、connections258/cuts0；仍等待真实 baseline/result/client 证据，不凭存活宣布收发通过。
- KOOK API 基线实机确认：正式 ready 后 `kookapibase0002`，账本 confirmed、PID 9771/g1、628ms；父复核 screenshot 底部对应机器人回复可见。
  `evidence/20261001-api-baseline.png` 本地忽略保存；已切断独立 API 入口，WSS 保留，cut/recover 结果仍待核验。截图广告弹窗需在最终可见证据中关闭，不凭基线标完整故障验收通过。
- KOOK API cut 阶段确认：新样本 `kookapicut0001` 实际入站，账本 unknown、PID 9771/g1、4ms，WSS 入站保留。
  父核验同进程仍存活，代理已恢复 forwarding、connections259/cuts1；观察约 50s 未见旧样本补发，恢复新样本的客户端/账本证明仍待完成。
- KOOK API 实机最终通过：base0002 confirmed、cut0001 unknown、after0001 confirmed，均 PID 9771/g1；父复核 recovery 截图新回复一次、旧 cut 无回复，约100s观察无补发/二次attempt。
  代理最终 forwarding、connections260/cuts1。完整六条 ledger、中文说明与无广告遮罩截图保存在 `.acceptance/kook/evidence/20261001-api-*`，用户 `.env` 未改。
  这是新连接拒断及恢复，不冒充平台接收完整 POST 后丢响应。Discord 专用 API 实机下一项已开始准备。
- Discord API 实机启动：既有 Chrome 频道与 `.env` 白名单比较为匹配，精确停止旧自有实例后新 PID19833/HTTP18188 正式 ready。
  代理18570/18571 forwarding、connections1/cuts0。父账本核验 `discordapibase0001` confirmed、PID19833/g1；客户端基线与 cut/recover 最终证据尚待收尾，不将启动当故障验收通过。
- Discord API cut 阶段：`discordapicut0001` 实际入站且 ledger unknown/7ms、PID19833/g1；Gateway 未切断，客户端未见回复。
  代理恢复 forwarding、connections2/cuts1。旧样本观察与新 `discordapiafter0001` 回复仍待最终证据，不将 cut 通过写成全部恢复完成。
- Discord REST API 实机最终通过：base0001 confirmed、cut0001 unknown、after0001 confirmed，均 PID19833/g1；父复核客户端 recovery 截图基线与新回复各一次、cut 无机器人回复。
  账本与截图独立留存 `.acceptance/discord/evidence/20261001-api-*`。此项证明新连接拒断/恢复，不证明平台收到完整 POST 后丢响应，也不证明账号 B 隔离。
  飞书 OpenAPI 代理实机下一项开始准备；不覆盖 `.env`、不扩大应用权限。
- 本轮工具修复后 architecture 与 harness-paths 门禁通过；正在准备 KOOK 独立 API 代理实机验收，尚无新增通过结论。

- 11:34 中央核验真实 CLI 100 轮结果：PID33141，134.68 秒，100 次有效切代、4 次语法失败回滚，500 hello、200 card、8 次回滚后旧命令回复均符合计数；自然 exit 0、54266 端口关闭。
  `test-results/runtime-cli/cycles-100.json/log` 保留原始证据。采样活动资源为 5/6 项（TCP 探活 socket 瞬态），未累计；第11–100轮 RSS 91.1–234.4 MiB、末轮110.4，heapUsed 86.9–153.1 MiB、末轮94.6，出现回收波动。
  此有限约135秒运行不证明长时间生产无泄漏；原20轮退出码缺失记录仍保留，未改成新结果。

- AI会话creationLock初步中央回归：Memory同key返回同epoch，session-store与session-write-lock两文件7项通过；Persistent同key/失败释放/不同key并行的专项证明仍在补，build与重打包尚未完成，不提前标全修复通过。

- 12:05 完成审计：按原计划和覆盖表核证，未发现可不依赖外部入口继续修复的必要本地缺口。剩余需用户操作或账号/服务恢复，不新增持久LINE inbox等未承诺合同。
  父再次只读核验飞书基线ledger无事件、NapCat3000连接拒绝；保持待验收，未将缺入口当产品失败或通过。当前整体目标仍未完成。

### 2026-10-08 飞书 OpenAPI 断网与恢复

专用 TLS 代理 18590/control 18591 的三阶段真实探针，均由 PID 43854/generation 1 处理：基线 `larkapibase0001` confirmed（用户确认客户端仅一次）；切断新连接后的 `larkapicut0001` unknown；恢复后的新探针 `larkapiafter0001` confirmed。账本每个样本各一条 attempt 和 result，当前无旧样本重投。代理已恢复 forwarding，服务继续运行。用户已确认收到恢复后的 `acceptance:lark-a:larkapiafter0001` 且只有一次；旧断网消息是否补发仍待客户端核对，不能据此声明完整客户端验收通过。证据：`examples/platform-acceptance-bot/.acceptance/lark/evidence/20261008-api-ledger.json`。此项只覆盖 API 新连接切断，不覆盖平台已接受完整 POST 后丢失响应；未修改用户 `.env`。

- 2026-10-08 09:16 后续观察：飞书同一运行 session 出现长连接 closed，约5.5秒后 reconnect ok；API代理只读状态 forwarding/connections3/cuts1。此为日志级重连证据，尚未用重连后的新消息核验收发。Console Chrome测试标签仍可列出，但两次绑定均在焦点控制阶段超时；历史58850端口当前无listener，不能引用旧实例作为当前浏览器通过证据。

- 2026-10-08 当前源码Console浏览器验收已取得：独立PID68987/g1，官方UI dashboard与实时事件已连接，health/status/stats/introspection/SSE均200，hello/card目录正确。证据test-results/console-ui/20261008-*。旧pending记录不代表当前状态。插件0/0按现有排除root统计合同成立；minimal terminal未声明transportState导致离线展示，已复现，样例修复及回归进行中。

- 2026-10-08 minimal terminal 状态修复完成：实例状态随activate/open、readline自然close/closed、清理/stopped变化，非交互outbound模式也在线。stable-path 8/8、minimal build及两文件lint通过。独立新PID78618/58850实际HTTP endpoints total1/online1，浏览器Endpoint显示online且实时事件已连接；证据test-results/console-ui/terminal-state-fixed-20261008.json、20261008-terminal-online.png。改动仅minimal样例及聚焦回归，未改共享Core在线语义。旧fixture管道Ctrl+C返回1，不能声称原Node raw exit0；端口关闭已实测，限制保留。

- 2026-10-08 剩余实机入口复核：既有NapCat地址不携带凭据GET连接拒绝；OneBot11地址同样去除userinfo/query后只读GET返回503，尚未验证WebSocket。LINE凭据与会话字段未配置，NapCat/OneBot11及钉钉B会话/凭据字段未配置（仅输出存在性、不读取凭据值）。继续验收需要用户恢复桥或配置账号入口；这些不计产品通过/失败。已请求用户选择下一批准备项。

2026-10-08 用户确认NapCat仅一个账号：继续单账号断线重连、重启去重、消息组件与高阶能力验收；不要求新增NapCat账号B。双账号隔离保持未验证，不能借单账号结果声明通过。当前需恢复既有桥入口。
