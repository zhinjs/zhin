/**
 * 第二轮审计修复的回归测试
 * - grid-keyboard：postChoices 编号从可落子格子数后续起，不覆盖格子映射
 * - game-session：boardMessageMatches 尾缀要求段边界
 * - memory-db：findAll/findOne 返回拷贝
 * - game-records：按 Host/插件作用域取库
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGridKeyboard, type GridCell } from '../src/grid-keyboard.js';
import { boardMessageMatches } from '../src/game-session.js';
import { createInMemoryGameDb } from '../src/memory-db.js';
import {
  initGameRecordHost,
  recordGameOutcome,
  resetGameRecordsForTests,
  type GameRecordDatabaseHost,
} from '../src/game-records.js';
import { registerRuntimeGame, resetRuntimeGamesForTests } from '../src/runtime-hub.js';

describe('audit fixes: grid fallback 编号', () => {
  it('postChoices 编号从可落子格子数后续起，不覆盖格子映射', () => {
    // 3x3，其中 4 格已占用（disabled），剩 5 格可落子
    const cells: GridCell[] = Array(9)
      .fill(null)
      .map((_, i) => ({
        state: i < 4 ? 1 : 0,
        label: i < 4 ? 'X' : '·',
        disabled: i < 4,
      }));
    const content = buildGridKeyboard({
      gamePrefix: 'ttt',
      sessionId: 's1',
      rows: 3,
      cols: 3,
      cells,
      statusLine: '对局中',
      postChoices: [{ id: 'restart', label: '再来一局' }],
    });
    const kb = content[1] as { data: { fallback?: { map: Record<string, string> } } };
    const map = kb.data.fallback!.map;
    // 5 个可落子格子占 1..5
    expect(map['1']).toBe('ttt:s1:4');
    expect(map['5']).toBe('ttt:s1:8');
    // postChoices 从 6 开始，不覆盖格子
    expect(map['6']).toBe('ttt:s1:restart');
    expect(Object.keys(map)).toHaveLength(6);
  });
});

describe('audit fixes: boardMessageMatches 段边界', () => {
  it('全等或 composite 尾段匹配', () => {
    expect(boardMessageMatches('abc', 'abc')).toBe(true);
    expect(boardMessageMatches('bot1:abc', 'abc')).toBe(true);
    expect(boardMessageMatches('bot1:abc', 'bot1:abc')).toBe(true);
    expect(boardMessageMatches('x:abc', 'y:abc')).toBe(true);
  });

  it('无段边界的尾缀不误匹配', () => {
    expect(boardMessageMatches('x999:12345', 'x99912345')).toBe(false);
    expect(boardMessageMatches('sess:12345', 'msg99912345')).toBe(false);
    expect(boardMessageMatches('', 'a')).toBe(false);
    expect(boardMessageMatches('a', '')).toBe(false);
  });
});

describe('audit fixes: memory-db 返回拷贝', () => {
  it('findAll 返回的行是拷贝，改字段不影响库内数据', async () => {
    const db = createInMemoryGameDb(['sessions']);
    const model = db.models.get('sessions')!;
    await model.create({ id: 's1', status: 'active', score: 1 });
    const rows = await model.findAll({ id: 's1' });
    rows[0].status = 'hacked';
    rows[0].score = 999;
    const again = await model.findAll({ id: 's1' });
    expect(again[0].status).toBe('active');
    expect(again[0].score).toBe(1);
  });

  it('findOne 同样返回拷贝', async () => {
    const db = createInMemoryGameDb(['sessions']);
    const model = db.models.get('sessions')!;
    await model.create({ id: 's1', status: 'active' });
    const row = await model.findOne({ id: 's1' });
    row!.status = 'hacked';
    const again = await model.findOne({ id: 's1' });
    expect(again!.status).toBe('active');
  });
});

describe('audit fixes: game-records 按 Host 作用域取库', () => {
  beforeEach(() => {
    resetGameRecordsForTests();
    resetRuntimeGamesForTests();
  });

  function createHost() {
    const insert = vi.fn(async () => undefined);
    const model = {
      select: () => ({ where: async () => [] }),
      insert,
      delete: () => ({ where: async () => undefined }),
      update: () => ({ where: async () => undefined }),
    };
    const host: GameRecordDatabaseHost = {
      define: vi.fn(),
      models: { get: () => model },
    };
    return { host, insert };
  }

  const message = {
    $adapter: 'process',
    $endpoint: 'terminal',
    $sender: { id: 'u1', name: 'User' },
    $channel: { type: 'private', id: 'u1' },
  } as never;

  const gameMeta = {
    title: '骰子对决',
    icon: '🎲',
    description: 'desc',
    commandPrefix: '/骰子',
  };

  it('不同游戏写入各自插件 Host 的库，而非全局最后注册者', async () => {
    const diceHost = createHost();
    const blackjackHost = createHost();

    initGameRecordHost(diceHost.host);
    const unregDice = registerRuntimeGame({ id: 'dice', ...gameMeta });

    initGameRecordHost(blackjackHost.host);
    const unregBlackjack = registerRuntimeGame({ id: 'blackjack', ...gameMeta });

    await recordGameOutcome(message, 'dice', 'won', 10);
    await recordGameOutcome(message, 'blackjack', 'lost');

    expect(diceHost.insert).toHaveBeenCalledOnce();
    expect(blackjackHost.insert).toHaveBeenCalledOnce();
    // dice 的记录没有写进 blackjack 的库
    expect(diceHost.insert.mock.calls[0][0]).toMatchObject({ game_id: 'dice' });
    expect(blackjackHost.insert.mock.calls[0][0]).toMatchObject({ game_id: 'blackjack' });

    unregDice();
    unregBlackjack();
  });

  it('游戏注销后回退到全局活跃库', async () => {
    const diceHost = createHost();
    const otherHost = createHost();

    initGameRecordHost(diceHost.host);
    const unregDice = registerRuntimeGame({ id: 'dice', ...gameMeta });
    initGameRecordHost(otherHost.host);
    unregDice();

    await recordGameOutcome(message, 'dice', 'won');
    // 绑定已解绑，回退到全局最后活跃的 otherHost
    expect(otherHost.insert).toHaveBeenCalledOnce();
    expect(diceHost.insert).not.toHaveBeenCalled();
  });
});
