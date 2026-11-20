import { childPluginId, createCapabilitySlot, rootPluginId, type CapabilitySlot, type RuntimeSnapshot } from 'zhin.js';
import { gameActionWords, gameCommandAction } from '@zhin.js/game-kit';
import { CommandIndex, commandFeatureId, type CommandDefinition } from '@zhin.js/command';
// The real dispatcher (hub has no @zhin.js/core dependency of its own).
import { MessageDispatcher } from '../../../../packages/im/core/src/plugin-runtime/im/message-dispatcher.js';
import bj from '../../blackjack/commands/bj/[[action]]/index.ts';
import dice from '../../dice-duel/commands/dice/[[action]]/index.ts';
import dungeon from '../../dungeon-expedition/commands/dungeon/[[action]]/index.ts';
import guess from '../../guess-number/commands/guess/[[action]]/index.ts';
import chain from '../../idiom-chain/commands/chain/[[action]]/index.ts';
import roulette from '../../roulette/commands/roulette/[[action]]/index.ts';
import rps from '../../rps/commands/rps/[[action]]/index.ts';
import adv from '../../text-adventure/commands/adv/[[action]]/index.ts';
import ttt from '../../tic-tac-toe/commands/ttt/[[action]]/index.ts';
import riddle from '../../word-riddle/commands/riddle/[[action]]/index.ts';
import { RPS_ENTRY_MOVE_WORDS } from '../../rps/src/engine.ts';
import { ROULETTE_ACTION_WORDS } from '../../roulette/src/roulette-actions.ts';

/**
 * #1250 第 82 批: the old `middlewares/*-alias` entries are gone. Every spelling they took must reach
 * the command through the command system itself (route, `alias` or `match`), and the text they let
 * through must still not be a command.
 */
const root = rootPluginId();
const owner = childPluginId(root, 'games');
const commands = { bj, dice, dungeon, guess, chain, roulette, rps, adv, ttt, riddle } as const;

function slot(name: string, definition: unknown) {
  return createCapabilitySlot({ owner, feature: commandFeatureId, localName: `${name}/$action`,
    source: `/plugins/games/${name}/commands/${name}/[[action]]/index.ts`,
    definition: { ...(definition as CommandDefinition), $parameter: { name: 'action', type: 'string', optional: true, rest: false } } });
}

function snapshot(slots: readonly CapabilitySlot<CommandDefinition>[]): RuntimeSnapshot {
  return {
    generation: 1, root,
    tree: new Map([
      [root, { id: root, instanceKey: 'root', packageName: 'root', packageRoot: '/p', children: [owner] }],
      [owner, { id: owner, instanceKey: 'games', packageName: 'games', packageRoot: '/p/games', parent: root, children: [] }],
    ]),
    config: new Map([[root, { locale: 'zh-CN' }], [owner, {}]]),
    resources: new Map([[root, new Map()], [owner, new Map()]]),
    capabilities: new Map(slots.map(entry => [entry.id, entry])), projections: new Map(),
  } as RuntimeSnapshot;
}

/**
 * The same commands, each answering with what it was sent: the command the index actually selected
 * and the action text it received (route parameter or `match` group). Nothing in the test re-derives
 * the route; the CommandIndex reports it.
 */
const reporting = Object.fromEntries(Object.entries(commands).map(([name, definition]) => [name, {
  ...(definition as CommandDefinition),
  execute: (context: Parameters<typeof gameCommandAction>[0]) => ({ command: name, action: gameCommandAction(context) }),
}]));
const slots = Object.entries(reporting).map(([name, definition]) => slot(name, definition));
const games = snapshot(slots);
const index = new CommandIndex(slots, games);
(games.projections as Map<unknown, unknown>).set(commandFeatureId, index);

const conversation = { kind: 'group', id: 'g1', endpoint: { id: 'test-endpoint', adapter: 'test' } } as const;
const message = (content: string) => ({ content, conversation, sender: { id: 'alice' } }) as never;

/** Which game command `text` reaches, and with which action text, as the CommandIndex dispatches it. */
async function reach(text: string): Promise<{ readonly command: string; readonly action: string } | undefined> {
  const result = await index.dispatch({ input: text, source: message(text), commandPrefix: '', snapshot: games });
  if (!result.matched) return undefined;
  expect(result.status, text).toBe('executed');
  return result.value as { command: string; action: string };
}

/** The same through the real MessageDispatcher, with `prefix` as the adapter's command prefix. */
async function dispatched(text: string, prefix: string) {
  const result = await new MessageDispatcher(() => prefix).dispatch(message(text), games);
  return result.matched ? result.value as { command: string; action: string } : undefined;
}

// What each old alias middleware took over: its words, bare or with one word its action table knows.
const migrated: readonly (readonly [keyof typeof commands, readonly string[], readonly string[]])[] = [
  ['bj', ['21点', 'bj'], gameActionWords('bj')],
  ['dice', ['骰子', 'dice'], gameActionWords('dice')],
  ['dungeon', ['地牢', 'dungeon'], ['帮助', '开始', '状态', '加入', '准备', '出发', '探索', '攻击', '防御', '药水', '放弃', 'go', 'quit']],
  ['guess', ['猜数', 'guess'], gameActionWords('guess')],
  ['chain', ['接龙', 'chain'], gameActionWords('chain')],
  ['roulette', ['轮盘', '轮盘赌', 'roulette'], ROULETTE_ACTION_WORDS],
  ['rps', ['猜拳', 'rps'], [...gameActionWords('rps'), ...RPS_ENTRY_MOVE_WORDS]],
  ['adv', ['冒险', 'adv', '秘境'], gameActionWords('adv')],
  ['ttt', ['井字棋', 'ttt'], gameActionWords('ttt')],
  ['riddle', ['猜谜', 'riddle'], gameActionWords('riddle')],
];

describe('game short entries go through the command system (#1250 第 82 批)', () => {
  it('builds every game command into one index without route conflicts', () => {
    expect(index.conflicts()).toEqual([]);
  });

  describe.each(migrated)('%s', (command, words, actions) => {
    it('takes every word bare and with every known action', async () => {
      for (const word of words) {
        expect(await reach(word)).toEqual({ command, action: '' });
        for (const action of actions) expect(await reach(`${word} ${action}`), `${word} ${action}`).toEqual({ command, action });
      }
    });
  });

  it('leaves chat that starts with a short word alone (the middlewares let it through)', async () => {
    for (const text of ['二十一点 开会', '21点 开会', '二十一点 开始 吧', '骰子 是谁的', '猜数 好难', '接龙 今天天气不错',
      '轮盘 好刺激', '猜拳 谁输谁请客', '猜拳 s', '冒险 精神', '秘境 探险记', '猜谜 真有意思', '21点开始']) {
      expect(await reach(text), text).toBeUndefined();
    }
  });

  it('blackjack: `二十一点 开会` is chat, `二十一点 要牌` and the other actions are the game', async () => {
    expect(await reach('二十一点 开会')).toBeUndefined();
    expect(await reach('二十一点')).toEqual({ command: 'bj', action: '' });
    for (const action of ['要牌', '停牌', '开始', '继续', '退出', '放弃', '帮助']) {
      expect(await reach(`二十一点 ${action}`)).toEqual({ command: 'bj', action });
    }
    // The explicit spellings keep taking any action (and answer an unknown one with help).
    expect(await reach('玩二十一点 开会')).toEqual({ command: 'bj', action: '开会' });
    expect(await reach('bj 开会')).toEqual({ command: 'bj', action: '开会' });
  });

  // End to end through the real MessageDispatcher: the short entry follows the adapter's prefix
  // like every other command (no special `/` stripping any more).
  it('with prefix `/`: `/21点 开始` is the command, `21点 开始` is chat', async () => {
    expect(await dispatched('/21点 开始', '/')).toEqual({ command: 'bj', action: '开始' });
    expect(await dispatched('/接龙', '/')).toEqual({ command: 'chain', action: '' });
    expect(await dispatched('21点 开始', '/')).toBeUndefined();
    expect(await dispatched('接龙', '/')).toBeUndefined();
  });

  it("with prefix '': `21点 开始` is the command, `/21点` is not", async () => {
    expect(await dispatched('21点 开始', '')).toEqual({ command: 'bj', action: '开始' });
    expect(await dispatched('猜拳 石头', '')).toEqual({ command: 'rps', action: '石头' });
    expect(await dispatched('/21点', '')).toBeUndefined();
    expect(await dispatched('/21点 开始', '')).toBeUndefined();
    expect(await dispatched('二十一点 开会', '')).toBeUndefined();
  });
});
