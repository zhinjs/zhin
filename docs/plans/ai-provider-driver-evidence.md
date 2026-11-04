---
sidebar: false
---

# Provider 实现与验收边界

本文记录本次目标架构的 Driver、插件作者接缝与决策接线；主方案仍以 [目标架构](./ai-provider-target-architecture.md) 为准。

## 实现职责

- `packages/im/ai/src/providers/`：产品认证和请求协议、原生 SDK 转换、显式目录查询。没有账号持久化、账号轮转或第二个 Agent loop。
- `packages/im/ai/src/provider/`：唯一 Service / Account / Profile 图、能力验证、精确 Driver 租约和私有 provider state 归属。由领域实现负责。
- `packages/im/ai-provider/`：插件在 setup 一次批量发布 Driver；Host 从实际操作持有的 generation 解析。普通 Command / Tool 通过自己的执行上下文使用 `aiInferenceClientToken`。
- `basic/cli/src/plugin-runtime/inference/`：真实身份、凭据、OAuth CAS、网络边界和管理接口。Driver 不读环境、登录文件或数据库。
- `plugins/services/typesafe/`：真实 Choice / Score / Noul 协议。六类业务决策各自在使用时选定 Decision Profile；raw `evaluate` 不把业务 `applied` 状态混入模型结果。

## 产品能力与证据

| 产品 | 当前实现 | 本地证据 | 仍未验证 |
| --- | --- | --- | --- |
| 原生 API Key 产品 | OpenAI Chat / Responses / Images、Anthropic Messages、Google、DeepSeek、MiniMax、Ollama、OpenAI compatible、Cloudflare | 已安装 SDK + 注入合成 HTTP；独立 REST image fixtures | 各供应商实号接受、真实额度与计费 |
| Codex subscription | OAuth PKCE；固定 Responses SSE、`store:false`、完整历史和 encrypted reasoning / function-call replay | 两轮真实 SDK 请求、持久化 roundtrip、跨会话剥除 opaque state、显式不支持参数 0 HTTP | OAuth 回调注册、登录、订阅许可和实号协议接受；JWT 路由 hint 不是核实身份 |
| Claude subscription | OAuth；原生 Anthropic Bearer 和 OAuth beta；签名 thinking / tool replay | 已安装 SDK 的签名多轮与 usage / cache 字段 | 官方对第三方订阅路由有限制；技术实现不代表许可，也未作实号验收 |
| OpenCode Go / Zen | 两个独立产品；API Key Bearer，四个明确协议家族、独立目录地址 | Chat / Responses / Anthropic / Google 的请求头、地址、工具与用量 fixtures | 套餐、组织成员授权和实际扣费；没有将 Zen / Free 当成 Go 订阅 |
| Antigravity | OAuth；账号私有项目准备；原生 Google envelope；思考签名及工具续轮 | token 交换与只读 prepare 分离；CR / LF / UTF-8 分块；consumer break 后 transport signal 中止，未后台读完；usage / cache 保留 | 官方用途限制、注册回调、真实项目准备与模型接受；不自动 onboard、不造项目、不模拟 IDE |
| TypeSafe | 官方 SDK 真实决策类型，严格响应与用量验证 | Choice / Score / Noul、错误脱敏、预算、原连接重试、取消、并发准入拒绝隔离 | 实号模型可用性和实际费用 |

`subscriptions-wire.test.ts` 的 transport abort fixture 明确实现了原生 Fetch 的 signal→body 错误契约；它不是一个真实外网连接。协议 fixtures 不证明供应商允许第三方订阅使用。

## 参数与模型权威

Profile 只存真实生成语义、已支持预算和 image 参数；SDK namespace 字典不能写入 Profile。协议兼容、非秘密 headers、Google context-cache 配置属于具体 Driver 的 Service schema。认证材料只属于 Account 私有凭据。

Driver 的唯一 `profileSchema({service, model})` 按实际 kind / protocol / 明确能力生成 schema；保存、运行时及 Console 输入说明复用它。可在保存时确定不支持的 image / safety / thinking / Codex 参数不会等到模型调用才拒绝。Framework 的摘要、审批和旁听不再隐式覆盖采样或输出 cap，使用所选 Profile 的参数；真正插件显式请求仍验证，不能静默删除。

已覆盖：真实非流 `generate`、pull-based `stream`、temperature / output cap、工具与签名历史、request / response-header / chunk 预算、SDK retry、兼容服务 `appendV1` / `includeUsage`、Google explicit-cache reuse / backoff、image 质量 / 尺寸 / 背景 / watermark / prompt suffix。产品不支持的显式参数在授权和 HTTP 前拒绝；没有静默删参数或跨模型降级。

MiniMax / Cloudflare 的默认原生 Service 保留既有 image 协议。自定义网关地址不会默许把其 Key 和 prompt 转送官方 image 域；该组合明确 unsupported，0 grant / 0 HTTP。以后支持独立 image gateway 必须有明确配置合同，当前没有猜测路由。

Google Models API 的 `models/` 是资源前缀，目录结果归一成 SDK 所需 native ID。目录只是 ID / label 观测，不根据名字猜 input、tools、thinking、kind。`provider-catalogue.test.ts` 验证 observed ID 实际发送时只有一个 `models/`。

## 操作和用量

- `has` / `use`、未消费 stream 与未调用 client 的关闭不打开图、不读凭据、不计模型费用。
- 每个 Command / Tool 拿独立 owned client / lease。Tool 共享的是父操作的 opaque 图快照，不是父 client；Tool 关闭不会关闭父回合。HMR retirement 不等于业务取消。
- 普通 IM Command 沿用原用户 / 群配额 admission；已入场的 Agent Tool 仅检查 token，不重复消耗 group rate。异步 open 后，在真正提交前再次同步检查 token 并预占，二者之间没有 await。
- 真实提交前拒绝不发送请求。已提交且结果未知保留原预占；未提交不编造消耗。供应商 `reported` 区分缺少 usage 与真实 0；诊断、结算或 close 失败不把成功改成失败。
- 六 Decision 用途和独立场景旁听原先没有 IM 个人配额扣费。本次保持该边界，供应商 usage 与业务决策观察仍保留；Command 的配额测试不能代表全部模型路径。
- TypeSafe SDK 0.6.0 会把任何 fetch rejection 包成连接错误并重试。纯 AI 的 `ProviderAdmissionError` 仅表示明确的提交前准入拒绝；TypeSafe 用该调用自己的 AbortController 阻止错误重试并还原原错。真实连接重试策略不变，不遍历 cause 或匹配错误文案。
- TypeSafe 已知终态的红绿实验使用真实 SDK APIPromise：履行结果分支后、await 续轮前中止。旧 post-await signal 检查把成功改为取消；修复后保留已知结果。尚未完成时继续取消，不授权后续业务动作。
- SDK 默认 stream `onError` 会直接打印原错误。现有 bridge 在该最早诊断点只记录原分类的 kind / status / retry delay；Driver 对正式 HTTP / RetryError / 流错误保存安全分类而不保存 body、payload、URL 或 cause。上下文压缩检测仍识别 `context_overflow`。模型正式 refusal 文本属于回答，继续保留；这不等于保留错误诊断容器，也不宣称所有模型回答都会被脱敏。
- 同一 Profile 原位更换 native model，旧 operation 固定旧图；下一回合跟随该 Profile，Account incarnation 不变。实际 Codex SDK fixture 验证跨 model 不重放旧 encrypted reasoning。账号替换仍按独立身份规则处理。

## 旧门面清理与行为覆盖

`SdkProviderAdapter` 及其旧根 / llm 出口已删除。测试里的纯文字便捷消费通过新 Driver、正式图与 `InferenceClient` 实现，没有把旧门面搬进测试后继续验证旧权威。

| 原覆盖 | 目标覆盖 |
| --- | --- |
| `completeText` 重试、超时、取消、answer-only | `complete-text-resilience.test.ts`：新固定 Profile + 实际 Driver / resilience port；跨模型 fallback 改为已批准的固定模型拒绝降级 |
| Google standalone cache / prefix / backoff / owner 隔离 | `llm/gemini-context-cache.test.ts` 的 standalone 用例、新 Driver wire 用例、Agent standalone-cache 消费 |
| 旧默认模型猜测和自动发现 | 显式 metadata / Profile list 零网络、显式 discover、目录归属与实际 native-ID wire；没有继续推断能力 |
| Agent 测试假 Provider | 测试名称 / 模型声明和 completion port；没有旧生产 Provider 构造 |

正式跨层入口在 `basic/cli/tests/plugin-runtime/inference/operation-resources.test.ts` 中经过 Command / Tool 的真实 `ctx.use`、已安装 OpenAI SDK、合成加密凭据、Host 网络和配额 hook。模型行为质量、真实登录、生产性能、CI 和发布仍须分别报告；本文不将本地通过称为已部署或实号可用。

## 最终边界补验

### 真实 Request 与私有凭据使用事实

所有产品 Driver（SDK 推理、REST image、显式目录与 TypeSafe）在最终 URL、header、body 确定后，使用本次 fresh grant 调用必选的 `CredentialPort.bindRequest`，再发送同一 Request。构建 SDK 时拿到的初始 grant 不等于实际使用。Host 在完成目标 / DNS / quota 校验、实际 transport 发起前记录该 Request 的私有版本事实；不写公共 Trace、不新增持久审计，不因任意 401 / 403 改认证状态，也不自动重放。

`providers/sdk-wire.test.ts` 以两个不同 revision 的合成 grant 验证实际 wire 与 bind 使用第二份；Host `request-access` 回归另验旧版本事实的隔离。两者不等于已核实真实供应商的认证失效语义。

### 取消与 GC 的因果证据

最初完整 SDK suite 中 caller abort / chunk timeout 挂起，单例偶尔通过。第一次因果假设指向 OwnedRun，但没有证实；修正 mock 的 Request body / signal 读取后仍有 chunk timeout 挂起。没有按此假设修改 OwnedRun。

后续 Node `--expose-gc` 微实验与真实 SDK → localhost SSE 对照证实了两个独立的 Request 生命周期问题：

1. 仅保留最终 `AbortSignal` 不能保证 Node Request 的 follower 链接继续存在；响应消费期间必须有 Request 对象的明确 owner。
2. SDK 的 inter-chunk timeout 是独立取消源。经临时 `new Request(...).signal` 再合并，会在该临时 Request 被回收时切断 SDK timeout 分支；框架 caller 源仍直接连接，因此 caller abort 通过不能证明 chunk timeout 正确。

仅保 final Request 而保留旧 signal 表达式仍为红；仅直接使用 SDK signal 而不保 Request 也为红。最终由每个 execution 保持本次真实 Requests，结算 / stream close 时通过已有 dispose 清空；SDK fetch 复用 SDK 实际组合好的 signal。未跨调用 / binding cache 持有 Request，也没有新增全局状态或取消状态机。mock 也按真实 I/O 生命周期持有 Request，在 EOF / error / cancel 后释放。`helpers/provider-harness/request-lifecycle.test.ts` 将真实 SDK、mock Fetch 与 native localhost Fetch 的 GC / timeout 对照固化；不接触外网。共享 response-header helper 另有独立红绿用例：Request-only 输入须保留原 caller signal，不能只读 init.signal。

这些是本机 Node / 已安装 SDK 的验证；不能外推为所有 Node 版本、所有第三方 Driver 或实号网络性能已经验证。

### 公开诊断与原始历史分离

Codex encrypted reasoning、Claude thinking signature、Google / Antigravity thoughtSignature 和私有归属 scope 在 owner-bound 原始历史与匹配的 wire 中保留；实际序列化后续轮、跨 model / session 隔离分别有用例。公开 `onRequest`、日志、Trace 与 Console request DTO 通过同一个已定义协议状态投影留下描述占位。普通 cacheControl、tool call id、参数和正式 refusal 回答不删除。工具参数即使恰好含名为 providerOptions 的普通业务 JSON，也不能被当作协议状态删除，另有红绿回归。

此前 Agent request capture 已经把全部 providerOptions / providerMetadata 整体隐去；本次改为只隐去已定义的 replay-only 状态。其他较早的 request observation / 日志路径原来会保留该状态，因此不能把既有 Agent capture 的行为泛化为全部旧路径都已安全。

HTTP 400 / 401 / 429 / 5xx、SDK retry exhaustion、200 stream error、上下文溢出以及 malformed 200 语言 / image 响应均分别检查最终错误与早期 SDK 日志。供应商正式 refusal 内容是回答而非错误诊断容器，继续保留。原生 REST image 的 malformed JSON 也单独验证，不能把 SDK 已脱敏结论套到 REST。

### 旧选型权威与夜评

删除旧 ModelRegistry 的 JSON 缓存、自动发现 / 按名称推能力 / selectModels，以及 SdkProviderAdapter、alias SDK runtime / 工厂、静态 SDK model fallback、raw SDK key 工厂和旧 image 门面。纯名称工具保留原断言，但只是启发式工具，不参与 Profiles 选择或能力授权；旧 gateway SDK coercion、模型名推 context / input、静态默认列表也已从生产入口删除。没有读取或清除用户旧缓存文件。

原真实 SDK wire / cache / retry / timeout / refusal / image 用例迁至正式固定 Profiles 和产品 Drivers；纯 engine 测试只使用无 SDK、无凭据、无网络的 callback fixture。旧测试中从模型名猜 input、透传无归属签名、按可变 alias 决定协议、默默丢弃不支持媒体或 image 参数的预期，按已批准的显式能力 / 归属 / 参数合同改为明确声明或调用前拒绝；不是放宽断言以换绿色。

nightly 的既有显式 env 选择、预算、速率和报告行为继续保留，真实调用改走该次 run 的 Service / Account / 固定 Profiles 和实际 Drivers，关闭时释放。夜评未声明的原生 context capacity 保持未知，不继承旧的 128k 名称推测。夜评目录中的候选能力是准备验证的探针输入，不是厂商 discovery 的已验证能力，也不会写入生产 Host 目录。本轮只运行其离线合成 transport 回归；未执行真实 nightly，未读取真实凭据。

### Host 传输所有权补验（2026-11-04）

Host 的 `BoundRequest.transport` 为本次真实传输持有 account / network / personal 层产生的 Request 与 signal 跟随链，Driver 继续持有最终 bound Request 至 execution 结算。显式目录和 OAuth 的请求由各自事务闭包持有，body 解析结束或失败后释放。这些私有事实只表示 `transport-attempted`，不表示上游已经收到、执行成功或计费；Request 持有期间可关联实际 grant revision，不是持久审计，没有新增 401 状态策略。

默认输出预算采用共享 `resolveEffectiveOutputTokens` 解释既有的 Profile / native 声明 / 8192 规则；contextual schema 只给出有效来源说明，不插入 JSON Schema default、不把隐式值写回 Profile。实际 SDK wire 用例验证未填预算时，旧 operation 保留旧模型的 22，新 operation 在原位换 native model 后采用其 33。

本轮离线 SDK 验证使用当前安装版本（包括 `ai 7.0.44`、`@ai-sdk/openai 4.0.25`、`@typesafe-ai/sdk 0.6.0`）；未把这些结果外推为 manifest 整个版本范围都已逐版验证。真实供应商登录、模型接受、订阅第三方使用许可、计费折扣、生产性能、CI、发布与部署仍不在本轮本地证据内。

### SDK 最低声明版本静态核查（2026-11-04）

本项只读官方 npm 发布 tarball／本机已有包，不安装或运行下载代码，不替代最低版本运行矩阵。

| 契约 | 发布包证据 | 结论 | 未覆盖 |
| --- | --- | --- | --- |
| Anthropic 延迟工具与签名续轮 | [`@ai-sdk/anthropic@4.0.9`](https://registry.npmjs.org/@ai-sdk/anthropic/-/anthropic-4.0.9.tgz) 的 `anthropic-prepare-tools` 把 `deferLoading` 写为 `defer_loading`，`convert-to-anthropic-prompt` 读取 reasoning signature，语言模型发出 signature metadata | 声明最低 4.0.9 已含本轮所用接口 | 未对最低包执行合成 wire suite；不证明账户套餐接受 |
| OpenAI Responses opaque reasoning | 本机已有 `@ai-sdk/openai@4.0.8/dist/index.js` 3856–3907 的 `reasoningEncryptedContent`→`encrypted_content` 与 include 声明 | 声明最低 4.0.8 已含相关转换 | 最低包未执行；不是订阅授权证据 |
| Google thought signature | [`@ai-sdk/google@4.0.9`](https://registry.npmjs.org/@ai-sdk/google/-/google-4.0.9.tgz) 的 `convert-to-google-messages` 读取并写入 thoughtSignature | 声明最低 4.0.9 已含相关接口 | 最低包未执行；非实号接受 |
| AI SDK observation/onError/chunk timeout | [`ai@7.0.0`](https://registry.npmjs.org/ai/-/ai-7.0.0.tgz) d.ts 与 source map 含 onError、onLanguageModelCallStart、chunkMs | 这些既有 API 可追溯至原最低版本 | 未穷举整个 semver range |
| 首内容 chunk 超时 | 官方 `ai@7.0.0`、10、20、30 及逐个 31–34 的 d.ts 均没有 firstChunkMs；[`ai@7.0.35`](https://registry.npmjs.org/ai/-/ai-7.0.35.tgz) 含该字段（相邻边界 34→35；7.0.40/当前44也有） | 原 peer ^7.0.0 不能承诺本轮真实使用的 firstChunkMs；本轮 peer 已按最低可证实边界收至 ^7.0.35，dev 44 无需跟随调整 | 未执行每一 patch；无整段 range 可靠性保证 |

发布包证据副本在 `/private/tmp/zhin-oauth-provider-research-20261103/sdk-minimum-contracts/`，记录 tarball URL／integrity；只读静态检查不读取凭据。

### 实际归档的严格作者消费（2026-11-04）

最终归档闭包：`/private/tmp/zhin-provider-archive-types-Vc5EFR/consumer`。logger / AI / PluginRuntime / AIProvider / TypeSafe 使用真实 `file:.tgz` 与离线 pnpm 安装；AIProvider 是直接依赖，不以源码 alias 或 symlink 代替归档。四包 clean 后依赖构建 33/33，最后签名调整后构建 33/33。

| 验收 | 实际证据 | 结论 | 未覆盖 |
| --- | --- | --- | --- |
| 纯 Inference 作者 | `pure-inference.type-test.ts`，严格 tsc、NodeNext、仅 ES2022 与 Node 类型 | exit 0；无需 DOM、skipLibCheck 或手加 @types/json-schema | 当前 Node / TypeScript / 包版本 |
| 常见根入口 | `normal-inference.type-test.ts`，含 createUserMessage、parsePartialJson、内置产品与 TypeSafe，退休构造器和私有 SDK converter 负类型断言 | 同一严格参数 exit 0；中性 d.ts 不再拉 SDK UI / browser 类型 | 非全部第三方插件 |
| 注册与参数推断 | 原 contracts / builtin-contracts / retired-exports 三个归档 fixtures 去掉 skip 后以同参数执行 | exit 0；真实 Codex / TypeSafe 参数和认证方法正反推断成立 | 未执行全部 TS 版本范围 |
| 归档运行时 | runtime-probe.mjs 导入 13 Driver、Runtime、Resource token、TypeSafe；实际 OpenAI SDK 使用合成 fetch | 1 HTTP / 2 fresh grants，usage 3；外网供应商调用 0；退休根出口不存在 | 不替代实号、CI、部署或生产验证 |
| 直接消费上游 SDK 类型 | 独立 explicit-upstream.type-test.ts 明确 import ai / OpenAI，带 DOM lib 后仍报 @ai-sdk/provider@4.0.4 的 json-schema 缺声明两项 | 上游发布包把 @types/json-schema 留在 devDependencies；不计为通过，未暗中补默认作者依赖 | 直接使用上游 SDK 类型的作者须处理其上游类型依赖；本轮不修改上游 d.ts |

严格命令为 `tsc --ignoreConfig --noEmit --strict --target es2022 --module nodenext --moduleResolution nodenext --lib es2022 --types node`。没有 skipLibCheck、ambient 假声明或手工安装缺失类型来凑绿。

修复在真正类型归属处完成：三个纯缓存函数与 retention union 移至同一个中性模块，SDK 桥接复用原函数；无生产 / 作者文档消费者的 SDK 桥接根和 llm 出口退役；partial JSON 用准确中性签名包装原 SDK 函数，保留状态、返回值与运行行为。没有重建 SDK ModelMessage，未删正式消息 / 工具语义。

日志为 `/tmp/provider-final-pure-inference-strict.log`、`/tmp/provider-final-normal-inference-strict.log`、`/tmp/provider-final-archive-runtime.log`、`/tmp/provider-final-explicit-upstream-strict.log`。完整 CLI / Console 及固定 commit 的门禁由各责任层和独立 reviewer 继续验证；归档证据不泛化为整仓交付完成。
