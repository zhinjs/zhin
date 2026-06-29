# ADR 0022：Interactive 按钮交互模式（callback / command）

## 状态

Accepted

## 背景

- QQ 官方消息按钮支持三种 `action.type`：跳转 (0)、回调 (1)、指令预填 (2)。
- Zhin core 已提供 `segment.keyboard` + `fallback.map` + 入站 `action` 段；QQ adapter 原先仅映射 type:1。
- 游戏插件已有双轨消费（`registerInteractiveHandler` + 文本 fallback），但缺少 SSOT 与选型规范。

## 决策

### D1. payload 为唯一语义（SSOT）

- 按钮 `payload` 格式不变（如 `ttt:s1:4`、`hub:scope:g_ttt`）。
- `fallback.map` 的值必须与 `payload` 一致。
- 插件 handler 只解析 payload，不区分入站来自 callback 还是 command 预填文本。

### D2. per-button `mode`

在 [`ButtonData`](../../packages/im/core/src/built/interactive-segments/types.ts) 扩展：

| 字段 | 说明 |
|------|------|
| `mode?: 'callback' \| 'command'` | 默认 `callback` |
| `command?: { enter?, reply? }` | 仅 QQ type:2 映射 |

### D3. 双入站路径

| mode | 出站（QQ） | 入站 |
|------|-----------|------|
| callback | type:1 | `action` 段 → `registerInteractiveHandler` |
| command | type:2（预填 `@bot {payload}`） | 普通文本 → `resolvePayloadFromText` → 现有文本中间件 |

- callback 入站由 `isActionMessage` 排除发言统计/旁听/transcripts。
- command 预填后用户发送的文本 **计入** 正常用户发言。

### D4. Interaction Profile（game-shared）

| Profile | 默认 mode | 场景 |
|---------|-----------|------|
| `menu` | command | 游戏大厅、子菜单 |
| `gameplay` | callback | 棋盘落子、出拳、剧情分支 |
| `terminal` | command（私聊 `enter:true`） | 终局「再来一局」 |

### D5. 其他 Adapter

- Telegram / Discord / KOOK 等：忽略 `mode`，仍走 callback。
- OneBot 系：`interactivePolicy: text`，无 native command；依赖 `fallback.map`。

## 后果

- 群聊 command 按钮：用户需预填后手动发送（QQ 限制）。
- 高频棋盘交互保持 callback，避免额外发送步骤与 `editMessage` 体验退化。
- 新增 core helper：`stripInteractiveCommandText`、`resolvePayloadFromText`。

## 相关

- [interactive-segments.md](../essentials/interactive-segments.md)
- [packages/im/core/src/built/interactive-segments/action.ts](../../packages/im/core/src/built/interactive-segments/action.ts)
- [plugins/adapters/qq/src/outbound-keyboard.ts](../../plugins/adapters/qq/src/outbound-keyboard.ts)
