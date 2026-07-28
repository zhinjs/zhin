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

## 模块级状态的正确姿势

插件热重载意味着同一份模块代码会被多个 generation 先后使用。裸的模块级
`let _x` 单例（repeater 单例、rss `_db` 一类 bug 的温床）会让新一代读到上一
代已释放的资源，或让旧代卸载时误清掉新代的值。正确姿势是
`createGenerationStore<T>(name)`（见 `src/generation-store.ts`）：

- **setup 阶段 `provide(context, value)`**：值按代际入栈，自动挂
  `context.lifecycle` 反注册——代际结束时该代的值被移除，上一代的值重新
  可见，结构上不可能悬挂到已释放的 generation。
- **运行时路径 `use()` / `tryUse()`**：工具 execute、Cron、事件回调里读取
  最新 live 值；`use()` 在无值时抛出含 store 名的错误，不要手写
  `if (!x) throw new Error('... not initialized')`。
- **多代并存取最新代**：栈顶（最新 live 注册）胜出；旧代先 dispose 不会
  误伤新代的值。
- **`clear()`** 仅供测试复位用。
- 旧的 `setXxx/getXxx` 公开 API 需要保留时，把 set 委托给一个 legacy 槽位
  （优先级低于 generation 注册），把 register/provide 路径迁到 store——参考
  `plugins/utils/lottery/src/lottery-agent-deps.ts` 与
  `plugins/utils/rss/src/db-store.ts`。
