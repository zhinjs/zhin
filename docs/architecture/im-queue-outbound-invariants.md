# IM / 队列 / 出站 — 架构不变量（短清单）

**Tier1**：与 [AGENTS.md](https://github.com/zhinjs/zhin/blob/main/AGENTS.md)（仓库根）一致；修改消息链或出站路径时先对照本文，再更新 [architecture-overview.md](../architecture-overview.md) 中的流程描述。

## IM 栈 — 入站

1. 平台/SDK 组装 `Message` 后，必须由 **`Adapter.emit('message.receive', message)`** 进入框架（见 `packages/core/src/adapter.ts`）。
2. 存在 `MessageDispatcher` 时：**`await dispatcher.dispatch(message)`** 先于根插件 **`message.receive`** 与 `adapter.on('message.receive')` 观察者。
3. 业务路由、命令与 AI 互斥策略由 Dispatcher 与配置决定；**不要**把业务路由绑在仅 `adapter.on('message.receive')` 上（该钩适合观测/控制台）。

## IM 栈 — 出站（勿绕开）

1. 业务发送须走 **`Message.$reply`** 或 **`Adapter.sendMessage`** → `renderSendMessage`（根插件 **`before.sendMessage`** 链）→ **`bot.$sendMessage`**。
2. **禁止**在插件/业务代码中直接调用 **`bot.$sendMessage`**（除非你是适配器包内 Bot 实现本身）。否则绕过 `before.sendMessage` 与 Dispatcher 润色同源逻辑。CI 通过 `pnpm check:harness-paths` 对部分路径做静态扫描。
3. Dispatcher 出站润色：仅当通过 **`replyWithPolish`** 等路径时，`getOutboundReplyStore()` 才有入站上下文；润色仍挂在根插件的 **`before.sendMessage`** 上。

## 队列栈（与 IM 平行）

本 monorepo **当前主分支**若尚未包含 `packages/queue-*` 实现，以下仍作为**契约与命名约定**，供引入 qbot / 双队列时对齐（避免与 IM 各造一套键名）：

1. 队列模式业务出站入口：**`enqueueOutgoing`**（及生产者侧 **`claimOutgoing` → `executeOutbound`**）；**不要**与 IM 栈的「经 Adapter 发送」混用或互相绕路。
2. 事件载荷推荐形状见 [event-contracts.md](./event-contracts.md)；与 IM 侧字段对齐见 [queue-im-field-contract.md](./queue-im-field-contract.md)。

## 工具 / 策略（Agent 相关）

1. 执行 shell 须经过 **`checkExecPolicy`**（`packages/agent/src/zhin-agent/exec-policy.ts`）与工具层封装；见 harness 测试 `packages/agent/tests/harness-inbound-tool-boundary.test.ts`。
2. 读文件：`read_file` 等工具组合使用 **`isBlockedDevicePath`**（设备挂起路径）与 **`checkFileAccess`**（敏感凭据路径）；见 `packages/agent/src/file-policy.ts`、`builtin-tools.ts`。
