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

### 单独待定：standalone 错误终态的状态投影

- **基线证据**：`git show d8532ddbf:packages/im/ai/src/llm/agent-loop.ts` 的既有 catch 已把 transport throw 转成 `AssistantMessage.stopReason = 'error'`／`errorMessage` 并继续发出 `message_end`；同基线 `core/agent-loop-standalone.ts` 在 `errorMessage` 存在时生成错误文本，但返回值不包含终态；同基线 `subagent/subagent-runtime.ts` 对 runner 的正常返回统一发 `status: 'ok'`。当前源码仍是这条链，本次 Provider 端口替换没有创建这个错误转成功的分支。
- **当前本地证据**：真实子任务 Driver 在已完成两个工具后普通 throw，语言层记录错误文本，子任务 finish 仍为 ok；这是结果分类缺口，不能称模型／任务成功。为保持本次修复边界，永久取消回归使用真实 `manager.cancel()` 覆盖 catch 与已完成观测保留，没有把上述错误路径改成成功断言。
- **消费者与风险**：`SubagentSystem.composeSender()` 将 ok 投影成 ResultSink 的 completed；`buildSubagentUserDelivery()` 会显示“完成”；`persistSubagentResultToContext()` 把该状态存入父会话，auto-continue 两种状态都会唤醒主 Agent，并把状态提供给它决定下一步。activity-feedback 的 finish 仅结束进度；Trace 的 subagent_end 仅保存上游给定状态。未找到按此状态自动重放原 Subagent 的确定性队列逻辑，但主模型看到状态后可以再次编排工具／spawn，因此错误分类修复不能同时新增自动重试。
- **相邻边界**：deferred-worker 同样消费 standalone 返回值并按迭代数判 ok／partial；`AIService.runAgent()` 公开结果亦未携带终态，Workroom planning 再解析 JSON。它们是共享 runner 的既有受影响路径，需要一并核验，不能只改 Console 展示或只让 Subagent catch 抛错而丢失已完成工具和用量。
- **最小候选方案（未实施）**：从已存在的最后 `AssistantMessage.stopReason`／`errorMessage` 投影窄终态到 standalone 结果，保留 content、usage、toolCalls 与原错误含义；由各既有任务 owner 映射现有 error／cancelled 状态，不增加新重试／降级／触发策略。对完成副作用后模型失败、取消、合法空答和迭代上限分别验证；已执行工具不重放，未知副作用不得误报未执行。该方案待另行确认，不属于本次 child ALS 修复。

### Agent 归档作者声明检查

- 真实 26 包 tarball 闭包的 strict 作者检查发现：`bridgeAuthoringHook()` 的推断返回类型把 handler 参数发射成不存在的根 `AIHookEvent`，而根实际公开名为 `OrchestratorHookEvent`。函数返回结构与已有 resource-hub `AIHook` 完全一致，因此只显式标注该真实返回类型；没有添加根 alias，也没有改变 handler、返回对象或运行行为。原作者发现测试与桥接合同测试共 7 项通过；单包构建后的 `.d.ts` 直接引用 `../resource-hub/types.js` 的 `AIHook`。
- 该 Agent 宽入口归档检查同时发现 Database 的 `mongodb`、`mysql2/promise`、`pg`、`redis` 可选方言声明需要对应外部类型。四处静态类型依赖在基线 `d8532ddbf` 已存在；未补装四库、添加 shim 或使用 skipLibCheck 来称全入口闭包通过。纯推理入口已经验证的 strict 闭包与这个更宽 Agent 作者入口是不同证据层。
- **独立候选方案（未实施）**：盘点 Database 公共类型的方言依赖边界，将中性合同与可选方言作者入口分离，设计后单独确认；不能仅删除合法类型、改变数据库运行 API，或要求所有 SQLite 用户默认安装四个驱动来掩盖声明问题。
