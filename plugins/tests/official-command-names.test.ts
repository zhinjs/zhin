/**
 * Official plugin command names (issue #1250): every game has a Chinese alias and a
 * localized description, and hyphenated commands also accept the space sub-command form
 * while keeping the old hyphen name as a working route.
 */
import { readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CommandIndex, bindCommandSource, commandFeatureId, type CommandDefinition,
} from '../../packages/im/command/src/index.js';
import { createCapabilitySlot, rootPluginId, type CapabilitySlot, type RuntimeSnapshot } from '../../packages/im/plugin-runtime/src/index.js';

const pluginsRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const root = rootPluginId();

function commandSources(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...commandSources(path));
    else if (entry.name === 'index.ts' || entry.name === 'index.tsx') found.push(path);
  }
  return found;
}

async function loadIndex(pluginDirs: readonly string[]): Promise<CommandIndex> {
  const slots: CapabilitySlot<CommandDefinition>[] = [];
  for (const dir of pluginDirs) {
    const commands = join(pluginsRoot, dir, 'commands');
    for (const source of commandSources(commands)) {
      const module = await import(pathToFileURL(source).href) as { default: unknown };
      const bound = bindCommandSource(module.default, source);
      slots.push(createCapabilitySlot({ owner: root, feature: commandFeatureId, localName: bound.localName,
        source: relative(pluginsRoot, source).split(sep).join('/'), definition: bound.definition }));
    }
  }
  const snapshot: RuntimeSnapshot = {
    generation: 1, root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: pluginsRoot, children: [] }]]),
    config: new Map([[root, { locale: 'zh-CN' }]]),
    resources: new Map([[root, new Map()]]),
    capabilities: new Map(slots.map(slot => [slot.id, slot])), projections: new Map(),
  };
  // Building the index also rejects any alias that collides with another route.
  return new CommandIndex(slots, snapshot);
}

/** `--help` resolves the route without executing the command. */
async function routeOf(index: CommandIndex, input: string): Promise<string | undefined> {
  const result = await index.dispatch({ input: `${input} --help` });
  return result.matched ? result.command : undefined;
}

const games = ['blackjack', 'dice-duel', 'dungeon-expedition', 'guess-number', 'hub', 'idiom-chain',
  'roulette', 'rps', 'text-adventure', 'tic-tac-toe', 'word-riddle'].map(name => `games/${name}`);

describe('official plugin command names', () => {
  it('routes Chinese game names and lists games with Chinese names and descriptions', async () => {
    const index = await loadIndex(games);
    const routes: Record<string, string> = {
      '猜数字': 'guess [action]', '玩石头剪刀布': 'rps [action]', '游戏大厅': 'games [action]', '游戏列表': 'games [action]',
      '玩二十一点': 'bj [action]', '骰子对决': 'dice [action]', '地牢远征': 'dungeon [action]', '成语接龙': 'chain [action]',
      '文字冒险': 'adv [action]', '井字游戏': 'ttt [action]', '猜谜语': 'riddle [action]', '俄罗斯轮盘': 'roulette [action]',
      'game stats': '战绩', 'game ranking': '排行 [query]',
      // Old names keep working.
      guess: 'guess [action]', rps: 'rps [action]', games: 'games [action]', 'game-stats': '战绩',
    };
    for (const [input, command] of Object.entries(routes)) expect(await routeOf(index, input), input).toBe(command);
    // Common everyday words stay chat when no command prefix is configured.
    for (const input of ['游戏 好玩吗', '游戏', '二十一点 开会', '二十一点', '石头剪刀布 谁输谁请客']) {
      expect(await routeOf(index, input), input).toBeUndefined();
    }
    const zh = index.list('zh-CN');
    const guess = zh.find(entry => entry.id.includes('guess'));
    expect(guess).toMatchObject({ name: '猜数字 [action]', description: '猜数字：1~100 之间猜一个整数' });
    expect(index.list('en').find(entry => entry.id.includes('guess'))).toMatchObject({ name: 'guess [action]', description: 'Guess Number: find the integer between 1 and 100' });
    for (const entry of zh) expect(entry.description ?? '', entry.name).toMatch(/[一-鿿]/u);
    for (const entry of index.list('en')) expect(entry.description ?? '', entry.name).not.toMatch(/[一-鿿]/u);
  });

  it.each([
    ['utils/rss', { 'rss add https://example.com/feed': 'rss-add <url>', 'rss list': 'rss-list', 'rss check': 'rss-check [url]',
      'rss preview https://example.com/feed': 'rss-preview <url>', 'rss remove https://example.com/feed': 'rss-remove <url>',
      'rss-list': 'rss-list', 'rss-add https://example.com/feed': 'rss-add <url>' }],
    ['utils/lottery', { 'lottery today': 'lottery-today', 'lottery stats ssq': 'lottery-stats <game>',
      'lottery history ssq': 'lottery-history <game>', 'lottery train': 'lottery-train [game]', 'lottery backtest': 'lottery-backtest [game]',
      'lottery ssq': 'lottery [game]', 'lottery-today': 'lottery-today' }],
    ['utils/group-suite', { 'keyword add 早': 'keyword-add <keyword>', 'keyword list': 'keyword-list', 'keyword remove 早': 'keyword-remove <keyword>',
      'stats card': 'stats-card', 'stats rank': 'stats-rank', 'stats week': 'stats-week', stats: 'stats',
      'teach regex': 'teach-regex', 'keyword-list': 'keyword-list',
      // `teach <question> <answer>` takes free text, so `teach list` stays the hyphen name only.
      'teach-list 2': 'teach-list [page]' }],
    ['utils/ledger', { 'ledger add': 'ledger-add', 'ledger list': 'ledger-list', 'ledger delete': 'ledger-delete', 'ledger today': 'ledger-today',
      'ledger week': 'ledger-week', 'ledger month': 'ledger-month', 'ledger stats': 'ledger-stats', 'ledger report': 'ledger-report', '记': 'ledger-add' }],
    ['utils/repeater', { 'repeater status': 'repeater-status', 'repeater-status': 'repeater-status' }],
    ['features/process-monitor', { 'process status': 'process-status', 'process-status': 'process-status' }],
    ['adapters/bilibili', { 'bili draft list': 'bili-draft list', 'bili draft send 1': 'bili-draft send <id>', 'bili login status': 'bili-login status',
      'bili-draft list': 'bili-draft list' }],
    ['adapters/juejin', { 'juejin draft list': 'juejin-draft list', 'juejin draft drop 1': 'juejin-draft drop <id>', 'juejin login status': 'juejin-login status' }],
  ] as const)('%s accepts the space sub-command form and the old hyphen name', async (plugin, routes) => {
    const index = await loadIndex([plugin]);
    for (const [input, command] of Object.entries(routes)) expect(await routeOf(index, input), input).toBe(command);
    for (const locale of ['zh-CN', 'en'] as const) {
      for (const entry of index.list(locale)) if (!entry.name.startsWith('teach-list')) expect(entry.name, `${plugin} ${locale}`).not.toMatch(/^[a-z]+-[a-z]+(?:\s|$)/u);
    }
  });

  it('gives generic qrcode / short-url commands a plugin-named form and keeps the old names', async () => {
    const index = await loadIndex(['utils/qrcode', 'utils/short-url']);
    const routes: Record<string, string> = {
      'qrcode gen hello': 'gen', '生成二维码 hello': 'gen', 'gen hello': 'gen',
      'qrcode scan https://example.com/a.png': 'scan <url>', '识别二维码 https://example.com/a.png': 'scan <url>', 'scan https://example.com/a.png': 'scan <url>',
      '生成短链 https://example.com/long': 'shorten <url>', 'shorten https://example.com/long': 'shorten <url>',
      'short expand https://t.cn/x': 'expand <url>', '还原短链 https://t.cn/x': 'expand <url>', 'expand https://t.cn/x': 'expand <url>',
    };
    for (const [input, command] of Object.entries(routes)) expect(await routeOf(index, input), input).toBe(command);
    expect(index.list('zh-CN').map(entry => entry.name).sort()).toEqual(['生成二维码', '生成短链 <url>', '识别二维码 <url>', '还原短链 <url>'].sort());
    expect(index.list('en').map(entry => entry.name).sort()).toEqual(['qrcode gen', 'qrcode scan <url>', 'shorten <url>', 'short expand <url>'].sort());
    // `qrcode <text>` is not a route (it would swallow `qrcode scan …`); it gets a suggestion instead.
    expect(await routeOf(index, 'qrcode hello')).toBeUndefined();
    expect(await index.suggest('qrcode hello', { locale: 'en', explicitPrefix: true })).toEqual(['qrcode gen', 'qrcode scan <url>']);
    // Without the command prefix a namespace word alone is chat, as is a question.
    expect(await index.suggest('qrcode hello', { locale: 'en' })).toEqual([]);
    expect(await index.suggest('qrcode 是什么', { locale: 'zh-CN' })).toEqual([]);
    // Everyday words are not routes: `short` / `短链` were dropped for `生成短链`.
    for (const input of ['short 是什么意思', '短链 是什么', 'short https://example.com/long', '短链 https://example.com/long']) {
      expect(await routeOf(index, input), input).toBeUndefined();
    }
  });

  it('keeps the bilibili adapter and bilibili utility routes collision-free together', async () => {
    const index = await loadIndex(['adapters/bilibili', 'utils/bilibili']);
    expect(await routeOf(index, 'bili draft list')).toBe('bili-draft list');
    expect(await routeOf(index, 'bili list')).toBe('bili list');
  });
});
