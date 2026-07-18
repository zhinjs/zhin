# 插件生命周期

一个插件从「磁盘上的包」到「正在运行的实例」，要经过五个阶段：**发现 → 装配 → 代际切换 → 热重载 → 卸载**。理解这条链路，就能明白为什么约定目录不需要注册、为什么 `setup` 里登记清理函数是必须的。

```text
package.json (zhin 清单)
  → ① Discovery   解析插件图，Feature 扫描约定目录
  → ② Assembly    shadow 装配：加载 plugin.ts、执行 setup
  → ③ Handoff     代际切换：quiesce → activate → commit → open
  → ④ HMR         文件变更触发新一轮 ②→③，原子替换
  → ⑤ Dispose     旧代在最后一个租约释放后销毁
```

## ① Discovery：从清单到插件图

运行时以 **package.json 的 `zhin` 清单**为唯一事实来源（SSOT）：

- 项目根本身必须是 `"type": "plugin"` 的包（`zhin.entry` 指向它的 `plugin.ts`）。
- `zhin.plugins` 声明子插件：`{ "package": "...", "instanceKey": "..." }`。`instanceKey` 拼成插件 id（`root/<instanceKey>`），同时决定命令前缀与配置键。同一个包可以用不同 instanceKey 挂多个实例。
- 清单带 `protocol: 1` 与 `engine` 版本约束，不满足时直接拒绝加载；插件成环（A 挂 B、B 又挂 A）也会在构图阶段报错。
- 每个插件声明的 `zhin.features` 决定哪些 Feature provider 参与构建；provider 再按自己的**约定目录规则**扫描能力文件（`commands/`、`middlewares/`……）。

这一阶段只读文件系统和清单，不执行任何插件代码。

## ② Assembly：shadow 装配

装配在「影子（shadow）」状态下进行：所有成果先写进临时结构，**提交前对外不可见**，任何一步失败都会整体回滚，不会污染正在运行的一代。

对每个插件（**父先于子**）依次：

1. 加载 `zhin.entry` 指向的 `plugin.ts`，校验默认导出是 `definePlugin(...)`；
2. 校验 `requires` 声明的 Host Resource token 都已就位，缺失即装配失败；
3. 执行 `setup(context)`——`config` 来自 `schema.json` 默认值叠加 `zhin.config.yml` 的 `plugins.<instanceKey>`；
4. `setup` 返回的清理函数与 `context.lifecycle.add(...)` 一起登记进该插件的 DisposeStack。

::: tip 为什么 setup 里不能有「先用了再说」的全局副作用
setup 在 shadow 阶段执行，若随后装配失败，这一代会被整个丢弃。外部副作用（写文件、连远端）应尽量挂到 handoff 的 `activateNext`，或确保有对应的 dispose 清理。
:::

## ③ Handoff：代际切换

新代装配完成后，通过**代际交接（generation handoff）**原子替换旧代：

```text
quiescePrevious   旧代静默（停止接收新工作、排干在途调用）
activateNext      新代激活（启动连接、开始监听）
commit            提交不可变快照（此刻新代生效）
openNext          新代开放准入
旧代 dispose      等最后一个快照租约释放后执行
```

中途失败会按相反方向补偿：`deactivateNext`（撤销已激活的新代）→ `resumePrevious`（恢复旧代）→ 销毁候选代。

插件可以用 `context.handoff.add(participant)` 参与交接，participant 可实现的钩子：

| 钩子 | 时机 |
|------|------|
| `quiescePrevious(previous)` | 旧代静默时 |
| `activateNext()` | 新代激活时（**isolated 插件的 setup 在这一步执行**，见 ADR 0049） |
| `deactivateNext()` | 激活失败回滚时 |
| `resumePrevious()` | 静默失败回滚时 |
| `openNext()` | 提交完成后开放准入 |

## ④ HMR：热重载

编辑 `commands/`、`middlewares/` 等约定目录或插件源码，会触发一次新的 **generation transaction**：重新装配相关子树（②）→ 代际切换（③）→ 原子替换。全程不中断进程，命令索引、中间件链等投影随新快照一起生效。

需要进程级重启的变更（例如 Root 自身的某些改动）由 CLI 接管：运行时上报 `restart required`，CLI 退出并重启进程。`Ctrl+C` 会先排干当前代的在途消息再关闭。

## ⑤ Dispose：卸载顺序

- 每个插件的清理函数集中在它自己的 DisposeStack（`setup` 返回值 + `lifecycle.add` 登记的），按代回收时统一执行。
- 旧代快照采用**租约（lease）**计数：仍在处理中的消息持有租约，**最后一个租约释放后**旧代才真正销毁——所以在途命令不会用到一半被卸载。
- 进程停止时 Root 关闭整个快照存储，所有代按序回收。

## Root 与子插件的差异

| | Root（项目根） | 子插件 |
|---|---|---|
| 来源 | 项目自身的 package.json | `zhin.plugins` 挂载的包 |
| 命令命名 | bare（`/ping`） | 带 instanceKey 前缀（`/qrcode scan <url>`） |
| `runtime: isolated` | ❌ 不允许 | ✅ 可声明（Worker/子进程隔离，见 [ADR 0049](/adr/0049-isolated-plugin-runtime)） |
| 职责 | Host、模块加载、代际控制、进程生命周期 | 业务能力 |

::: info legacy 路径
旧 Feature registry（`usePlugin()`、`onMounted`/`onDispose`、根插件热更 `process.exit(51)`）属于 `zhin dev` 路径；本文描述的是约定式 Plugin Runtime 的生命周期。
:::

## 下一步

- [插件开发指南](/guide/plugin-development) — 从建包到发布的实操流程
- [插件系统](/essentials/plugins) — 约定目录与 Host Resources 参考
- [ADR 0049 Isolated Plugin Runtime](/adr/0049-isolated-plugin-runtime) — 隔离运行时的代际协议细节
