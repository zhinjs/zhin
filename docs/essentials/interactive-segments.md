# Interactive / Keyboard Segment 适配器矩阵

交互按钮在 **Adapter.renderSendMessage** 中于 `resolveRichSegments` 之后由 `resolveKeyboardSegments`（别名 `resolveInteractiveSegments`）处理。

详见 [ADR 0022](../adr/0022-interactive-button-modes.md)。

## 出站 API

```typescript
import { segment } from 'zhin.js';

await message.$reply([
  segment.text('轮到 @玩家'),
  segment.keyboard([
    [
      segment.button({ id: 'c0', label: '·', payload: 'game:s1:0' }),
      segment.button({ id: 'c1', label: '✕', payload: 'game:s1:1', disabled: true }),
    ],
  ], { fallback: { hint: '回复 1-9', map: { '1': 'game:s1:0' } } }),
]);
```

- `segment.button()` — 单个按钮定义（布局单元，非独立消息段）
- `segment.keyboard(rows, options?)` — 二维按钮布局；文本用 `segment.text` 单独组合

### 按钮 mode（QQ 等 native 平台）

```typescript
segment.button({
  id: 'hub1',
  label: '井字棋',
  payload: 'hub:scope:g_ttt',
  mode: 'command',              // 默认 callback
  command: { enter: true },     // 仅 QQ 单聊 auto-send
});
```

| `mode` | QQ `action.type` | 入站 |
|--------|------------------|------|
| `callback`（默认） | 1 | `action` 段 |
| `command` | 2（输入框预填 `@bot {payload}`） | 用户发送后的文本 |

**选型口诀**：高频 / 需 `editMessage` → `callback`；低频菜单 / 终局确认 → `command`。

## Policy

| `interactivePolicy` | 行为 |
|---------------------|------|
| `native` | 保留 `keyboard` 段，由 Endpoint 渲染为平台按钮/卡片 |
| `text` | 降级为编号提示（`fallback`）；同条消息中的 `text` 段保留 |

## Adapter 一览

| Adapter | 出站 | callback 入站 | command 入站 |
|---------|------|---------------|------------|
| sandbox / telegram / discord / kook / lark | native | `action` | 仍 callback（忽略 mode） |
| qq（官方） | native | `notice.*.action` | 预填文本 → `resolvePayloadFromText` |
| onebot11 / napcat / icqq | text 降级 | — | 同 text 降级 |
| 其余 Platform Stable | text | — | — |

入站 callback 统一为 `action` 段：`{ type: 'action', data: { id, payload, sourceMessageId? } }`。

## 插件 Checklist

1. **payload SSOT** — `fallback.map` 值与 `segment.button({ payload })` 一致。
2. **双注册** — `registerInteractiveHandler('prefix:', …)` + 文本中间件（`resolvePayloadFromText`）。
3. **统计边界** — callback 入站由 `isActionMessage` 排除；command 文本计入正常发言。
4. **游戏插件** — 优先用 `@zhin.js/game-shared` 的 `interactionProfile`（`menu` / `gameplay` / `terminal`）。

```typescript
import { resolvePayloadFromText } from 'zhin.js';

const payload = resolvePayloadFromText(message.$raw ?? '', fallbackMap);
```

插件通过 `plugin.registerInteractiveHandler('prefix:', handler)` 注册回调；handler 返回 `true` 时短路 Dispatcher。

`segment.interactive()` 已废弃，请改用 `segment.text` + `segment.keyboard` + `segment.button`。
