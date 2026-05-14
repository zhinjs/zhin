# Bridge v1：NoneBot matcher 与 zhin 入站链语义

## 状态

已采纳（v1）。细化自 [PRD：NoneBot2 与喵崽 IPC 胶水层（v1）](https://github.com/zhinjs/zhin/issues/404)；落实 [HITL #405](https://github.com/zhinjs/zhin/issues/405) 验收项。

## 背景

NoneBot2 的 matcher 在子进程内可通过 `stop_propagation` 等机制**阻止后续 matcher** 继续执行。zhin Core 侧 glue 节点插在 **Inbound Runner** 的串行链（与 **Message Dispatcher**、根插件顺序等配合）上。若不书面约定，容易误以为「NB 不再向下匹配」等价于「zhin 不再跑后续节点」。

词汇对齐：`packages/core/CONTEXT.md`（**Inbound Runner**、**Message**、**Message Dispatcher**、**Guardrail** 等）。

## 决策

### v1 默认：(a) 子进程内语义与父链解耦

- **(a)（v1 默认）**：NoneBot 的「阻断 / 仅影响子进程内后续 matcher」**仅作用于子进程内的 NB 调度**；**不**自动映射为停止 zhin 入站链上 glue 之后的节点。父进程是否停止后续 zhin 节点，**仅**由 IPC **`dispatch` 完成帧**里**显式**给出的字段决定（见下节）。
- **(b)（非默认 / 后续可选）**：允许在配置中将**特定** NB 结果模式映射为「停止 zhin 下游」；v1 **不实现**该映射，以免运维在未能区分两种「停止」时产生隐性耦合。若将来引入 (b)，必须在 **Primary Config** 中显式开启并文档化每一种映射规则；默认仍为 (a)。

### 父进程可消费的 `dispatch` 结果契约（最小字段集）

以下字段描述**单次** glue 节点对父进程的一次 `dispatch` 往返结束后，父进程应写入的**规范化结果**（可挂在与本次入站关联的上下文对象上，具体类型名由实现决定；语义以本文为准）。

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `bridgeStatus` | 枚举 | 是 | `ok`：子进程在 K1 时限内返回合法完成帧。`timeout`：触发 **K1** 软超时（父侧计时，未收到合法完成帧）。`error`：子进程报错、IPC 帧非法、协议错误等。`disabled`：该 glue 模块已被 supervisor 标记为禁用（例如版本不匹配后禁用），本次未执行或未完整执行子侧逻辑。 |
| `shortCircuit` | `boolean` | 否（默认 `false`） | **仅当** `bridgeStatus === "ok"` **且** 子进程在**完成帧**中**显式**请求为 `true` 时，父进程才**跳过**本 glue 节点之后在 **Inbound Runner** 串行链上的**后续**节点（对「glue 之后还有哪些节点」由集成顺序定义）。**禁止**由父进程根据 NB 内部 `stop_propagation` 等推断为 `true`。 |
| `handled` | `boolean` | 否 | 子进程可选上报：在 NB 语义下是否认为事件已被处理（观测、指标用）。**不**改变 zhin 链是否继续；**不**等价于 `shortCircuit`。 |

枚举扩展：若未来增加新状态，应保证旧父进程能降级理解为 `error` 或单独扩展版本位；v1 实现仅须支持上表四值。

### 与 K1 软超时、L1 默认继续的优先级

1. **K1 先触发**：父进程将 `bridgeStatus` 置为 `timeout`。适用 PRD **L1**：**默认继续**执行 glue 之后的 zhin 链节点。此时**不**承认子进程可能已部分写出但未成帧的 `shortCircuit`；超时路径下 **`shortCircuit` 视为 `false`**。
2. **子进程在 K1 内返回合法完成帧**：解析帧内容；`bridgeStatus = ok`；按帧内显式字段设置 `shortCircuit`（缺省 `false`）与可选 `handled`。
3. **`error` / `disabled`**：不执行子侧成功路径语义；`shortCircuit` 缺省 `false`。下游是否继续仍遵循 L1：**默认继续**，除非将来另有全局策略 ADR；v1 与超时一致，**不因** `error` 自动短路后续节点（避免 glue 一次失败静默吞掉整段 Inbound Runner）。

> **边界写清**：「`shortCircuit === true` 时停止后续节点」**仅**在 `bridgeStatus === "ok"` 且子进程显式请求时生效。「超时 ⇒ `bridgeStatus=timeout`」与「子进程请求短路」**互斥**：超时分支不采用子进程短路意图。

## 后果

- NoneBot 插件作者在子进程内仍按 NB 文档使用 matcher 阻断；zhin 侧插件作者要看 **`dispatch` 返回**才知道是否短路父链。
- 端到端实现与契约测试应断言：`timeout` + 默认继续、`ok` + `shortCircuit: true` 时后续 runner 节点不被调用等。

## 相关

- PRD [#404](https://github.com/zhinjs/zhin/issues/404) 实现决策中的 **K1 / L1** 与 matcher 映射条目。
- Issue [#405](https://github.com/zhinjs/zhin/issues/405) 验收：选项 (a)/(b)、dispatch 契约、与超时优先级。
