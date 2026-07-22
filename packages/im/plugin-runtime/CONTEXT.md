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

**Shutdown Budget**:
Process Host 为一次优雅停止提供的全局时间预算；Root Runtime 与 Lifecycle Resource 不拥有进程级硬超时。
_Avoid_: Runtime timeout、Resource process exit

**Signal Escalation**:
Process Host 收到首个终止信号后进入优雅停止，再次收到终止信号时立即强制退出。
_Avoid_: duplicate signal handler、concurrent stop

## Relationships

- **Process Host** 可以承载一个或多个 Root Runtime，并为每棵树触发 **Runtime Stop**。
- **Root Lifecycle** 不注册进程级信号，也不决定进程退出码。
- **Process Host** 在独立启动模式下拥有信号升级、超时和最终退出。
- **Signal Escalation** 的首次干净停止退出码为 0，停止失败或超时为 1；再次 SIGINT/SIGTERM 分别强退为 130/143。
- **Lifecycle Resource** 的释放由 **Runtime Stop** 等待；Process Host 不按 Resource 类型执行额外清理。
- **Shutdown Budget** 耗尽或 Runtime Stop 聚合失败时，Process Host 以失败状态结束；Runtime Stop 仍尽量释放全部 Lifecycle Resource。
- 优雅停止完成后，**Process Host** 通过退出状态自然结束；只有 **Signal Escalation** 或 **Shutdown Budget** 耗尽才强制退出。
