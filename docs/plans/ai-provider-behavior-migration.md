---
sidebar: false
---

# AI Provider 更新：行为迁移与验收对照

本文记录目标接口替换时必须保留的外部行为，以及退役接口断言的去向。它不是实号验收报告。固定候选提交后的完整门禁、Console 交互、归档安装与独立审查结果单独记录；局部测试通过不能代替这些项目。

## 权威与调用路径

| 原路径／断言 | 目标路径 | 保留的行为与本地证据 |
| --- | --- | --- |
| AIService 注册 Provider、ModelCatalog、runtimePolicy override | Host 事务图 → `ModelRuntimeService` → `InferenceOperationScope` | 空图能构造 Agent；实际请求未配置则报错；每个 operation 固定图，新回合读取当前图。`agent/tests/model-runtime/{ai-service,target-runtime,runtime-policy}.test.ts`、`ai/tests/provider/operation-snapshot.test.ts`。 |
| Provider SDK 实例／secret resolver 缓存 | Exact Driver lease + 每次请求私有 grant + 无能力的 binding resources | 不缓存 token／fetch／Session；同绑定纯缓存跨回合复用；旧 generation 最后一次 operation 释放前不销毁。`ai/tests/{provider/runtime,model-catalog/runtime}.test.ts`、`cli/tests/plugin-runtime/inference/host.test.ts`。旧 SDK 构造器数量不再是目标行为断言。 |
| 模型目录与 allowlist | Service 中经 Driver 校验的 ModelDefinition | 不靠模型名授予能力、不扩大显式模型列表；未知工具／媒体／streaming 能力不冒充支持。`ai/tests/provider/requirements.test.ts`、`agent/tests/model-runtime/legacy-model-allowlist.test.ts`。 |
| 旧 Provider 默认降级 | 固定 Profile／native model | 明确失败不跨模型；识图只沿明确配置链尝试。`agent/tests/model-runtime/legacy-vision-selection.test.ts`、`purpose-parameters.test.ts`、`ai/tests/providers/subscriptions-wire.test.ts`。 |
| Profile／Preset Session 长期选择 | 持久 ProfileSelection 身份 + 短期 ProfileRef | 同 Profile 参数或 native model 更新后，已有 Session 下一回合跟随；在途保持原图。Account/incarnation 变化使旧选择失效。旧模型 opaque state 不进入新模型。`agent/tests/model-runtime/target-runtime.test.ts`、`cli/tests/plugin-runtime/inference/session-state.test.ts`。 |
| 分层与角色选型 | canonical purpose selection | 保留 Session > 场景 > Endpoint > Adapter > 默认的已开放项；摘要与旁听不借个人密钥；角色引用明确 Host Profile；source provenance 与实际选择同一次计算。`ai/tests/provider/graph-selection.test.ts`、`agent/tests/model-runtime/{runtime,runtime-policy}.test.ts`。 |
| Child 使用父 Provider／由 Message 重建权限 | spawn 同步 retain 父真实 lease，child 独立 scope | 排队时父回合结束不取消 child；HMR retirement 不当业务 abort；队列失败／未开始取消／执行异常均释放；已显式关闭父 scope 不能再派生。`agent/tests/model-runtime/delegated-lifecycle.test.ts` 和 SubagentRuntime 原队列／取消用例。 |
| schedule、HTTP、A2A、Workroom 等辅助入口裸取 Provider | Host 正式 `withModels`／held snapshot 入口 | 真实任务 operation、Session key、principal／配额归属不伪装 IM 消息；Workroom 披露按真实 Service ID 匹配。各 Host／Workroom 组装测试与 `agent/tests/plugin-runtime/subagent-turn-capability.test.ts`。 |

## 工具、权限、结果与状态

| 行为 | 回归覆盖 |
| --- | --- |
| Plain completion 保留调用者配额、共享额度分摊、reservation 与异常释放 | `agent/tests/plugin-runtime/ai-completion.test.ts` 原行为断言迁为正式 scope，没有删除配额／并发／错误断言。 |
| Command／Tool 使用真实 operation 执行上下文，`has/use` 不提前请求 | `feature-kit/tests/operation-resources.test.ts`、`core/tests/plugin-runtime/im-operation-resources.test.ts`、Command／Tool context tests、Host `inference/operation-resources.test.ts`。输入 JSON 的同名字段不能创造权限。 |
| Driver schema、Model capability、调用要求与权限分别守约 | `ai/tests/provider/requirements.test.ts`、`ai/tests/providers/schema.test.ts`、Host `inference/profile-schema.test.ts`。声明 false／unknown 的 toolCalling 不发送工具 schema；Profile 已知不支持项保存前拒绝。 |
| SDK prompt family 与 progressive loading 不因移除 SDK 字段而丢失 | `agent/tests/model-runtime/target-runtime.test.ts` 真实 Anthropic Driver → ModelRuntime → 主 Agent → 已安装 SDK 本地 HTTP 请求，检查 Anthropic prompt 段、resident schema 与 `defer_loading:true`。既有 deferred-controller/catalog tests 继续保留。 |
| 框架隐式采样／输出上限不覆盖 Profile | `agent/tests/model-runtime/purpose-parameters.test.ts`：真实 summary／chat approval → Scope → Codex mock SSE，无隐藏参数；普通 OpenAI Profile 的温度／输出上限确实上 wire。Host `ambient-profile-model.test.ts` 对旁听做同样的真实用途检查。显式插件不支持参数仍报错。 |
| Codex 协议拥有私有稳定缓存路由，框架不再生成通用 key／retention | `agent/tests/model-runtime/driver-cache-routing.test.ts` 主 Agent 请求检查；普通显式 API 参数由 Driver 负责拒绝，不能静默覆盖。缓存关闭的原有语义独立保留。 |
| Opaque state 只能在精确账号／模型／协议／Session 范围续用 | `ai/tests/provider/state.test.ts` 经过真实 serializer 往返；target-runtime 实际旧 Profile 改模型后的 history 请求检查。可读文字和真实 tool call ID 保留。 |
| stream 有背压、单消费者、提前停止与未消费释放 | `ai/tests/provider/runtime.test.ts`、SDK pull stream tests。OwnedRun 不是无界 producer queue 的外包装。 |
| 已确认成功／原始错误不被 cleanup 或同刻 abort 覆盖 | `ai/tests/provider/runtime.test.ts` 与 `ai/tests/model-catalog/runtime.test.ts`；observer 同步／异步失败均不改变结果或制造 unhandled rejection。继续发送消息／执行工具仍由各业务路径检查自己的取消信号。 |
| 配置提交未知不等同失败，token refresh 未知不盲重放 | Host `inference/{repository,account-runtime,apply-contract}.test.ts`；receipt／graph／加密 credential 原子仓储及 revision/incarnation CAS。Mock transport 不能证明供应商实际兑换语义。 |

## 数据、配置与安装迁移

- 纯离线编译器位于 `agent/src/migration/provider-plan.ts`。只接收已读取的非秘密元数据，不读文件、环境或凭据，不调用网络。输出 alias plan、明确 Profile 映射、私有来源 locator、Workroom Service 映射与 blocked 项。
- `agent/tests/migration/provider-plan.test.ts` 覆盖旧模型 allowlist、角色、摘要继承、识图顺序、参数优先级、单项旁听、多候选待选择、显式 image model／等价 image 参数、Workroom、未知字段与 private locator。旧授权和同名别名不自动继承。
- 公开 preview fingerprint 覆盖 plan、locators、映射与 blocked；它不是秘密内容一致性证明。真实源版本由 Host 读取边界盖章，提交时重新核对源版本／选中范围并在事务内重封装。任意 HTTP sourceRevision 声明不能充当证据。
- 普通 Console／doctor 修复不再把旧 `driver/api/defaultProvider` 改写成另一套已废弃配置。`scaffold-wizard/tests/project-config-plan.test.ts` 明确原 AI 块逐项保留。旧源通过受认证的显式迁移预览处理，不要求用户先删除旧配置。
- 向导写入 `ai.plan.yml`，明确询问 tools／streaming／input，未知保持未知。`target-runtime.test.ts` 覆盖生成 plan → 正式 review → 主 Agent → 已安装 OpenAI SDK 实际工具请求。
- `scaffold-wizard/tests/project-deps.test.ts` 覆盖 API Key、订阅产品及 OpenCode 的明确协议对应 optional SDK。纯 IM 安装不引入 AI。
- 新作者接口／最低配套版本见 [公开升级说明](../ai/provider-upgrade.md)。版本号是未发布计划；本任务不 bump、发布或部署。旧 `SdkProviderAdapter`／Catalog／model-policy exports 已退役，不以兼容门面继续运行。

## 验收证据分层

1. 确定性源码／类型测试验证选型、权限、生命周期、请求体和错误含义；本地 SQLite／HTTP fixture 验证真实仓储和传输组装。
2. 真实 tarball consumer 验证 package exports、声明文件和安装闭包；它与源码 aliases、workspace symlink、构建产物 consumer 是不同层次。
3. `eval:agent` 是 scripted/mock transport 回归，不是模型质量实测；nightly 是独立授权的真实供应商路径。本轮不得因环境里存在 key 而自动调用。
4. Console 必须以独立合成 Host 交互验证；node 渲染字符串测试不能替代。最终完整 CI 与未参与实现者审查基于固定候选提交，不能把未追踪测试遗漏的空 scope 称为通过。
5. 真实 OAuth 账号接受、供应商计费／缓存命中及部署结果尚须单独授权，没有这些证据就明确标为未验证。


## 最后边界核对

- 正常启动配置不接收 `ai.plan`；向导只写独立 `ai.plan.yml`，管理员显式 review/apply，数据库是唯一推理配置权威。
- 旧 `ai.decisions.approval` startup 安全标签随旧字段移除；其他 self-change 安全标签与断言保留。新的部署级审批用途只能通过认证 Host operator 管理与事务修改，个人主体不能修改 deployment purposes；不新增 Agent 自改审批的工具通道。
- 旧全局 SDK/alias runtime、ModelRegistry、ProviderConfig 目录配置出口已删除；底层 completion/event 消息协议与真正无状态转换工具保留。纯合成测试 callback adapter 不创建 SDK、读取凭据或发现模型。
- 取消排查曾假设 OwnedRun 存在互等，实际单例与 Fetch 契约修正未支持该结论，未据此修改状态机。后续原生 SSE＋强制 GC 对照确认：临时 Request follower 信号及最终 Request 对象各有生命期；SDK transport 在自身执行归属中保持最终请求至结算，并使用真实 SDK 信号，dispose 时清理。具体 Driver 测试证据单列，不将 mock 成功或本地 GC 结果称供应商验证。
- Chat eval 复用持久图与正式 headless Host；只装配官方纯 Driver 声明，不加载用户 setup／dotenv。`--model`／`--judge` 为 Profile ID，判断模型参数来自所选 Profile；原 timeout／429 节流／总评测预算保留。公开报告只列显式参数，未返回的供应商默认值不推测。


## 公开门禁契约替换

- `check:api-surface` 当前直接出口快照通过；`check:plugin-runtime-api` 首跑准确报告本次批准的 operation 资源接缝新增：FeatureKit 的受控资源 view、Core 的 IM operation 工厂端口、Agent 的实际 Tool operation 端口与共享用量归属 helpers。已逐项核对其执行作用域、权限／quota 与 lease 责任后更新导出快照，未放宽脚本或删除断言。
- 退役 `ResilientCompletionOptions.fallbackModels`、`ProviderResilienceConfig.fallback` 与候选循环／事件，任何错误仍固定已选模型。配额、余额、server、流内 error、取消、empty/malformed 同模型重问断言保留；旧跨模型成功断言改为同一调用次数／原错误／无第二模型请求。媒体感知明确 Profile 链独立保留。
- Profile 执行控制红例：maxRetries=0/global=1 曾发 2 次，Profile=1/global=0 曾只发 1 次。修复通过已验证 Driver metadata → 既有 resilience，保 global→Profile→harness 顺序；整 attempt 的 retry/timer 只属于外层，向下传零关闭重复预算。详细服务错误不再无证据宣称“已自动重试”；普通用户／主人原场景表达边界不变。


## 固定候选前的发布范围复核

本次 changeset 只声明 patch，不执行 bump／发布。按实际 source／manifest／包内文档变更，明确覆盖 21 个可发布包：AI／AI Provider／Agent／CLI，FeatureKit／Command／Tool／Core 及其受控 Context 消费者，Database JSON 存储、A2A／Workroom／HTTP Host／Console client，scaffold／create-zhin。纯测试变动的 adapter 不额外声明。公共升级表由本次实际 Changesets status 的 oldVersion/newVersion 对齐，不把 HEAD 尚未包含的 WIP 漏掉；新增 AI Provider 在当前计划下首发为 1.0.1，尚未发布。完整基线／候选差异将由 Root 的固定 SHA 门禁与独立 reviewer 验证。

## 独立审查后的子任务作用域修复

- 原候选 `0315ba0a6` 已为子任务保留独立语言 Model bundle，但 standalone 的工具执行仍继承父回合 ALS。永久集成测试在父回合释放后复现：语言继续正常，生图／决策 Driver 均未执行，工具得到已关闭 operation 错误。
- 在子任务真实 Models 生命周期内重绑配置与决策 ALS；生图、识图和决策只使用子任务自身的 client／resolver。决策禁用标记在 spawn 同步准入时捕获，角色选择不改变原发起人的权限、配额或所有权；在途仍固定原图和实际 generation lease。
- 子任务的 decision observations 在自己的 ALS finally 中收集，通过现有 finish 成功／错误事件携带，使用子任务 turnId，不写入父回合；没有新增事件种类、审计表、通知或保留策略。
- `delegated-side-inference.test.ts` 覆盖真实 Subagent → standalone → builtin 生图工具与结构化决策，父完成／HMR 后的实际 Driver 调用、原发起人／图版本、禁用策略、取消后的观测保留与最终资源释放。与原生命周期、决策、Subagent 回归合计 5 文件／42 测试通过。都是合成 Driver 的本地集成证据，不代表真实供应商验证。
- 类型负例保留 `@ts-expect-error`，用 `void evidence.applied` 正确消费不允许的字段访问；未禁用 lint 规则或删除负断言。完整固定候选门禁由 Root 另行重跑。
- CI 同次指出的迁移新增 duplicate／unused imports 已做纯 import 合并与移除未使用类型；聚焦 ESLint 为零错误／警告。保留逐条退役负类型 import 的 duplicate 警告，以免一个错误掩盖另一个意外恢复的 export。eval:chat 的旧 non-null／any、Command 的旧 escape 和 Workroom 的旧未用 helper 均可在 `d8532ddbf` 找到，不借本次修复改其行为或放宽规则。

### standalone 错误终态：独立批准的修复

- **基线证据**：`git show d8532ddbf:packages/im/ai/src/llm/agent-loop.ts` 的既有 catch 已把 transport throw 转成 `AssistantMessage.stopReason = 'error'`／`errorMessage` 并继续发出 `message_end`；同基线 `core/agent-loop-standalone.ts` 在 `errorMessage` 存在时生成错误文本，但返回值不包含终态；同基线 `subagent/subagent-runtime.ts` 对 runner 的正常返回统一发 `status: 'ok'`。固定 Provider 候选仍是这条链，Provider 端口替换没有创建这个错误转成功的分支。
- **原代码本地红例**：真实 Subagent → standalone → agentLoop 在已完成两个合成工具后模型普通 throw，语言层记录错误文本，子任务 finish／delivery 仍为 ok，已报告的 8／3／11 用量被错误响应零值覆盖。AIService 丢失终态，Worker 返回 ok，Workroom 接受带 error 终态的合法 JSON，均有独立入口红例。这是结果分类缺口，不能称模型／任务成功。
- **消费者与风险**：`SubagentSystem.composeSender()` 将 ok 投影成 ResultSink 的 completed；`buildSubagentUserDelivery()` 会显示“完成”；`persistSubagentResultToContext()` 把该状态存入父会话，auto-continue 两种状态都会唤醒主 Agent，并把状态提供给它决定下一步。activity-feedback 的 finish 仅结束进度；Trace 的 subagent_end 仅保存上游给定状态。未找到按此状态自动重放原 Subagent 的确定性队列逻辑，但主模型看到状态后可以再次编排工具／spawn，因此错误分类修复不能同时新增自动重试。
- **相邻边界**：deferred-worker 同样消费 standalone 返回值并按迭代数判 ok／partial；`AIService.runAgent()` 公开结果亦未携带终态，Workroom planning 再解析 JSON。它们是共享 runner 的既有受影响路径，需要一并核验，不能只改 Console 展示或只让 Subagent catch 抛错而丢失已完成工具和用量。
- **批准范围与实现**：用户另行确认后，在固定 Provider 候选 `7ece79fbd16ee7519d9a309a801eb912cd76b535` 上建立独立 `feat/agent-terminal-outcomes` 分支。共享 runner 返回可选 `terminal: { stopReason, errorMessage? }`；仅从实际观测的最后模型响应投影，不把运行取消或迭代用尽伪装成模型 aborted。Subagent 把 error／aborted 映射到已有 error，Worker 保留已有 ok／partial／error 枚举和原轮次上限策略；合法空 stop／length 的原展示策略不变。AIService 透传窄终态，Workroom 在 JSON.parse 前拒绝 error／aborted，即使正文为合法 JSON。
- **取消与副作用**：取消仍原样 reject 调用方 reason（包括 DOMException、非 Error 对象），不包装异常、不修改 reason。既有 callbacks 增加同步 `onInterrupted(snapshot)`，由 task owner 保留已观测结果；数组／记录／usage 被复制，晚到 I/O 不修改已交付快照。快照正文仅包含已经观测到的响应，不承诺尚未返回的流增量。`toolCalls` 只表示已观测结算结果；记录缺失不能证明未执行，不新增 pending 状态、不重放工具。Subagent 错误／取消回传保留已观测正文与工具结果，沿既有 finish 的 result 字段提供结果摘要，不创建事件、表或保留规则。
- **用量**：只相加每条 message_end 中已有的归一化 usage 与已有识图 usage，错误响应的零值不再覆盖先前已报告用量；不新增 Trace、UsageEvents 或账本，也不推算未报告费用。Subagent owner 每 task 至多汇总一次，包括取消路径；观测失败不替换业务终态或触发重跑。
- **延迟补全**：另发现原 agentLoop 的 re-completion catch 吞掉 transport 失败。限定修复只为实际 complete 失败发送同主路径合同的 error／aborted 消息并保留最终 emitted 证据；工具／上下文组装错误不会伪装模型失败。失败合成消息不加入下一次 wire context，原工具消息与结果保留；下一轮仍按原次数执行，未增加 retry／break／fallback。
- **继续保持的边界**：Subagent 既有两种状态的 auto-continue 规则不变；Worker 原 error 不自动续聊的规则不变。不改工具审批、配额、重试、安全策略与模型选择。未知副作用内容保持原样；验证均使用合成 Driver／本地 SDK transport，不含真实供应商调用。
- **部分正文与同步工具**：最终 error／aborted 没有正文时，保留本次运行最后一次已观测的非空正文，错误原因独立在 terminal 中；不拼接全部历史。用户明确确认同步接口统一结构化返回，Runtime／System 的 spawnSync 返回同一次执行的窄 `SubagentSyncResult`，不保留第二个兼容方法。公开同步边界实际投影 status／result／toolCalls／terminal，剔除任务／Origin／Message 等路由数据。spawn_task 保持可读字符串和同步标记，依据 typed status 显示成功或失败，不从正文前缀猜状态，不把工具 args 整包塞回模型。新接口属于计划中的 Agent 1.1.47 配套 patch（未发布）；旧字符串接口支持上限为 1.1.46。
- **真实主路径相邻影响**：原共享 loop 吞掉延迟补全失败，使主 Agent 误认为段尾仍是成功的 toolCalls。实际 runAgentLoopTextTurnRun 对照中，write_file 有真实进展、段上限 1、extendBy 0、autoContinue on：固定 Provider 基线发出 4 次请求（工具、失败补全、checkpoint、续段）；新错误事件使既有 gate 在第 2 次请求后停止续段，并沿既有友好错误回复。未修改 Main 的续段政策／阈值，不能声称所有上层调用次数都不变；共享 loop 自身未耗尽时的原定下一轮仍照常执行并可成功覆盖终态。
- **文本消费者**：任务 owner 使用同一纯格式化函数把必要错误原因合入既有结果正文，原非空正文继续保留。错误原因放在已有 Worker 摘要／artifact 预览可能截断的正文之前，不增加上限；只有原因已在正文开头（原文或 Error 前缀）时才省略前置原因，不能因尾部也出现同一原因而让它被截掉。同步工具不再次拼接原因。真实 async Subagent → 父会话 persist／ResultSink 测试同时断言部分正文、失败原因与 failed 状态；不会把原工具 args、整个 Error 或 opaque 状态写入这些文本。

| 验收 | 预期与实际证据 | 结论与未覆盖 |
| --- | --- | --- |
| 已执行副作用后的模型错误 | Subagent、Worker 各真实执行工具后模拟模型 throw；错误状态、unknown 原文、已报告用量保留；工具不重放 | 本地合成链路通过，不代表真实供应商副作用或计费验证 |
| 取消 | 原 DOMException／对象 reason identity 不变；已观测正文与结算记录快照不被晚到响应修改；同步／异步 observer 失败不替换结果 | 不承诺 SDK 从未返回的增量；缺少工具结果不证明未执行 |
| 同步公开接口 | 实际 System → Runtime → runner → spawn_task；结构化结果只含四个允许字段，JSON 不含 Origin marker；失败不再宣称完成 | 用户批准的接口变更，最低版本是未发布计划号；未提供兼容入口 |
| 共享补全与 Main | loop 末次补全失败有 error 证据，原定下一轮仍可成功；安装的 SDK mock wire 保留配对工具历史；Main 原代码 4 请求／新代码 2 请求，工具均一次 | 保持两层证据独立，不把 mock 当模型行为或供应商实测 |
| Workroom | error／aborted 正文即使是合法 JSON 也在解析前被拒绝；stop／length 原解析行为保留 | 没有更改规划策略、预算或自动重试 |

- **首个固定候选 8be6 的实现者本地检查**：AI／Agent 全目录加本次 Workroom 入口共 449 文件：447 通过、2 跳过；4,297 测试通过、10 跳过。Groq 实号 opt-in 明确关闭，未调用真实供应商。CLI 真实依赖图构建 44／44、根 type-check、改动范围 ESLint、doc-links、doc-orphans、diff-check 均通过。完整仓库固定候选门禁和未参与实现者的最终增量审查由 Root 另行验证，不用这组局部检查替代。
- **二审限定修正**：原去重条件只检查正文任意位置包含原因，实际 Worker 80 字摘要和 Subagent 默认 artifact 预览均能截掉尾部原因，已先复现两个红例。改为仅在原因已经位于开头时去重；保留整个原正文、不增加摘要或 artifact 上限。聚焦该边界与既有终态路径共 8 文件／46 测试通过，根 type-check 与改动范围 ESLint 通过；原 reviewer 的 Worker 探针仍仅 1 次请求且摘要可见原因。未重跑全目录以冒充集成验收，最终合并 DB 独立分支后的完整门禁另行验证。
- **环境与证据保留**：首轮受限 sandbox 的 SDK 生命周期三例有超时／loopback listen EPERM，保留原失败记录；原 10 秒门禁、相同断言在允许本地 loopback 后两文件 16／16 通过，最终上述全目录亦通过。没有为此修改 Provider、超时或断言。全部证据仍是本地合成 transport／已安装 SDK，不是 CI、发布、部署或真实模型行为验收。

### Agent 归档作者声明检查

- 真实 26 包 tarball 闭包的 strict 作者检查发现：`bridgeAuthoringHook()` 的推断返回类型把 handler 参数发射成不存在的根 `AIHookEvent`，而根实际公开名为 `OrchestratorHookEvent`。函数返回结构与已有 resource-hub `AIHook` 完全一致，因此只显式标注该真实返回类型；没有添加根 alias，也没有改变 handler、返回对象或运行行为。原作者发现测试与桥接合同测试共 7 项通过；单包构建后的 `.d.ts` 直接引用 `../resource-hub/types.js` 的 `AIHook`。
- 该 Agent 宽入口归档检查同时发现 Database 的 `mongodb`、`mysql2/promise`、`pg`、`redis` 可选方言声明需要对应外部类型。四处静态类型依赖在基线 `d8532ddbf` 已存在；未补装四库、添加 shim 或使用 skipLibCheck 来称全入口闭包通过。纯推理入口已经验证的 strict 闭包与这个更宽 Agent 作者入口是不同证据层。
- **历史检查点**：此时 Database 类型隔离尚未实施，需单独设计确认，不能删除合法原厂类型或要求 SQLite 用户默认安装四个驱动掩盖声明问题。
- **用户确认后的本地实施**：方案 B 已实现中性 root、精确方言子入口与唯一 Registry 增补入口，保留六 factory 自动注册、同步创建、连接时加载 SDK 和现有依赖范围。29 包真实归档的默认宽入口、四单驱动、PG 缺声明／仅声明消费者及真实泛型正负例通过，默认声明不包含未选方言；本地 Host／Memory／SQLite 生命周期回归通过。没有外部数据库或 Provider 调用，尚未发布；最终集成候选仍需全仓门禁。合同及验收见[数据库可选方言类型隔离](./database-optional-dialect-types.md)。

### 全量回归后的配置与脚手架收敛

- 本组原 8 文件独立复现 19 个失败：示例／workspace 仍在启动文件寻找模型定义，Ollama fixture 没有明确模型，Key fixture 使用明文；旧 schema 测试仍指向已退役的 modelCatalog／decisions／TypeSafe 静态配置；Foundation 测试把已批准的空配置可启动误当无效。原人格、依赖、三角色、scope、身份、秘密隔离和辅助构造前拒绝断言均迁移到正式入口，未删除这些行为验收。
- 示例与生成 workspace 的独立 `ai.plan.yml` 经过 canonical `reviewProviderPlan` 和真实官方纯 Driver 的 schema／目录验证；测试仅展开示例中明确给出的非秘密默认值，不装配凭据、读取 `.env` 或调用 Provider。启动文件继续只保留静态政策。TypeSafe 测试分别检查空插件配置与真实 Service／Profile schema，并保留通用条件约束的 Host 权威验证。
- 新提案 schema 对三项决策计数漏掉安全整数上限：从提交 `fecfffb1c` 直接读取旧 schema 的红证据为 `MAX_SAFE_INTEGER + 1` 被静态解析接受，canonical graph 早已拒绝 invalid-graph；补齐原约束后静态 schema 与 canonical review 一致拒绝，没有增加新阈值或改变宽 startup schema 的扩展行为。
- 发现并修复 Console 正常结构化保存的独立缺口：宽 startup schema 为 legacy 只读迁移保留数据，但正常表单／patch 之前可能把必然被 Agent 拒绝的旧选择器写回。现在仅 `validatePluginConfig('ai')` 复用已有纯 startup validator，在环境查询前明确拒绝；缺 Agent 验证器也返回结构化 invalid。真实 RPC 保存、patch、无写入、无环境查询、合法扩展及 legacy 源读取回归均覆盖；file-manager `replaceSource` 合同不改，通用 patch 权限范围断言保留。
- 本组连同新增 Console 回归为 10 文件／115 测试通过；正式源码 type-check 与本组 ESLint 通过。Root 的初次完整 `check:all` 尚有其他分组失败，此处局部结果不能代替最终完整门禁；所有运行均为合成本地数据，没有实号或迁移用户资料。

### 示例构建与跨仓测试的类型检查归属

`multi-agent-room` 的既有 `tsconfig.json` 把 `tests/**/*` 与生产作者入口一起纳入限定在示例目录的 `rootDir`。本次合同测试引入仓库级纯 review helper 后，该 leaf build 把 helper 及其 AI／Runtime 源码也编入，真实 `pnpm --filter multi-agent-room build` 复现 TS6059；不能通过扩大 rootDir 或添加 AI 生产依赖解决。现在 leaf 只检查 `plugin.ts`／`src/**/*`，并显式保留其正式脚本原已使用的 noEmit；跨仓合同测试和 helper 则明确纳入现有根 `pnpm type-check`。没有关闭测试类型检查、添加 alias 或改变生产代码。

失败脚本原本就是 `tsc --noEmit`。对 AI `src`、Runtime `src`、`tests/helpers` 与示例目录的派生物清点为空；本地红复现后逐一核对诊断中的 67 个越界源文件及其 `.js`／`.d.ts`／map 同名输出，仍为零，没有证据需要清理，因此未删除任何源文件、既有 lib 或其他产物。修复后 leaf build、根 type-check 及相关 plan 合同测试均通过；完整 CI 按下一固定候选另验。
