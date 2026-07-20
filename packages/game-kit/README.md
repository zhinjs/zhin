# @zhin.js/game-kit

Zhin.js Plugin Runtime 游戏工具包。它提供交互键盘、游戏会话、战绩、Runtime 游戏大厅、
DatabaseHost 适配和文本 fallback，不依赖 `zhin.js` facade。

## 安装

```bash
pnpm add @zhin.js/game-kit @zhin.js/command @zhin.js/middleware
```

## Runtime 插件

游戏包通过 `plugin.ts` 在 generation 生命周期登记大厅元数据，并由约定目录暴露交互：

```ts
import { definePlugin } from '@zhin.js/plugin-runtime';
import { registerRuntimeGame } from '@zhin.js/game-kit';

export default definePlugin({
  name: 'my-game',
  setup(context) {
    const dispose = registerRuntimeGame({
      id: 'my-game',
      title: 'My Game',
      icon: 'GAME',
      description: 'A turn-based game',
      commandPrefix: '/my-game',
      quickStart: 'start',
    });
    context.lifecycle.add(dispose);
  },
});
```

- `commands/<name>/[action:string=].ts` 定义命令。
- `middlewares/` 处理按钮 payload、裸文本答案和旧命令别名。
- `registerRuntimeGame()` / `getRuntimeGames()` 是大厅 SSOT，dispose 时对称移除。
- `DEFAULT_GAME_STALE_CRON` 与 `scheduleHostToken` 用于清理超时会话。

## 交互消息

```ts
import { buildChoiceKeyboard, buildGridKeyboard } from '@zhin.js/game-kit';

const menu = buildChoiceKeyboard({
  gamePrefix: 'adv',
  sessionId: 's123',
  narrative: 'Choose a path',
  choices: [
    { id: 'enter', label: 'Enter' },
    { id: 'leave', label: 'Leave', style: 'danger' },
  ],
  interactionProfile: 'gameplay',
});

const board = buildGridKeyboard({
  gamePrefix: 'ttt',
  sessionId: 's123',
  rows: 3,
  cols: 3,
  cells: Array.from({ length: 9 }, () => ({ state: 0, label: '.', disabled: false })),
  statusLine: 'Your turn',
});
```

`plainTextFromSendContent()` 会在无编辑能力或 text-only 路径移除按钮并保留正文；平台差异
仍由 Adapter 出站链处理。`messageFromCommandInput()` 把 Runtime `Message` 转成游戏引擎使用
的稳定 message-like 结构。

## 数据

- `createInMemoryGameDb()`：测试与无数据库配置时的完整内存实现。
- `createHostGameDb()`：把 generation-owned `DatabaseHost` 转成 SessionService 所需接口。
- `initGameRecordHost()` / `recordGameOutcome()`：统一战绩表与结果写入。
- `channelKey()` / `generateSessionId()`：稳定会话身份。

游戏包应优先使用 `databaseHostToken`，缺失时显式回退内存；不从模块全局读取旧 Plugin。

## 验证

```bash
pnpm --filter @zhin.js/game-kit build
pnpm vitest run plugins/games/*/tests
```

交互 profile 见 [ADR 0022](../../docs/adr/0022-interactive-button-modes.md)，Plugin Runtime
迁移边界见 [ADR 0050](../../docs/adr/0050-plugin-runtime-migration-boundary.md)。
