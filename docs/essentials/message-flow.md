# 消息如何流转

> **L1～L2 推荐阅读**。读完这一页即可理解「回复该写在哪、事件什么时候触发」，无需先读架构长文。

## Endpoint 入站/出站能力

每个 **Endpoint** 实例可声明 `capabilities: ['inbound']`、`['outbound']` 或两者（默认继承 Adapter 上限）。能力与方法的对应关系：

| 能力 | 方法 |
|------|------|
| `inbound` | `$connect`、`$disconnect`、`$formatMessage` |
| `outbound` | `$sendMessage`、`$recallMessage`；入站 `Message` 上可绑定 `$reply` |
| 双向 | 全部 |

纯入站 endpoint（如仅 webhook 的 IoT）不实现出站方法；跨平台回复请 **`inject(outboundAdapter).sendMessage(...)`**。纯出站 endpoint（如通知推送）跳过 `$connect`，启动后 `$connected` 默认为 `true`。Endpoint 连接状态变化会通过 Plugin `endpoint.connect` / `endpoint.disconnect` / `endpoint.error` 与 `Notice`（`endpoint.lifecycle`）双通道发出。

## 入站（用户 → 机器人）

1. **平台 SDK / Endpoint** 收到原始事件，组装为框架的 `Message`，通常调用 **`adapter.emit('message.receive', message)`**。
2. **`Adapter` 对 `message.receive` 的处理是串行的**（`runInboundMessage`）：
   - 先走根插件 **`middleware` 链**（`addMiddleware` 注册；终端回调内才进入 Dispatcher）——用于 Prompt 等待、一次性监听等。
   - 再 **`await`** **`MessageDispatcher.dispatch(message)`**（Guardrail → 命令/AI；若未注册 dispatcher 则跳过）。
   - 再 **`await` 根插件** `dispatch('message.receive', message)`，触发插件生命周期（例如 `plugin.on('message.receive')`、统一收件箱）。
   - 最后**同步调用**本适配器上 **`adapter.on('message.receive', ...)`** 观察者——适用于**控制台 UI、调试观测**，**不要**做业务路由。
3. **`MessageDispatcher` 内部**（进阶）：**Guardrail** → **Route**（默认 **`exclusive`**：命令与 AI 互斥）→ **Handle**（`CommandFeature` / AI Handler）；需要「双轨」时在配置中设 `dispatcher.mode: dual` 等，见 [AI 模块](/advanced/ai.html#messagedispatcher-指令与-ai-路由)。

更完整的流程图见 [架构概览 - 消息处理流程](/architecture-overview.html#消息处理流程)。实现细节见仓库根目录 **`AGENTS.md`**。

## 出站（机器人 → 用户）

业务与框架应统一走：

1. **`message.$reply(...)`**，或 **`adapter.sendMessage(options)`**。
2. **`Adapter.sendMessage`** 内先 **`renderSendMessage`**（两阶段）：
   - **① `resolveRichSegments`**：按 Adapter policy 将 `html` / `markdown` / `tts` / `qrcode` 等 Rich Segment 转为标准 IM 段（未装 optional peer 或转码失败时降级 `text`，见 [Rich Segment](/essentials/rich-segment-adapters)）。
   - **② `before.sendMessage`**：根插件监听器（润色、AI 纯文本转图、出站内容审查等）——在 Rich Segment 渲染**之后**执行。
3. 再调用 **`endpoint.$sendMessage`** 发到平台（各 adapter 可选 **`materializeOutboundMedia`** 上传 base64/本地文件）。

由 Dispatcher 发起的润色会通过 **`replyWithPolish`** 与异步上下文配合 **`before.sendMessage`**，与手写 `$reply` 共用同一管道；细节见 [AI 模块 - 出站润色](/advanced/ai.html#messagedispatcher-指令与-ai-路由)。

### HTML 卡片出站（可选出图）

业务插件只需返回 **`segment.html({ html })`**，不必手写文本回退：

```ts
import { segment } from 'zhin.js';

return segment.html({
  html: buildMyCardHtml(data),
  width: 540,
  backgroundColor: '#d8dce3',
});
```

| 场景 | 行为 |
|------|------|
| 已安装 **`@zhin.js/html-renderer`** | `renderSendMessage` 首步按 Adapter policy 将 `html` / `markdown` 段转为 PNG `image` 段 |
| 未安装或转图失败 | 自动降级为可读纯文本发出（warn 一次） |
| 需要高质量回退 | 可选传 `text` 覆盖自动剥离（高级用法） |

卡片 HTML 建议用 **`@zhin.js/satori`** 的 `h()` 与内置组件构建（与 IM 的 zhin.js JSX 分离）。详见 [`@zhin.js/html-renderer`](https://github.com/zhinjs/zhin/tree/main/packages/toolkit/html-renderer) 与 [`plugin-group-suite` README](https://github.com/zhinjs/zhin/tree/main/plugins/utils/group-suite)。

## 相关链接

- [中间件与消息调度](/essentials/middleware) — 中间件与 Guardrail 的分工
- [术语表](/reference/glossary)
