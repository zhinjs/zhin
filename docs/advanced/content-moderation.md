# 内容审查（运营者自建）

Zhin.js **不提供** 内置敏感词库或默认内容审查。内容是否合规属于 **Bot 运营者的政策选择**，与司法辖区、平台规则、业务场景相关。

架构边界见 [ADR 0021](/adr/0021-content-moderation)。与 [消息过滤](/essentials/message-filter)（谁/哪群能进 Dispatcher）不同，本文讲的是 **文本说什么** 与 **是否允许走 LLM 回复路径**。

## AI Access Gate（平台 AIGC 合规）

QQ 等平台可能禁止 AIGC 内容进入社群或面向全量用户。框架内置 **`ai.access`**，在 AI Handler 入口 gate **仅 LLM 回复**；`/游戏`、斜杠命令、交互按钮等 **不受影响**。

与 `message_filter` 的区别：

| 机制 | 拦截范围 | 典型用途 |
|------|----------|----------|
| `message_filter` | 整条入站消息（命令 + AI 均不执行） | 垃圾群、全 bot 静默 |
| `ai.access` | 仅 `handleAIMessage` / LLM 路径 | QQ AIGC 白名单 |

### 配置

**推荐**：写在 `endpoints[]` 上，每个机器人独立控制（与 `master` / `trusted` 同级）：

```yaml
endpoints:
  - context: qq
    name: zhin-prod
    appid: ...
    secret: ...
    aiAccess:
      mode: whitelist
      users: ['openid-a']
      groups: ['group-openid']
      denyMessage: 当前未开放 AI，请联系管理员。
  - context: qq
    name: zhin-sandbox
    aiAccess:
      mode: open
```

**可选全局默认**（`ai.access`），当 Endpoint 未配置 `aiAccess` 时生效：

```yaml
ai:
  access:
    mode: closed
    denyMessage: 当前会话未开放 AI 功能。
```

合并优先级：**`ai.access` → `endpoints[].aiAccess`**（Endpoint 覆盖全局）。

字段说明：

- **open**：可触发 AI（默认，向后兼容）。
- **closed**：禁止 AI；群/频道 **静默**，私聊回复 `denyMessage`。
- **whitelist**：`sender.id ∈ users` **或** `channel.id ∈ groups` 时放行；否则同上。

实现：`checkAIAccess`（`@zhin.js/core`），在 `@zhin.js/agent` 注册 AI trigger 时于 `handleAIMessage` 开头调用；Endpoint 配置来自运行时 `endpoints[].$config.aiAccess`。

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
