import { childPluginId, createCapabilitySlot, rootPluginId, type Locale, type RuntimeSnapshot, type CapabilitySlot } from '@zhin.js/plugin-runtime';
import { CommandIndex, commandFeatureId, defineCommand, type CommandDefinition } from '../src/index.js';
import {
  allowedCommandDistance, commandNameDistance, rankCommandSuggestions, resolveCommandSuggestionConfig,
} from '../src/command-suggestion.js';

const root = rootPluginId();
const owner = childPluginId(root, 'tools');

function slot(localName: string, definition: CommandDefinition) {
  return createCapabilitySlot({ owner, feature: commandFeatureId, localName,
    source: `/plugins/tools/commands/${localName}/index.ts`, definition });
}

function snapshot(slots: readonly CapabilitySlot<CommandDefinition>[], rootConfig: Record<string, unknown> = {}): RuntimeSnapshot {
  return {
    generation: 1, root,
    tree: new Map([
      [root, { id: root, instanceKey: 'root', packageName: 'root', packageRoot: '/p', children: [owner] }],
      [owner, { id: owner, instanceKey: 'tools', packageName: 'tools', packageRoot: '/p/tools', parent: root, children: [] }],
    ]),
    config: new Map([[root, { locale: 'zh-CN', ...rootConfig }], [owner, {}]]),
    resources: new Map([[root, new Map()], [owner, new Map()]]),
    capabilities: new Map(slots.map(entry => [entry.id, entry])), projections: new Map(),
  };
}

const slots = [
  slot('rss-list', defineCommand({ description: '列出订阅', execute: () => 'list' })),
  slot('rss-add/$url', { ...defineCommand({ params: { url: { type: 'string' } }, execute: () => 'add' }),
    $parameter: { name: 'url', type: 'string', optional: false, rest: false } }),
  slot('guess', defineCommand({ alias: ['猜数字'], execute: () => 'guess' })),
  slot('gold', defineCommand({ execute: () => 'gold' })),
  slot('weather', defineCommand({ execute: () => 'weather' })),
  slot('admin-only', defineCommand({ permit: ['owner'], execute: () => 'admin' })),
];

describe('command suggestions (#1250)', () => {
  it('measures code-point edit distance and stops early past the limit', () => {
    expect(commandNameDistance('rsslst', 'rsslist')).toBe(1);
    expect(commandNameDistance('猜数子', '猜数字')).toBe(1);
    expect(commandNameDistance('abcdef', 'uvwxyz', 1)).toBe(2);
  });

  it('keeps thresholds conservative: short names need an exact normalized match', () => {
    expect(allowedCommandDistance('gold', 1)).toBe(0);
    expect(allowedCommandDistance('guess', 1)).toBe(1);
    expect(allowedCommandDistance('猜数字', 1)).toBe(1);
    expect(allowedCommandDistance('地震', 1)).toBe(0);
    expect(allowedCommandDistance('rsspreview', 2)).toBe(2);
    expect(allowedCommandDistance('rsspreview', 1)).toBe(1);
    expect(allowedCommandDistance('rsspreview', 0)).toBe(0);
  });

  it('normalizes the root config', () => {
    expect(resolveCommandSuggestionConfig(false).enabled).toBe(false);
    expect(resolveCommandSuggestionConfig({ enabled: false }).enabled).toBe(false);
    expect(resolveCommandSuggestionConfig({ maxDistance: 9, limit: 0 })).toEqual({ enabled: true, maxDistance: 2, limit: 1 });
    expect(resolveCommandSuggestionConfig(undefined)).toEqual({ enabled: true, maxDistance: 1, limit: 3 });
  });

  it('ranks the closest names first and ignores long sentences', () => {
    const config = resolveCommandSuggestionConfig(undefined);
    const candidates = [{ value: 'rss-list', words: ['rss-list'], arity: 0 }, { value: 'rss-add', words: ['rss-add'], arity: 1 }];
    expect(rankCommandSuggestions('RSS List', candidates, config)).toEqual(['rss-list']);
    expect(rankCommandSuggestions('rss list please now', candidates, config)).toEqual([]);
    expect(rankCommandSuggestions('rss lists', candidates, config)).toEqual(['rss-list']);
    expect(rankCommandSuggestions('rss\nlist', candidates, config)).toEqual([]);
  });

  it('suggests similar commands the sender may run, with prefix and localized text', async () => {
    const index = new CommandIndex(slots, snapshot(slots));
    expect(await index.suggest('rss list', { commandPrefix: '/' })).toEqual(['/rss-list']);
    expect(await index.suggest('rss-lst')).toEqual(['rss-list']);
    expect(await index.suggest('rss ad https://example.com')).toEqual(['rss-add <url>']);
    expect(await index.suggest('gues')).toEqual(['guess']);
    expect(await index.suggest('猜数子')).toEqual(['guess']);
    expect(await index.suggest('adminonly')).toEqual([]);
    expect(await index.suggest('adminonly', { source: undefined })).toEqual([]);
    const sender = { conversation: { endpoint: { adapter: 'sandbox', id: 'bot' }, kind: 'private', id: 'u' }, sender: { id: 'u' } };
    expect(await index.suggest('admin only', { source: sender })).toEqual([]);
    // Ordinary chat stays chat.
    for (const text of ['good', 'good morning', 'whether it rains', '今天天气怎么样', 'hello']) {
      expect(await index.suggest(text), text).toEqual([]);
    }
    expect(await index.suggestReply('rss list', { commandPrefix: '/' })).toBe('没有这个指令，你是不是想用：/rss-list');
    expect(await index.suggestReply('rss list', { locale: 'en' as Locale })).toBe('No such command. Did you mean: rss-list?');
    expect(await index.suggestReply('hello')).toBeUndefined();
  });

  it('suggests the commands of a namespace typed as the first word, after edit matches', () => {
    const config = resolveCommandSuggestionConfig(undefined);
    const candidates = [
      { value: 'qrcode gen', words: ['qrcode', 'gen'], arity: 2 },
      { value: 'qrcode scan', words: ['qrcode', 'scan'], arity: 1 },
      { value: 'rss-list', words: ['rss-list'], arity: 0 },
      { value: 'go', words: ['go', 'home'], arity: 0 },
    ];
    expect(rankCommandSuggestions('qrcode hello', candidates, config)).toEqual(['qrcode gen', 'qrcode scan']);
    expect(rankCommandSuggestions('rss foo', candidates, config)).toEqual(['rss-list']);
    expect(rankCommandSuggestions('qrcode a b c d e', candidates, config)).toEqual([]);
    // Namespaces shorter than three characters never match on their own.
    expect(rankCommandSuggestions('go there', candidates, config)).toEqual([]);
    expect(rankCommandSuggestions('qrcode hello', candidates, { ...config, enabled: false })).toEqual([]);
  });

  it('can be tuned or disabled by root config commandSuggestion', async () => {
    expect(await new CommandIndex(slots, snapshot(slots, { commandSuggestion: false })).suggest('rss list')).toEqual([]);
    expect(await new CommandIndex(slots, snapshot(slots, { commandSuggestion: { maxDistance: 0 } })).suggest('gues')).toEqual([]);
    expect(await new CommandIndex(slots, snapshot(slots, { commandSuggestion: { maxDistance: 0 } })).suggest('RSS-List')).toEqual(['rss-list']);
  });
});
