import { childPluginId, createCapabilitySlot, rootPluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { CommandIndex, commandFeatureId, defineCommand } from '@zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import { suggestCommandReply } from '../../src/plugin-runtime/im/command-suggestion.js';

const root = rootPluginId();
const owner = childPluginId(root, 'rss');
const slot = createCapabilitySlot({ owner, feature: commandFeatureId, localName: 'rss-list',
  source: '/p/rss/commands/rss-list/index.ts', definition: defineCommand({ execute: () => 'ok' }) });

function snapshot(): RuntimeSnapshot {
  const base: RuntimeSnapshot = {
    generation: 1, root,
    tree: new Map([
      [root, { id: root, instanceKey: 'root', packageName: 'root', packageRoot: '/p', children: [owner] }],
      [owner, { id: owner, instanceKey: 'rss', packageName: 'rss', packageRoot: '/p/rss', parent: root, children: [] }],
    ]),
    config: new Map([[root, { locale: 'zh-CN' }], [owner, {}]]),
    resources: new Map([[root, new Map()], [owner, new Map()]]),
    capabilities: new Map([[slot.id, slot]]), projections: new Map(),
  };
  (base.projections as Map<unknown, unknown>).set(commandFeatureId, new CommandIndex([slot], base));
  return base;
}

function message(content: string, kind: 'private' | 'group', mentioned?: boolean): Message {
  return { content, mentioned, sender: { id: 'u1' },
    conversation: { endpoint: { adapter: 'sandbox', id: 'sandbox-bot' }, kind, id: kind === 'private' ? 'u1' : 'g1' } } as unknown as Message;
}

describe('suggestCommandReply (#1250)', () => {
  it('answers a near-miss addressed to the Bot', async () => {
    const state = snapshot();
    expect(await suggestCommandReply(message('rss list', 'private'), state, '')).toBe('没有这个指令，你是不是想用：rss-list');
    expect(await suggestCommandReply(message('@bot rss list', 'group', true), state, '')).toBe('没有这个指令，你是不是想用：rss-list');
    expect(await suggestCommandReply(message('/rss list', 'group'), state, '/')).toBe('没有这个指令，你是不是想用：/rss-list');
  });

  it('leaves ambient group chat, unprefixed text and dissimilar text alone', async () => {
    const state = snapshot();
    expect(await suggestCommandReply(message('rss list', 'group'), state, '')).toBeUndefined();
    expect(await suggestCommandReply(message('rss list', 'private'), state, '/')).toBeUndefined();
    expect(await suggestCommandReply(message('今天吃什么', 'private'), state, '')).toBeUndefined();
  });
});
