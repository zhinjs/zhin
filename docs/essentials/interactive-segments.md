# Interactive / Keyboard Segment 适配器矩阵

交互按钮在 **Adapter.renderSendMessage** 中于 `resolveRichSegments` 之后由 `resolveKeyboardSegments`（别名 `resolveInteractiveSegments`）处理。

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

## Policy

| `interactivePolicy` | 行为 |
|---------------------|------|
| `native` | 保留 `keyboard` 段，由 Endpoint 渲染为平台按钮/卡片 |
| `text` | 降级为编号提示（`fallback`）；同条消息中的 `text` 段保留 |

## Adapter 一览

| Adapter | 出站 | 入站 `action` | 备注 |
|---------|------|---------------|------|
| sandbox / telegram / discord / kook / lark | native | native | 平台按钮或卡片；Telegram 需 `answerCallbackQuery` |
| qq（官方） | native | native | `button` + `markdown` 段；`notice.*.action` |
| onebot11 / napcat / icqq | text | — | OneBot v11 无标准键盘回调，出站降级为编号提示 |
| 其余 Platform Stable | text | — | 保证可玩 |

入站统一为 `action` 段：`{ type: 'action', data: { id, payload, sourceMessageId? } }`。

插件通过 `plugin.registerInteractiveHandler('prefix:', handler)` 注册回调；handler 返回 `true` 时短路 Dispatcher。

`segment.interactive()` 已废弃，请改用 `segment.text` + `segment.keyboard` + `segment.button`。
