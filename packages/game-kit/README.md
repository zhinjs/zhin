# @zhin.js/game-kit

Zhin.js 游戏插件通用工具包，提供网格棋盘、会话管理等通用抽象。

## 安装

```bash
pnpm add @zhin.js/game-kit
```

## 功能

### 网格键盘 (`grid-keyboard.ts`)

构建任意尺寸的按钮网格棋盘（井字棋、五子棋等）。

### 选项键盘 (`choice-keyboard.ts`)

构建分支选项按钮（文字冒险、问答、剧情选择等）：

```typescript
import { buildChoiceKeyboard, parseChoicePayload } from '@zhin.js/game-kit';

const content = buildChoiceKeyboard({
  gamePrefix: 'adv',
  sessionId: 's123',
  narrative: '石门在前，雾霭缭绕……',
  choices: [
    { id: 'enter', label: '🚪 推门而入' },
    { id: 'leave', label: '🏃 离开', style: 'danger' },
  ],
  buttonsPerRow: 2,
  fallbackHint: '回复数字选择',
});
```

```typescript
import { buildGridKeyboard, parseGridPayload, parseCellButtonId } from '@zhin.js/game-kit';

// 构建 3×3 井字棋键盘
const content = buildGridKeyboard({
  gamePrefix: 'ttt',
  sessionId: 's123',
  rows: 3,
  cols: 3,
  cells: board.map((state, i) => ({
    state,
    label: state === 0 ? '·' : state === 1 ? '✕' : '○',
    disabled: state !== 0,
  })),
  statusLine: '轮到 玩家A (✕)',
  omitAsciiBoard: message.$adapter === 'qq',
  renderAscii: (cells, rows, cols) => { /* ... */ },
  fallbackHint: '回复数字 1-9 落子',
});

// 解析 action payload
const parsed = parseGridPayload('ttt:s123:4');
// => { prefix: 'ttt', sessionId: 's123', cell: 4 }

// 解析按钮 ID（QQ 等平台）
const cell = parseCellButtonId('c4');
// => 4
```

### 棋盘消息发送

消息发送/编辑由 `Adapter.editMessage()` 统一处理：

```typescript
import { channelKey } from '@zhin.js/game-kit';
import type { Adapter } from 'zhin.js';

// 构建频道键
const chKey = channelKey(message);

// 发送或编辑棋盘消息（Adapter 层统一接口）
const adapter = plugin.root.inject(message.$adapter) as Adapter;

if (session.board_message_id) {
  // Adapter.editMessage 内部处理平台差异：
  // - 支持编辑的平台（Discord、Telegram）：调用平台 API 编辑
  // - 不支持编辑的平台（QQ）：自动 fallback 到发送新消息
  const msgId = await adapter.editMessage({
    messageId: session.board_message_id,
    context: message.$adapter,
    endpoint: message.$endpoint,
    id: message.$channel.id,
    type: message.$channel.type,
    content,
  });
} else {
  const msgId = await message.$reply?.(content);
}
```

### 游戏会话 (`game-session.ts`)

通用回合制游戏会话接口：

```typescript
import {
  type TurnBasedSession,
  generateSessionId,
  currentPlayerId,
  isPlayerTurn,
  nextTurn,
} from '@zhin.js/game-kit';

// 会话结构
interface MyGameSession extends TurnBasedSession {
  board: number[];
}

// 回合验证
if (!isPlayerTurn(session, message.$sender.id)) {
  return '还没轮到你';
}

// 切换回合
session.turn = nextTurn(session.turn);
```

### 游戏大厅（`game` 服务）

与 `addCommand` 同构：在 root 上注册 **`game` 服务**，通过 `usePlugin().registerGame()` 登记游戏。

```typescript
import { ensureGameHubService } from '@zhin.js/game-kit';
import { usePlugin } from 'zhin.js';

const plugin = usePlugin();
ensureGameHubService(plugin); // 幂等，注册 game 服务

const { registerGame } = plugin;

registerGame({
  id: 'my-game',
  title: '我的游戏',
  icon: '🎮',
  description: '简介',
  commandPrefix: '我的游戏',
  menus: [{ id: 'start', label: '🎮 开始', style: 'primary' }],
  runAction: async (actionId, ctx) => { /* ... */ },
});
```

首个游戏 `registerGame` 后自动挂载 `游戏` / `game` 命令；卸载插件时 `onDispose` 对称清理。

## 架构原则

**平台能力封装在适配器层**：游戏代码不关心平台是否支持消息编辑，统一调用 `Adapter.editMessage()`，由各适配器内部决定是真编辑还是 fallback 到发新消息。

**入站文本中间件**：须用 `registerGameTextMiddleware(plugin, …)` 注册到 **root**（子插件 `addMiddleware` 不会进入入站管线）。

### Interaction Profile（按钮 mode 预设）

见 [ADR 0022](../../../docs/adr/0022-interactive-button-modes.md)。

| Profile | 默认 mode | 用途 |
|---------|-----------|------|
| `menu` | command（私聊）/ callback（群） | 游戏大厅、子菜单 |
| `gameplay` | callback | 棋盘、出拳、剧情分支 |
| `terminal` | command | 终局「再来一局」（私聊可 auto-enter） |

```typescript
import { buildChoiceKeyboard } from '@zhin.js/game-kit';

buildChoiceKeyboard({
  gamePrefix: 'hub',
  sessionId: scopeId,
  narrative: '…',
  choices: [/* … */],
  interactionProfile: 'menu',
});
```

文本入站统一用 `resolveGameTextPayload(raw, map)`（封装 core 的 `resolvePayloadFromText`）。

## 支持的游戏模式

| 功能 | 井字棋 | 五子棋 | 四子棋 | ...  |
|------|--------|--------|--------|------|
| 网格尺寸 | 3×3 | 15×15 | 7×6 | 任意 |
| 回合制 | ✓ | ✓ | ✓ | ✓ |
| 人机 | ✓ | 可选 | 可选 | ✓ |
| PvP 排队 | ✓ | ✓ | ✓ | ✓ |
