---
sidebar: false
---

# ADR 0047：AI Provider 订阅接入与多决策模型

状态：Implemented（Accepted，§1a / §1b / §1c 拍板结论与 Slices S0–S4 已全部落盘合入 main）

> 合入后澄清（2026-11-04，为 S1）：§1a 与 S1 验收行措辞已与 Fin 2026-11-04 决定（见「勾选记录 · 合入影响」）对齐——实验 Driver 可保留默认注册，但须带实验标识与风险声明。勾选结果与产品选择（A1–A4 等）不变。

关联：2026-11-04 交接 BRIEF（AI Provider 订阅 / OAuth 接入收束，非 Calendar OAuth）；领域模型与实现已合入 `main`（`packages/im/ai/src/provider/`、`packages/im/ai/src/providers/`、`packages/im/agent/src/decision/`）。

## 背景

### 领域模型已定，本文不另起

领域结构与配置权威已合入 `main`（代码落盘于 `packages/im/ai/src/provider/`、`packages/im/ai/src/providers/`、`packages/im/agent/src/decision/`），设计基准与实施台账见：

- [AI Provider 目标架构](https://github.com/zhinjs/zhin/blob/main/docs/plans/ai-provider-target-architecture.md)（设计基准，2026-11-03 确认）
- [AI Provider 运行时实施台账](https://github.com/zhinjs/zhin/blob/main/docs/plans/ai-provider-runtime-implementation.md)（实施台账）
- [AI Provider Driver 本地证据与未验证项](https://github.com/zhinjs/zhin/blob/main/docs/plans/ai-provider-driver-evidence.md)（各 Driver 本地证据与未验证项）

本文只引用其中的关键概念，不复制架构正文：

| 概念 | 一句话 |
| --- | --- |
| Provider Driver | 插件发布的产品 / 协议实现：认证方法、模型能力、执行工厂；SDK 留在内部 |
| Service | 一项实际产品 / 部署：driver 引用、目标配置、模型目录元数据；不存 token |
| Account | owner 在某 Service 上的访问身份：认证方式、凭据引用、认证状态 |
| Model Profile | 用户可选的一份模型配置：Account + 原生 model ID + 受支持参数 |
| Purpose Policy | chat / summary / perception / ambient / 六类决策的选型，只引用 Profile |
| 一份运行时配置权威 | Service / Account / Profile / 用途由 Host 事务仓储持久化；`zhin.config.yml` 不再叠加模型目录；`ai.plan.yml` 只是显式导入 / 导出 |
| ExecutionBinding | 一次调用固定配置图、Profile / Account 身份、Driver generation 与可信上下文 |
| Host AccountRuntime | 加密凭据、登录事务、刷新单飞与 CAS 提交；跨 generation 拥有账号 |

### 调研稿与活文档的关系

调研稿写于目标架构确认之前，其 §4.1 把订阅接入设计为「在 modelCatalog 的 Connection 上加 `transport` / `auth` 字段」。目标架构已经退役 Connection → Model → 空 Preset 链与 `SdkProviderAdapter`，因此本文**只采纳调研稿的事实与约束**，落位换算如下：

| 调研稿提法 | 在目标架构中的落位 |
| --- | --- |
| `Connection.transport: { type: codex }` 等 | Service 的 `driver`（如 `codex-subscription`、`opencode-go`）；API family 由 Driver 的 Service schema 闭合表达 |
| `auth: { type: oauth, accountRef }` | Account 的 `auth.method: oauth` + Host 私有加密凭据记录 |
| `secretRef` | Account 的 `auth.method: api-key`（env 引用或 Console 录入的加密凭据） |
| Model / Preset | Model Profile |
| `ConnectionCredentialPort` | Driver 使用的凭据端口（每次请求取 fresh grant 并 `bindRequest`） |
| `SubscriptionDriver.begin/complete/refresh` | Driver 认证能力（判别联合，仅 OAuth Driver 实现） |
| `ai.decisions.models.<别名>` | 指向 TypeSafe 等 Decision Service 的 Decision Profile |
| `ai.decisions.<task>.model` | `purposes.decisions.<task>.profile` |

### 主干落盘现状

`main`（原 `feat/ai-provider-main-integration` 已合入）已有本地 / 合成 HTTP 级完整实现：Codex、Claude 订阅、OpenCode Go / Zen、Antigravity 五个 Driver（`packages/im/ai/src/providers/`）；AccountRuntime 刷新单飞与 CAS（`packages/im/ai/src/provider/`）；每次请求取当前凭据；六类决策按 Profile 选型（`packages/im/agent/src/decision/`）；Console 候选。台账明确**未做**实号登录、订阅许可确认、真实推理与计费。

`builtinAiProviders` 默认注册了 `claudeSubscriptionProvider` 与 `antigravityProvider`。按 Fin 勾选的 Claude / Antigravity §1a 实验通道，默认注册保留，并已按 §1a 挂实验标识（`support: { tier: 'experimental' }`）与 README 风险声明（由 `tests/docs/ai-provider-experimental.test.ts` 门禁守护），不包装成官方支持。

## 决策（Implemented）

### 0. 总原则

1. **挂在现有 provider 图上，不建平行栈**：订阅账号就是 Account，订阅产品就是 Service + Driver；不新建订阅专用目录、账户池、独立 Agent loop 或第二配置源。
2. **认证方式不是模型能力**：OAuth 与 API Key 都只是 Account 的认证方法，不改变 Profile、用途或权限。
3. **技术可实现 ≠ 官方许可 ≠ 实号可用**：三者分别报告；官方 ToS 已否决的接入不得以「已支持」出现在 Console、文档或 changelog。
4. **管理权 ≠ 使用权**：Host 管理员管理订阅账号；成员能否用其 Profile 由既有模型使用政策与本文勾选决定，不因认证方式改变而扩权或收权。

### 1. 四项服务的接入态度

每项服务只能取一种态度：

| 态度 | 含义 |
| --- | --- |
| 正式产品 | 默认注册 Driver；Console 可选；文档列为支持（附「未实号验收」与套餐条件说明） |
| 协议接缝 + API Key 路径 | 订阅认证代码不进默认注册、不出现在 Console；用户走同厂商官方 API Key Driver |
| 明确不做 | 订阅 Driver 从官方 Driver 集移除；文档写明不支持及原因 |

提案默认值（以 Fin 勾选为准）：

| 服务 | 官方边界（调研稿已核对） | 提案 |
| --- | --- | --- |
| Codex | 官方说明 Codex 支持 ChatGPT 订阅登录；不等于承诺任意第三方 OAuth client | **正式产品**（Host-owned、未实号验收标注；Fin 须同时确认 §1a） |
| Claude.ai 订阅 | 官方限制第三方应用提供 Claude.ai 登录及中转订阅凭据 | **协议接缝 + API Key 路径**（Anthropic API Key 正式保留） |
| OpenCode Go | 订阅产品，但推理 API 使用 API Key；Zen / Go / Free 条件不同 | **正式产品**（API Key 认证；不引入 OAuth；Zen 单独列） |
| Antigravity | 官方 FAQ 限制第三方登录使用与把 headless CLI 包进第三方应用 | **明确不做**（AI Studio / Gemini API Key 不得称为 Antigravity 支持） |

#### 1a. 实验通道（须 Fin 勾选）

Claude.ai 订阅与 Antigravity 只有在 Fin 于本 ADR 明确勾选「自担 ToS 风险的实验通道」时才可注册。勾选后，本节对默认注册的规定优先于上表「协议接缝」一行，且：

- **可以**保留在默认 `builtinAiProviders` / 默认注册集中（按 Fin 2026-11-04 决定）；
- 必须带实验支持标识（如 experimental support flag 或等价字段），Console / **README** / 文档统一标「实验 · 不受官方支持 · 可能违反供应商条款 · 风险由使用者自行承担」；
- 不得写成「官方支持」：不计入「支持的订阅」宣传列表，不以正式功能写入 changelog 的新功能段。

Codex 若选「正式产品」，Fin 同时确认：接受以 Codex 客户端 OAuth 合同接入、Console 文案注明「未经 OpenAI 对第三方客户端的明确授权」。

### 2. 账号归属：首阶段仅 Host-owned

- 首阶段只开放 **Host 管理员接入的 Host-owned 订阅 Account**；登录、重新授权、断开、刷新目录均需既有 Host 管理权限。
- 成员按**既有模型使用政策**消费明确发布的 Host Profile；订阅 Profile 是否默认对普通成员发布，由 Fin 勾选（提案：默认不发布，仅部署用途与主人回合，见清单 B3）。
- 个人自备 OAuth 登录 UI **默认不做**。结构上保留 owner-bound 能力，但不开放入口，除非 Fin 同轮勾选。
- 场景主动任务、定时任务、部署摘要只用部署配置选定的 Host Profile，不借个人订阅。
- 个人 API Key 连接保持 ADR 0046 已批准边界，不迁入订阅账号服务。

### 3. 动态凭据句柄

- 执行资源只持有**绑定 owner / Account incarnation 的认证句柄**；每次实际请求从句柄取当前凭据，在最终 Request 确定后 `bindRequest`。
- 禁止在 Session / lease / runtime 创建时解析并冻结静态 secret；token 轮换不得重建 Session、不得重启进程、不得改配置图 revision。
- credential version 与配置图 revision、Account incarnation、Driver contract version 分开；token 内容与版本不进入公开 fingerprint、prompt cache key、Trace 或日志。
- 迟到的旧 token 401 / 旧刷新结果不得使新凭据失效（CAS 核对 incarnation + credential version + authContractVersion）。

### 4. 不伪造、不强转

- 不用占位 / 假 apiKey 通过任何 SDK 或工厂的校验；不让 SDK 从宿主环境暗取另一份 Key。
- 不把任意实现断言为既有适配器实例（调研稿所指的 `createSdkProviderAdapter` / `SdkProviderAdapter` 门槛在目标架构中已删除；新代码同样不得以类型断言或假实例绕过 Driver 合同）。
- Driver 未实现的能力（如订阅不支持的图像生成）直接报告不支持，不自动改用付费 Key 或其他模型。

### 5. 协议、重试与重放

- Codex 走 Responses SSE、`store:false`、必要账号头；encrypted reasoning 与工具调用 ID 原样往返，只回送给同一 Service / Account incarnation / 模型合同。完整往返合同按阶段验收（S2），未验收部分不宣称支持。
- 401 / 认证失败是否重提，只按该协议的**拒绝阶段**与既有请求级重试机制决定；**禁止**在已收到部分流或工具输出后整段重放 Agent 任务；已执行工具不重放。
- refresh 已提交但响应丢失、或新 token 落盘失败，均为「结果未知」；无供应商幂等合同时不再交换旧 refresh token，提示重新授权 / 诊断。

### 6. 模型目录：显式 catalog 为权威

- 订阅类 Service 首阶段以显式配置的模型目录为权威；**禁止** `/v1/models` 等隐式探测（含启动后台发现、generation 发布后发现、页面渲染时发现）。
- 只有管理员显式点击「刷新目录」才调用该服务已支持的目录合同；失败不写为空目录。
- 「保存只做本地合同验证」不被任何后续自动网络动作抵消；可能计费的探测是独立按钮。
- 普通 API Key Driver 的既有显式发现行为不变。

### 7. 多决策模型

- 保留 TypeSafe 等 Decision Driver 的真实 Choice / Score / Noul 合同；LanguageModel 不因能输出 JSON 而充当 DecisionModel，不合成概率 / 置信度。
- skills / tools / memory / agents / approval / ambient 六类用途各自引用**明确的 Decision Profile**；没有「第一个可用」、继承聊天模型或跨模型降级。
- 用途 `off` 不发请求；`shadow` 只记建议；`active` 交业务所有者应用；受信选择不改变 mode、阈值、候选范围或审批硬权限。
- 未定义 / 不可见 / 停用的 Profile 在保存与导入验证阶段报错，不在调用时静默跳过。
- 单次决策的全部候选批次固定同一 Profile / Account。
- 旧 `ai.decisions.provider` 只在一次性迁移中归一化为明确 Decision Profile；不猜默认模型（不写死 `jev-latest`），生产 runtime 不保留双路径。

### 8. 非目标（本轮）

- 以 9router 源码作为产品依据，或无许可声明地复制其实质代码（MIT 复用须保留许可与版权）。
- 把 Claude.ai 订阅 / Antigravity 包装为「官方支持的第三方订阅登录」（§1a 实验通道除外）。
- 个人自备 OAuth 登录 UI。
- GitOps / watch 自动同步 `ai.plan.yml`。
- 启动 seed 或任何第二配置源。
- 账户池、自动换账号、自动换模型、保活流量、配额轮询。
- 自动扫描或导入 `~/.codex/auth.json`、Claude 凭据或 IDE 数据库。

## 实施切片

Slices S0–S4 已全部按本 ADR 勾选结果在 `main` 落盘并完成验收：

| 切片 | 状态 | 内容與落盘路径 | 验收标准 |
| --- | --- | --- | --- |
| S0 ADR（本文） | ✅ 已完成 | 四项服务态度、Host-only 首阶段、决策多配置合同、技术硬约束（`docs/adr/0047-ai-provider-subscriptions-and-decision-models.md`） | Fin 勾完清单 A / B / C；状态转 Accepted / Implemented |
| S1 认证端口 | ✅ 已完成 | Host 私有订阅账号服务（AccountRuntime）+ 动态凭据句柄接入 ExecutionBinding / Driver；实验通道标识与测试（`packages/im/ai/src/provider/`、`packages/im/ai/src/providers/{subscriptions.ts,antigravity.ts,oauth.ts,support.ts}`、`tests/docs/ai-provider-experimental.test.ts`） | 单测：同账号 token 轮换后下一请求用新凭据且不重建 Session；全仓无假 apiKey / 强转；并发刷新单飞、取消一个 waiter 不影响其他；迟到旧 401 不误伤新凭据；未勾「正式」的订阅 Driver 按 §1a 保留默认注册，带 experimental 标识与 README / Console 风险声明，不得写成官方支持；验收含标识与文案单测 / 文档检查 |
| S2 Codex 路径（A1 选正式） | ✅ 已完成 | Responses + 账号头 + SSE；历史 / opaque 状态绑定 Account incarnation（`packages/im/ai/src/providers/subscriptions.ts`、`packages/im/ai/src/providers/oauth.ts`） | 本地 HTTP fixture 合同测试：多轮工具续轮、encrypted reasoning 往返、重启恢复、跨账号 / 跨模型剥除 opaque；部分流后认证失败不重放整任务；显式不支持参数 0 HTTP |
| S3 多决策配置 | ✅ 已完成 | 用途 → 明确 Decision Profile；验证期报错；off 静默；旧单 provider 一次性迁移（`packages/im/agent/src/decision/{config.ts,rank.ts,approval-judgment.ts}`） | 配置校验单测：未定义 / 不可见 Profile 保存即报错；off 用途 0 次 evaluate；批次不漂移；旧写法迁移预览不猜模型 |
| S4 Console | ✅ 已完成 | 登录 / 断开 / 刷新目录 / 付费探测分按钮；保存不打网；实验通道标识（`basic/cli/src/plugin-runtime/inference/`、`packages/console/`） | 管理权 ≠ 使用权的文案与 DTO；DTO / 日志无 token；保存与页面加载 0 次供应商请求；本地断开不显示为「已撤销上游授权」 |

S1 → S2 依赖；S3 可与 S1 并行；S4 依赖 S1（及 S2）。真实登录、付费请求与订阅资格验证不属于任何切片，须另行授权。

## 后果

- 正面：订阅接入不引入新概念；ToS 边界在产品层显式化；token 轮换与 Session 解耦；决策选型可审计。
- 代价：Claude / Antigravity 若选接缝或不做，分支上已写的代码要么移出默认注册、要么删除；Codex 正式支持仍处于「未实号验收」状态，文案须如实标注。
- 风险：供应商条款变化可能使「正式产品」转为不可用；Host-owned 订阅被多人使用可能超出个人套餐条款（Go / ChatGPT 个人套餐），由清单 B3 控制。

## 开放问题结论（2026-11-04，Clover 代 Fin：完整开发 + 推荐做法）

1. **Codex OAuth 回调**：接受「用户粘贴最终回调地址」为远程 Host 的正式流程；Console 文案须注明未经 OpenAI 对第三方客户端的明确授权。
2. **OpenCode Zen**：与 Go **同轮**列为正式产品（API Key 认证）。
3. **成员回合场景 ACL**：本轮**不新增** ACL；仅用 B3「默认不发布订阅 Profile」控制。若日后要按私聊 / 主人群细分，另开 ADR。
4. **实号验收**：S1/S2 fixture 绿后，由 Fin 另行指定账号与时机授权真实登录 + 一次推理；自动化 / Agent 不得自行登录或扣费。

## Fin 勾选清单

勾选即确认。A 组每项只勾一个主选项（「另加」项可叠加）；某组未勾完之前，依赖它的实现切片不开工，也不默认采用提案值。

### A. 四项服务态度（每项只勾一个）

**A1 Codex**

- [x] 正式产品（提案）——并确认 §1a 的 Codex 文案与 OAuth 合同风险
- [ ] 协议接缝 + API Key 路径（走 OpenAI API Key Driver）
- [ ] 明确不做

**A2 Claude.ai 订阅**

- [x] 协议接缝 + API Key 路径（提案；Anthropic API Key 正式保留，订阅 Driver 移出默认注册）
- [ ] 明确不做（订阅 Driver 从官方集删除）
- [x] 另加：开启「自担 ToS 风险的实验通道」（§1a；默认不勾）

**A3 OpenCode Go**

- [x] 正式产品，API Key 认证（提案）
- [ ] 协议接缝 + API Key 路径（仅保留 OpenAI-compatible 通用路径，不列 Go 产品）
- [ ] 明确不做
- [x] 另加：OpenCode Zen 同轮列为正式产品

**A4 Antigravity**

- [ ] 明确不做（提案；Driver 从官方集删除）
- [x] 协议接缝 + API Key 路径（订阅 Driver 移出默认注册；Gemini API Key 单列，不称 Antigravity）
- [x] 另加：开启「自担 ToS 风险的实验通道」（§1a；默认不勾）

### B. 账号归属与使用

- [x] B1 首阶段仅 Host-owned 订阅 Account + 既有模型使用权（提案）
- [x] B2 个人自备 OAuth 登录 UI 本轮**不做**（提案；若要同轮做，改勾下一项）
- [ ] B2′ 个人自备 OAuth 登录 UI 本轮同做（需另补个人范围设计）
- [x] B3 订阅 Profile 默认**不**发布给普通成员，仅部署用途与主人回合使用（提案）
- [ ] B3′ 订阅 Profile 按既有模型使用政策对成员开放（Fin 自担套餐条款风险）

### C. 决策模型多配置

- [x] C1 保留 Choice / Score / Noul 真实合同；LanguageModel 不冒充 DecisionModel
- [x] C2 启用的用途必须解析到明确 Decision Profile；未定义 / 不可见在验证期报错
- [x] C3 `off` 用途不发请求；无默认、无继承、无跨模型降级
- [x] C4 旧 `ai.decisions.provider` 仅一次性迁移，不猜默认模型，不保留双路径

### D. 技术硬约束（确认即进入 S1 验收标准）

- [x] D1 动态凭据句柄：每次请求取当前凭据，不在 Session / lease 创建时冻结 secret
- [x] D2 不伪造 apiKey、不强转适配器实例
- [x] D3 部分流 / 工具输出后不整段重放 Agent 任务；401 重提只按协议阶段
- [x] D4 订阅 Service 显式 catalog 为权威，禁止隐式 `/v1/models` 探测
- [x] D5 订阅账号服务挂在现有 Service / Account 图上，不建平行栈

### E. 范围

- [x] E1 §8 非目标清单全部同意
- [x] E2 同意下一切片按「S1 认证端口」开工（S3 可并行）

### 勾选记录

- 2026-11-04 Asia/Manila：Fin 授权 Clover 代勾；后续补充：**尽量都支持官方订阅，风险由使用者自行承担，README 告知风险即可**。
- **产品面**：Codex 正式；OpenCode Go + Zen 正式；Claude.ai 订阅 / Antigravity 开 §1a **实验通道**（Console/README 标「实验 · 不受官方支持 · 可能违反供应商条款 · 风险自担」）。
- **账号**：B1 Host-owned；B2 本轮无个人 OAuth UI；B3 订阅 Profile 默认不发布给普通成员。
- **C/D/E**：全勾；下一切片 S1。
- **主干合入状态**：`main` 保留 `claudeSubscriptionProvider` / `antigravityProvider` 默认注册，已按 §1a 挂实验标识与 README 风险声明，不写成「官方支持」。

## 增补：用途备用模型（#1250 chat-purpose-no-fallback，2026-11）

**背景。** 此前只有识图（perception）用途能配置备用链；聊天、摘要、旁听语言模型、Agent 角色（`purposes.agents`）以及 Adapter / Endpoint / 场景的聊天覆盖都只能选一个 Profile。Gemini 官方免费档的日配额（`GenerateRequestsPerDayPerProjectPerModel-FreeTier`）用完后，相关渠道每条消息只回「模型额度用完了」直到太平洋时间午夜，即使已配置其他可用账号。`provider-resilience` 只在同一模型上重试，按设计从不换模型或账号。

**决策。**

1. **配置形状（向后兼容）。** 导入提案（`ai.plan.yml`、Console 写入、导出）中，`chat` / `summary` / `ambient` / `agents.<key>` / `adapters|endpoints.<key>.chat` / `scenes.<key>.chat` 可以写成 Profile 别名字符串，或 `{ profile, fallbacks? }`（与 `perception` 相同）。写入一个用途即替换它的整条链，`null` 同时清除主项与链。持久化配置图保持原有的主项字符串字段不变，备用链放在同级字段：`defaults.chatFallbacks` / `summaryFallbacks` / `ambientFallbacks`、`adapters|endpoints.<key>.chatFallbacks`、`scenes.<key>.chatFallbacks`、`agentFallbacks.<key>`。链必须非空、不重复、不含主项，只能出现在有主项的同一层；所有备用 Profile 与主项一样须为 Host 所有。生图（`image`）与六类决策（`decisions.*`）不支持备用链（C3 不变：决策无跨模型降级）。个人 Session 显式选择的聊天 Profile 不带备用链。
2. **链归属于选中主项的那一层。** 场景 / Endpoint / Adapter 覆盖了 `chat`，就只用该层的链，不与外层的链拼接；摘要、旁听未单独配置时继承部署聊天，也继承部署聊天的链。
3. **切换条件。** 只有整个模型请求以 `quota_exhausted`、`billing`（余额不足 / 402 / `insufficient_quota`）或 `auth`（401 / 403 / 无效 key）失败时才按顺序换下一个备用模型。超时、5xx、限流、网络错误、请求被拒、内容拦截、上下文超长保持原行为（同模型重试后报错），不切换：换账号修不好它们，也不应因为主模型慢就把流量悄悄转到付费备用账号。备用层位于 `provider-resilience` 之下：这三类失败本就不重试，因此等价于「重试放弃之后再切换」。
4. **不重放工具。** 切换按单次请求进行，从当前对话记录继续：失败的请求没有产生工具调用，已执行的工具调用以结果形式留在记录里，备用模型接着往下回答，绝不重新执行（与 D3 一致）。如果失败前已经向用户流出了文字，或调用方禁止重试（回复阶段已交付），则不切换，直接报错。同一次操作一旦切换就留在备用模型上。选择会话级历史的跨供应商转换与现有「Session 切换模型保留历史」相同。
5. **跳过与恢复。** 以上三类失败的模型按「账号 + 原生模型 ID」记入进程内存的跳过表，带过期时间：有供应商重置提示（`Retry-After` / `retry-after-ms`）时按提示（最长 48 小时）；日配额（Gemini `...PerDay...` 配额、429 写明 `per day (RPD/TPD)`）没有提示时到下一个美国太平洋时间（America/Los_Angeles，含夏令时）午夜，Gemini 的短 `retryDelay` 对日配额无意义而忽略；其他配额 1 小时、余额不足 1 小时、鉴权失败 15 分钟。跳过表不持久化，重启后每个模型会再试一次。选型时主项在跳过期内就直接选第一个可用备用模型；全部在跳过期内时仍试主项。
6. **可观测。** 每次切换在回合 trace 里记 `model_fallbacks[]`（原 / 答复 Profile、账号、模型、原因、阶段 `selection|request`、原模型恢复时间、`notice: 「本轮由备用模型回答」`）并加时间线 `model_fallback`。Console 管理视图（`GET /agent/inference`，已登记 `agent.view` 权限，无新路由）对 Host 管理员增加只读 `modelAvailability`：`notice`、`unavailable[]`（跳过中的账号 + 模型及恢复时间）、`recentFallbacks[]`（最近 20 次切换）。

**后果。** 免费档日配额耗尽不再让渠道整天只回错误；没有配置备用链的部署行为不变。备用模型的上下文窗口、提示词族与主模型可能不同：中途切换时本回合已组装的提示与压缩阈值仍按主模型计算，下一回合起主项若仍在跳过期，整回合按备用模型选型。
