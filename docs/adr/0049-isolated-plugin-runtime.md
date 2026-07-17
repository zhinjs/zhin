# ADR 0049: Isolated Plugin Runtime

## 状态

Accepted；全新项目目标架构。

## 背景

Plugin tree 需要允许高计算、易崩溃或需要独立事件循环的 child Plugin 与 Host 分离，同时继续服从 Root 的 generation transaction、HMR、配置所有权和 children-first dispose。直接把 Plugin setup 放进 Worker 并不足够：如果 setup 在 shadow prepare 阶段产生外部副作用，候选失败会污染 active generation；如果任意 Scope value 或函数可跨边界，又会失去可审计的能力边界。

## 决策

### D1. Runtime 只依赖 Port

`@zhin.js/next-runtime` 定义 `IsolatedPluginRuntimePort`。Node Worker/child-process 实现在可选 `@zhin.js/next-isolate` 包中，默认 trusted Runtime 不增加依赖。

只有 child Plugin 可以声明 `runtime: isolated`。Root 负责 Host、ModuleRuntime、generation controller 与进程关闭，不能把自身移出该生命周期域。

### D2. Prepare 与 Activate 分离

adapter 的 `prepare()` 只创建隔离实例、加载 entry、校验 Plugin definition 和 structured-clone descriptor。Plugin `setup()` 在 generation handoff 的 `activateNext()` 执行。

切换顺序固定为：

```text
prepare candidate
  -> quiesce previous admission
  -> drain previous in-flight RPC
  -> activate candidate setup
  -> commit immutable snapshot
  -> open candidate admission
  -> dispose previous after its last snapshot lease
```

commit 前失败会 deactivate candidate、resume previous 并销毁候选 Scope。候选与旧实例的引用由 adapter 实例按 owner 管理，不使用进程全局 active registry。

### D3. 跨边界数据必须显式且可克隆

Host 只向 owner Scope 注入 `IsolatedPluginHandle`。隔离侧只内建：

- 冻结的 owner config。
- `RuntimeEnvironment` identity。
- `IsolatedChannel`，用于注册 Plugin RPC、发事件和调用 Host allowlist method。

Host Scope、EnvStore、数据库连接、自定义 Token、函数与 Endpoint 不跨边界。所有 request、response、event、config 和 metadata 都在发送前验证 structured clone。

普通 Feature definition 含行为函数和闭包，因此 isolated Plugin 暂时不能 mount Host Feature provider。未来支持必须由具体 Feature 提供隔离 codec 与 Host proxy，不增加通用函数序列化后门。

### D4. 超时与崩溃使实例失效

请求超时后，远端操作可能仍在执行。adapter 必须把实例标记为 failed、拒绝 pending request 并终止 transport，不能仅从 Host 请求表删除该调用。意外 exit 同样进入 failed，并通过 `onCrash(owner, error)` 上报。

同一 generation 内不自动重启。恢复通过一次新的 generation transaction 完成，确保 config、资源与 snapshot identity 一致。

### D5. 两种 Node Transport 使用同一协议

- `worker`：默认，启动快、内存共享进程但事件循环和 JS realm 独立。
- `process`：更强的崩溃与内存边界，使用 advanced IPC serialization。

协议、状态机和 handoff 不因 transport 改变。bootstrap 是自包含源码，不依赖 Vite 或运行时编译器。

## 安全说明

本决策提供故障与并发隔离，不声称安全沙箱。Worker 和 child process 仍继承 Host 用户的 OS 权限。执行不可信 Plugin 必须叠加进程外 sandbox、容器或操作系统权限控制。

## 后果

- isolated Plugin HMR 可以局部创建新 Worker/进程，并在旧调用 drain 后原子切换。
- Host 资源访问变为显式、可审计的 RPC allowlist。
- 隔离 Plugin 暂时不能直接携带 commands/pages 等普通 Host Feature；需要后续定义 Feature-specific proxy contract。
- 默认 Zhin 安装不承担隔离 adapter 的包体积。

## 验证

- Worker 与 process transport 均覆盖双向 RPC、事件和 structured-clone 拒绝。
- Runtime tracer 覆盖旧实例 drain、新实例开放、候选 setup 失败恢复与 isolated entry 不被 Host import。
- Worker 异常退出覆盖 pending request 拒绝、failed 状态与 crash callback。
- 安装体积门禁覆盖 isolate + Runtime 的完整 production dependency closure。
