import { childPluginId, createCapabilitySlot, rootPluginId, type CapabilitySlot, type RuntimeSnapshot } from 'zhin.js';
import { gameActionWords, gameCommandAction } from '@zhin.js/game-kit';
import { CommandIndex, commandFeatureId, type CommandDefinition } from '@zhin.js/command';
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

const slots = Object.entries(commands).map(([name, definition]) => slot(name, definition));
const index = new CommandIndex(slots, snapshot(slots));

/** Which game command `text` reaches, and with which action text. */
function reach(text: string): { readonly command: string; readonly action: string } | undefined {
  if (!index.routes(text)) return undefined;
  for (const [name, definition] of Object.entries(commands)) {
    const route = text.split(/\s+/u);
    const words = [name, ...((definition as CommandDefinition).alias ?? [])];
    if (words.includes(route[0]!)) return { command: name, action: route.slice(1).join(' ') };
    const match = (definition as CommandDefinition).match?.exec(text);
    if (match) return { command: name, action: gameCommandAction({ params: { action: '' }, match }) };
  }
  throw new Error(`routed to no game command: ${text}`);
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
    it('takes every word bare and with every known action', () => {
      for (const word of words) {
        expect(reach(word)).toEqual({ command, action: '' });
        for (const action of actions) expect(reach(`${word} ${action}`), `${word} ${action}`).toEqual({ command, action });
      }
    });
  });

  it('leaves chat that starts with a short word alone (the middlewares let it through)', () => {
    for (const text of ['二十一点 开会', '21点 开会', '二十一点 开始 吧', '骰子 是谁的', '猜数 好难', '接龙 今天天气不错',
      '轮盘 好刺激', '猜拳 谁输谁请客', '猜拳 s', '冒险 精神', '秘境 探险记', '猜谜 真有意思', '21点开始']) {
      expect(reach(text), text).toBeUndefined();
    }
  });

  it('blackjack: `二十一点 开会` is chat, `二十一点 要牌` and the other actions are the game', () => {
    expect(reach('二十一点 开会')).toBeUndefined();
    expect(reach('二十一点')).toEqual({ command: 'bj', action: '' });
    for (const action of ['要牌', '停牌', '开始', '继续', '退出', '放弃', '帮助']) {
      expect(reach(`二十一点 ${action}`)).toEqual({ command: 'bj', action });
    }
    // The explicit spellings keep taking any action (and answer an unknown one with help).
    expect(reach('玩二十一点 开会')).toEqual({ command: 'bj', action: '开会' });
    expect(reach('bj 开会')).toEqual({ command: 'bj', action: '开会' });
  });
});
