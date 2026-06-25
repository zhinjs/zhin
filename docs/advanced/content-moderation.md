# 内容审查（运营者自建）

Zhin.js **不提供** 内置敏感词库或默认内容审查。内容是否合规属于 **Bot 运营者的政策选择**，与司法辖区、平台规则、业务场景相关。

架构边界见 [ADR 0021](/adr/0021-content-moderation)。与 [消息过滤](/essentials/message-filter)（谁/哪群能进 Dispatcher）不同，本文讲的是 **文本说什么**。

## 为何不内置

- 词库因地区、行业、平台而异；框架 ship 词表易被理解为法律背书。
- 平台侧常有审核能力（如 QQ `MESSAGE_AUDIT` intent）。
- 模型 Provider 可能返回 `content_filter` 类结果。
- [ADR 0019](/adr/0019-install-size-layering) 要求 IM 核心保持极简。

## 推荐 hook

| 方向 | Hook | 时机 |
|------|------|------|
| 入站（用户 → AI） | `dispatcher.addGuardrail` | 路由 `message_filter` 之后、命令/AI 之前 |
| 出站（Bot → 平台） | `before.sendMessage` | `resolveRichSegments` 之后、适配器发送之前 |

出站须走统一发送链，勿绕过 `Adapter.sendMessage` / `Message.$reply`。

## 入站示例（Guardrail）

在插件初始化阶段注册（捕获 `plugin`，勿在 async 回调里 `getPlugin()`）：

```typescript
import { usePlugin, segment, type Message } from 'zhin.js';

const plugin = usePlugin();

function extractPlainText(message: Message): string {
  return segment.raw(message.$content);
}

/** 示例：命中则丢弃消息，不进入 AI */
plugin.useContext('dispatcher', (dispatcher) => {
  return dispatcher.addGuardrail(async (message, next) => {
    const text = extractPlainText(message);
    if (shouldBlock(text)) {
      // 可选：await message.$reply('消息未通过审核');
      return; // 不调用 next() → 后续命令/AI 不执行
    }
    await next();
  });
});

function shouldBlock(_text: string): boolean {
  // 运营者自备：关键词、OpenAI Moderation API、腾讯云 TMS 等
  return false;
}
```

改写而非拦截时，在 `next()` 前更新 `message.$content`（例如替换 `text` 段）。

## 出站示例（before.sendMessage）

```typescript
import { usePlugin, segment, type SendOptions } from 'zhin.js';

const plugin = usePlugin();

const handler = async (options: SendOptions) => {
  const { content } = options;
  if (!content) return options;

  const text = typeof content === 'string' ? content : segment.toString(content);
  const { filtered, blocked } = filterOutbound(text);
  if (blocked) {
    return { ...options, content: '⚠️ 消息未通过出站审查' };
  }
  if (filtered !== text) {
    return { ...options, content: filtered };
  }
  return options;
};

plugin.on('before.sendMessage', handler);
plugin.onDispose(() => plugin.off('before.sendMessage', handler));

function filterOutbound(text: string): { filtered: string; blocked: boolean } {
  // 运营者自备逻辑
  return { filtered: text, blocked: false };
}
```

## 常见外链方案

- **OpenAI Moderation API** — 在 Guardrail 或出站 hook 内 `fetch` 调用。
- **平台审核** — 依赖各 Adapter 文档（消息审核 intent、回调等）。
- **企业 DLP** — 通过 HTTP/MCP 在 Guardrail 中调用。

## 日志建议

- 记录：`messageId`、方向（inbound/outbound）、命中类别或 count。
- 避免：将命中词原文写入数据库或长期日志（防二次泄露）。

## 迁移说明

`@zhin.js/sensitive-filter` 已从 monorepo 移除。若曾使用该插件，请：

1. 从 `plugins:` 与 `package.json` 移除 `@zhin.js/sensitive-filter`。
2. 将审查逻辑迁入自有插件，挂上述 hook。
3. 词库由运营者自行维护，**不要** 从旧插件复制内置词表到生产环境而不经法务/运营审核。

## 相关

- [消息过滤](/essentials/message-filter)
- [ADR 0021：内容审查边界](/adr/0021-content-moderation)
- [发送链路](/essentials/message-flow)
