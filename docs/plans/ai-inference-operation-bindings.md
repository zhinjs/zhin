# 普通插件的 Operation Inference 接入合同

状态：供主审确认内部接缝；尚未实现。本文件不增加产品权限、模型选择规则或后台任务。

## 已证实的缺口

- `feature-kit/src/context.ts` 的 `use()` 只读取 immutable snapshot 静态资源。
- `core/.../inbound-runtime.ts` 有真实 `SnapshotLease`，但 MessageDispatcher → CommandIndex → CommandContext 只传 snapshot。
- AgentRuntime 持有真实 lease、TurnRequest 及固定模型 scope；CapabilityIngress → ToolIndex 目前只传 snapshot 和运行时调用上下文。
- `openScope()` 异步，普通 `ctx.use(token)` 同步。向 Root 注册共享 InferenceClient 会混淆账号、发起者、图快照和生命周期。

## 最小接缝

Feature Kit 仅认识通用的 operation resource view，不依赖 AI、Host 或账号。它不是第二个注册系统。

```ts
interface OperationResourceView {
  has(token: Token<unknown>): boolean;
  use<T>(token: Token<T>): T;
  close(): Promise<void>;
}
interface CapabilityOperation {
  readonly signal: AbortSignal;
  readonly resources?: OperationResourceView;
}
```

CapabilityContext.use/has 优先读取由正式调用链提供的 operation view，其余读取既有 owner Scope。
没有 view 时不会从最新 Root 查找，也不从用户 JSON、metadata 或同名属性创建 scope。

CommandDispatchRequest 与 ToolIndex 的正式 invocation 增加框架传递的 operation 对象；实际 owner 已匹配、确定性权限已验证后才为该次 execute 创建 view。Command/Tool execute 的 finally 关闭 view。

- IM：InboundRuntime 把实际 lease、受控 Message 和信号交给 Host 注入的 operation 工厂；MessageDispatcher 和 CommandIndex 仅转交，不自己推导 AI 身份。
- Agent Tool：AgentRuntime/CapabilityIngress 使用本次实际 lease、可信 TurnRequest、已捕获的 inference graph snapshot 和调用信号；不从工具参数提取账号或权限。
- 无发起者的直接 `CommandIndex.execute()` 不默认为 Host。只有显式 Host 内部 operation 或受控入口可提供 inference。

Host 使用现有个人绑定与场景身份解析，创建 context；目标网路和私有凭据继续走同一个 HostInference/InferenceRuntime。已捕获的图只能通过不可序列化的 snapshot handle 复用，仍重新应用真实主体权限。

## 同步 use 与异步 open

AI integration 为该次 operation 创建一个 lazy InferenceClient。`use(aiInferenceClientToken)` 同步返回它；每个公开方法本身已返回 Promise。第一次实际方法调用才 `openScope`，并 singleflight；`has()`、取 token 和未调用的 client 不查数据库、不读凭据、不建 SDK、不发请求。

```ts
interface LazyInferenceOptions {
  readonly signal: AbortSignal;
  open(): Promise<InferenceClient>; // Host closure binds exact lease/principal/snapshot
}
```

此 helper 不允许调用者提交 ownerId、任意资源表、credential port、原始图或 latest resolver。Host 为 lazy opening 保留实际 lease；操作关闭时取消自己的未完成执行，关闭已创建或迟到创建的 client，最后释放该独立 lease，所有 close 幂等。代际 retirement 仅通知，不作为取消信号；显式 operation close、端点停止和 Host close 仍会取消。

如果底层不可取消的本地存储读取迟迟未完成，opening 的 lease 会保留到其结算，不能假称提前安全释放；不开新超时阈值。readonly opening 不会重放任何外部写操作。

## 流与逃逸

`stream()` 返回真实 OwnedRun，不返回 LanguageModel/SDK 对象。调用者必须在当前 command/tool execute 内消费，或显式 close。

```ts
const models = ctx.use(aiInferenceClientToken);
const run = await models.stream({ request });
try { for await (const event of run) { /* use events */ } }
finally { await run.close(); }
```

execute 返回即结束该 operation 的使用权。已返回但未消费的 run、被保存到外部变量的 client/run 都被关闭，不把泛型返回值称为自动安全的资源转移。若未来需要跨 operation 交接，必须另定正式所有权合同，本轮不增加。

## 影响文件及回归

- Feature Kit context/operation contracts；Command definition/index；Tool definition/index。
- Core InboundRuntime/MessageDispatcher 的实际 operation 传播；现有 command menu 的二次真实执行同样接入。
- AgentRuntime/CapabilityIngress 的 Tool operation 传播；CLI Host 负责 identity/open closure。
- `@zhin.js/ai-provider` 只提供 token 与 lazy-client 生命周期 helper，AI 引擎不反向依赖 Feature Kit/Core。

每项记录预期、实际证据和未覆盖范围：

1. 真正的 command.execute 与 tool.execute 内 `ctx.use(token).generate/evaluate`；验证实际 Profile、账号和权限拒绝的零请求。
2. use/has/未使用 client 为零 open/零凭据/零 HTTP；并发首次方法只 open 一次。
3. command 抛错、tool 返回、显式取消、请求失败、unknown outcome、未消费 stream、消费 break：client/Driver/lease 恰好释放一次。
4. HMR 后旧 operation 留在旧 Driver/图/账号，新 operation 用新代；retirement 不自动取消业务。
5. opening 期间 close、迟到 open、stream 首事件前 close、反复 close；不泄漏，不创建后续请求。
6. 普通消息字段/工具参数中伪造资源、账号、owner、角色、snapshot 均无效；公开 token 不暴露管理、密钥或 SDK。

生产路径只读合成 HTTP 和本地 deterministic 测试；没有实号调用、登录、凭据读取、发布或部署。
