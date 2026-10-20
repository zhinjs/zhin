# Plugin Runtime

Plugin Runtime 负责 Plugin tree、generation 与 Root lifecycle，使同一套运行时既可由独立进程承载，也可嵌入其他 Host。

## Language

**Root Lifecycle**:
一棵 Plugin tree 从启动、generation handoff、停止接纳、drain 到资源释放的生命周期域；每棵树只有一个 Root lifecycle 权威。
_Avoid_: process lifecycle、global shutdown

**Process Host**:
承载一个或多个 Root Runtime 的进程级宿主；独占操作系统信号、进程退出和 supervisor 协调。
_Avoid_: Root Runtime、Plugin、signal handler module

**Runtime Stop**:
Root Runtime 提供的幂等停止过程，负责停止接纳、等待 generation lease 并释放所属资源，但不退出承载进程。
_Avoid_: process exit、signal shutdown

**Lifecycle Resource**:
归属于 Plugin generation、并通过 Root lifecycle 注册可等待释放过程的长期资源。
_Avoid_: process-global cleanup、fire-and-forget dispose

**Generation Admission**:
判断一个候选 generation 是否完整、可作为当前代对外服务的唯一决策；已配置且启用的 Resource 或 Capability 默认必须 ready，任一失败都拒绝整个候选代。
_Avoid_: best-effort commit、partial admission、soft-fail generation

**Atomic Publish**:
Generation Admission 成功后，以一次不可失败的状态交换把完整候选代变成当前代；它之前包含全部可失败工作，之后只允许不改变 committed outcome 的观察与旧代 lease drain。
_Avoid_: post-commit open、compensating publish、multi-step accept

**Generation View**:
一次 operation 通过 generation lease 获得的固定世界视图；该 operation 的 Config、Resource、Capability 与 projection 全程只能从此视图解析。
_Avoid_: current generation lookup、latest live value、module registry

**Desired Configuration**:
用户已持久化、希望 Root 达到的配置 revision；写入成功不等于对应 generation 已被接纳。
_Avoid_: pending rollback document、candidate config file

**Active Configuration**:
当前 committed generation 实际采用的配置 revision；只有 Generation Admission 成功后才会前进。
_Avoid_: latest file contents、desired config

**Configuration Drift**:
Desired Configuration 与 Active Configuration revision 不一致的显式状态，表示最新配置尚未接纳或已被拒绝。
_Avoid_: silent fallback、automatic file rollback

**Root Integrity Failure**:
候选清理、旧代退役或 Runtime Stop 无法完整释放 owned Resource，导致 Root 无法再证明唯一所有权的终态；Root 必须停止接纳新 operation 并要求 Process Host 重启。
_Avoid_: cleanup warning、degraded continue、best-effort running

**Root Admission**:
Root 是否接受新 operation 或 reconcile 的单一门；Runtime Stop 与 Root Integrity Failure 都先关闭此门，已持有 generation lease 的 operation 不受影响并继续 drain。
_Avoid_: per-Host accepting flag、watcher-only stop

**Required Resource**:
已配置且启用、因此必须在 Generation Admission 前 ready 的 Resource；失败意味着候选 generation 整体失败。
_Avoid_: configured optional、warn-and-continue

**Optional Resource**:
仅在配置或声明中被明确标记为 optional、允许从候选 generation 中完全缺席的 Resource；失败或缺席不得以 inert placeholder 进入当前代。
_Avoid_: implicit optional、soft-failed Resource

**Provisioning Lifecycle**:
位于 generation 之外、负责交互式认证、配对或凭据获取的临时生命周期；其成功结果只能形成配置变化，再由一次完整 generation 事务发布对应 Resource 或 Capability。
_Avoid_: deferred Resource、background activation、late open

**Shutdown Budget**:
Process Host 为一次优雅停止提供的全局时间预算；Root Runtime 与 Lifecycle Resource 不拥有进程级硬超时。
_Avoid_: Runtime timeout、Resource process exit

**Signal Escalation**:
Process Host 收到首个终止信号后进入优雅停止，再次收到终止信号时立即强制退出。
_Avoid_: duplicate signal handler、concurrent stop

## Relationships

- **Process Host** 可以承载一个或多个 Root Runtime，并为每棵树触发 **Runtime Stop**。
- **Process Host** 独占不能随 generation 安全复制、回滚或并行运行的基础设施，包括 HTTP listener、Database connection pool、文件 watcher 与 module loader；这些基础设施必须在 Root 的首次 Generation Admission 前 ready。
- **Root Lifecycle** 只把 Process Host 基础设施之上的不可变视图或 owner-scoped lease 纳入 generation，不在 handoff 中关闭、重建或转移其所有权。
- generation 事务只包含候选构建、验证、Required Resource readiness 与 **Atomic Publish**；旧代在 publish 前始终接纳操作，因此不存在通用 quiesce、resume 或 post-commit open 阶段。
- **Atomic Publish** 之后，旧代仅在其最后一个 operation lease 释放后退役并释放 Lifecycle Resource；观察者失败不得改变已经提交的 outcome。
- generation 状态只有 Root Lifecycle 发布的 **Generation View** 一个事实源；禁止模块级 generation registry、latest-value stack 以及公开 set/get/clear 槽位。
- **Desired Configuration** 独立持久化并触发 reconcile；失败时旧 **Active Configuration** 与 generation 保持不变，用户文件不回滚，并以 **Configuration Drift** 暴露失败 revision 与原因。
- 任一 candidate cleanup 或 retired generation disposal 失败都会形成 **Root Integrity Failure**；旧 lease 可以完成 drain，但 Root 不再接纳新 operation，也不得以 running 状态掩盖失败。
- Runtime Stop 先关闭 **Root Admission**；Atomic Publish 前的 reconcile 被取消并清理，已经 publish 的 outcome 保持 committed，随后与所有已取得 lease 的 operation 一起 drain。
- Runtime Stop、watcher drain、generation drain 与 Resource disposal 属于同一个幂等停止过程；重复停止观察同一个 settled outcome。
- **Root Lifecycle** 不注册进程级信号，也不决定进程退出码。
- **Process Host** 在独立启动模式下拥有信号升级、超时和最终退出。
- **Signal Escalation** 的首次干净停止退出码为 0，停止失败或超时为 1；再次 SIGINT/SIGTERM 分别强退为 130/143。
- **Lifecycle Resource** 的释放由 **Runtime Stop** 等待；Process Host 不按 Resource 类型执行额外清理。
- **Shutdown Budget** 耗尽或 Runtime Stop 聚合失败时，Process Host 以失败状态结束；Runtime Stop 仍尽量释放全部 Lifecycle Resource。
- 优雅停止完成后，**Process Host** 通过退出状态自然结束；只有 **Signal Escalation** 或 **Shutdown Budget** 耗尽才强制退出。

## 代级状态的唯一读取方式

每次入站、出站、Agent turn、Schedule execution 或 Console 请求只在 operation
开始时取得一次 generation lease，并在整个 operation 内使用同一个
**Generation View**。generation-owned callback 直接闭包持有所属代的 Resource；
Process Host Resource 通过显式 owner-scoped lease 注入。任何模块都不得查询
“最新活代”、维护跨 Root 的 generation 栈，或用测试复位函数清理生产全局状态。
