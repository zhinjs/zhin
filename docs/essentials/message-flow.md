# 消息如何流转

> **L1～L2 推荐阅读**。读完这一页即可理解「回复该写在哪、事件什么时候触发」，无需先读架构长文。

## 入站（用户 → 机器人）

1. **平台 SDK / Bot** 收到原始事件，组装为框架的 `Message`，通常调用 **`adapter.emit('message.receive', message)`**。
2. **`Adapter` 对 `message.receive` 的处理是串行的**：
   - 先 **`await`** 根插件注入的 **`MessageDispatcher.dispatch(message)`**（若未注册 `dispatch` 会记错误日志，命令/AI 主路由不会执行）。
   - 再 **`await` 根插件** `dispatch('message.receive', message)`，触发插件生命周期（例如你在根插件上的 `plugin.on('message.receive')`、统一收件箱等）。
   - 最后按注册顺序**同步调用**本适配器上 **`adapter.on('message.receive', ...)`** 注册的函数——适用于**控制台 UI、调试观测**，**不要**用来做业务路由（业务请用 Dispatcher + 命令/AI 或 Guardrail）。
3. **`MessageDispatcher` 内部**（进阶）：**Guardrail** → **Route**（默认 **`exclusive`**：命令与 AI 互斥）→ **Handle**（`CommandFeature` / AI Handler）；需要「双轨」时在配置中设 `dispatcher.mode: dual` 等，见 [AI 模块](/advanced/ai.html#messagedispatcher-指令与-ai-路由)。

更完整的流程图见 [架构概览 - 消息处理流程](/architecture-overview.html#消息处理流程)。实现细节见仓库根目录 **`AGENTS.md`**。

## 出站（机器人 → 用户）

业务与框架应统一走：

1. **`message.$reply(...)`**，或 **`adapter.sendMessage(options)`**。
2. **`Adapter.sendMessage`** 内先 **`renderSendMessage`**：依次执行根插件上所有 **`before.sendMessage`**（可改写即将发出的内容）。
3. 再调用具体 **`bot.$sendMessage`** 发到平台。

由 Dispatcher 发起的润色会通过 **`replyWithPolish`** 与异步上下文配合 **`before.sendMessage`**，与手写 `$reply` 共用同一管道；细节见 [AI 模块 - 出站润色](/advanced/ai.html#messagedispatcher-指令与-ai-路由)。

## 相关链接

- [中间件与消息调度](/essentials/middleware) — 中间件与 Guardrail 的分工
- [术语表](/reference/glossary)
