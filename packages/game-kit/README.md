# @zhin.js/game-kit

Zhin.js Plugin Runtime 游戏工具包。它提供交互键盘、游戏会话、战绩、Runtime 游戏大厅、
DatabaseHost 适配和文本 fallback，不依赖 `zhin.js` facade。

## 安装

```bash
pnpm add @zhin.js/game-kit @zhin.js/command @zhin.js/middleware
```

## Runtime 插件

游戏包通过 `defineGamePlugin()` 声明数据库表、服务和大厅元数据。数据库双轨、
服务发布、跨游戏会话协调、超时 cron 与 HMR 清理由 game-kit 统一装配：

```ts
import { defineGamePlugin } from '@zhin.js/game-kit';

export default defineGamePlugin({
  name: 'my-game',
  game: {
    id: 'my-game',
    title: 'My Game',
    icon: 'GAME',
    description: 'A turn-based game',
    commandPrefix: '/my-game',
    quickStart: 'start',
  },
  tables: ['my_game_sessions'],
  servicesToken: myGameServicesToken,
  defineHostTables,
  createServices,
  session: (services) => services.sessions,
});
```

- `commands/<name>/[[action]].ts` 定义命令（可选参数；在 `defineCommand({ params })` 中声明 `action` 的类型与默认值）。
- `middlewares/` 处理按钮 payload、裸文本答案和旧命令别名。
- `defineGamePlugin()` 通过 `addGame` 发布 Game capability；`GameIndex` 是整代 snapshot
  的大厅 SSOT，命令通过 `context.project(gameFeatureId)` 读取。
- `DEFAULT_GAME_STALE_CRON` 与 `scheduleHostToken` 用于清理超时会话。
- `defineGamePlugin()` 在存在 `outboundHostToken` 时自动通知超时会话所在频道。
- 每个游戏包定义自己的 typed service token；`plugin.ts` 提供资源，command/middleware
  通过 Capability Context 的 `use(token)` 消费。禁止以模块变量保存当前 SessionService。

## 会话与事件

游戏 SessionService 继承 `BaseSessionService<TRow>`，只负责构造游戏自己的初始行：

```ts
class SessionService extends BaseSessionService<MySessionRow> {
  constructor(database: MyDatabase) {
    super(database, {
      gameId: 'my-game',
      table: 'my_game_sessions',
      userFields: ['player_id'],
    });
  }

  createSession(input: StartInput) {
    return this.createRow(createInitialRow(input));
  }
}
```

基类统一提供 `getById()`、用户/频道活动会话查询、`updateSession()`、`abortStale()`
和跨游戏冲突检查。每个 SessionService 的 `events` 发布 `game:start`、`game:end`、
`turn:change`、`session:timeout`；事件总线属于服务实例，监听器失败不会回滚已经持久化的
会话变化。

SessionService 可用 `projectOutcomes` 把终局行投影为玩家结果。`defineGamePlugin()` 订阅
`game:end` 并统一写入战绩，game-flow 不再直接触碰战绩数据库。

`GameIndex` 从当前 snapshot 的 Game capability 一次性构造 `GameSessionCoordinator`，再把
该代的可用性视图绑定到各 SessionService。不同 Root 与不同 generation 没有共享注册表，
旧代释放不会改变新代的协调关系。

### 长生命周期与并发

多人或长生命周期游戏继承 `VersionedSessionService<TRow>`。Session 行额外保存
`revision` 和 `processed_actions`：

```ts
const result = await sessions.mutateSession(sessionId, {
  actionId: `${messageId}:attack`,
  expectedRevision: buttonRevision,
  apply: (session) => ({
    hp: session.hp - 10,
  }),
});
```

- `SessionActionGate` 串行化同一进程内针对同一 Session 的操作。
- `expectedRevision` 提供持久化乐观锁，拒绝旧按钮和跨进程并发覆盖。
- `processed_actions` 保存有界幂等历史，Adapter 重投不会重复结算。
- 超时清理以扫描到的 `updated_at` 作为更新条件；扫描后发生的新动作不会被误终结。
- `DeterministicRandom` 可保存 `state` 并由 `fromState()` 恢复，用于存档续玩、回放和
  大规模确定性模拟；密钥等安全场景仍必须使用 `secureRandomInt()`。

完整参考实现见
[`plugins/games/dungeon-expedition`](../../plugins/games/dungeon-expedition/)。

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
- `createMemoryGameServices()`：把 typed service factory 接到唯一内存实现。
- `createHostGameDb()`：把 generation-owned `DatabaseHost` 转成 SessionService 所需接口。
- `GameRecordStore`：每个游戏实例显式持有自己的战绩库，并作为 `GameRecordPort`
  随 Game capability 投影给大厅；不存在全局当前数据库。
- `channelKey()` / `generateSessionId()`：稳定会话身份。

游戏包应优先使用 `databaseHostToken`，缺失时为每个插件实例创建独立内存库。数据库、
SessionService、cron 闭包都属于同一个 owner generation；热更卸载旧代不会覆盖新代状态。

## 验证

```bash
pnpm --filter @zhin.js/game-kit build
pnpm vitest run plugins/games/*/tests
```

交互 profile 见 [ADR 0022](../../docs/adr/0022-interactive-button-modes.md)，Plugin Runtime
迁移边界见 [ADR 0050](../../docs/adr/0050-plugin-runtime-migration-boundary.md)。
