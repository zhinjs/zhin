import { defineAdapter } from '@zhin.js/adapter';
import { EndpointDeliveryError, type ConversationRef } from '@zhin.js/im-contract';
import type { RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { projectOutboundPayload } from '../../src/plugin-runtime/im/outbound-renderer.js';
import {
  resolveAiOutboundSegments,
  resolveOutboundHtmlPolicy,
  resolveOutboundInteractivePolicy,
  resolveOutboundMarkdownPolicy,
  resolveOutboundMediaPolicy,
  resolveOutboundSupportedSegments,
} from '../../src/plugin-runtime/im/outbound-segments.js';

/**
 * ADR 0064 F1: a conversation-kind section of the capability profile that declares
 * `messaging.segments` replaces the `default` declaration for that kind.
 */
const definition = defineAdapter({
  capabilities: ['inbound', 'outbound'],
  profile: {
    default: {
      messaging: {
        segments: {
          supported: ['text', 'mention', 'image', 'markdown', 'keyboard', 'card', 'share'],
          markdown: 'native',
          outboundMedia: ['url', 'upload'],
          interactive: 'native',
          model: { share: { fields: ['description', 'image'], hint: 'rich card' } },
        },
      },
    },
    group: { messaging: { mention: { all: true } } },
    channel: {
      messaging: {
        segments: {
          supported: ['text', 'mention', 'image', 'markdown', 'keyboard'],
          markdown: 'native',
          outboundMedia: ['url', 'upload'],
          interactive: 'native',
        },
      },
    },
    thread: {
      messaging: {
        segments: { supported: ['text'], markdown: 'text', outboundMedia: ['url'], interactive: 'text', html: 'text' },
      },
    },
  },
  createAdapter: () => { throw new Error('not used'); },
});

const id = 'adapter:scene' as never;

function snapshotOf(adapterDefinition: unknown): RuntimeSnapshot {
  return {
    root: 'root',
    tree: new Map(),
    capabilities: new Map([['adapter:scene', { id: 'adapter:scene', definition: adapterDefinition }]]),
    resources: new Map([['root', new Map()]]),
  } as unknown as RuntimeSnapshot;
}

const snapshot = snapshotOf(definition);
const conversation = (kind: ConversationRef['kind'], threadId?: string): ConversationRef => ({
  endpoint: { id: 'adapter:scene', adapter: 'scene' },
  kind,
  id: `${kind}-1`,
  ...(threadId ? { threadId } : {}),
}) as ConversationRef;

const shareCard = { type: 'share', data: { title: '卡片', url: 'https://example.org', description: 'd', image: 'https://example.org/a.png' } };

describe('outbound segment policy per conversation kind (ADR 0064 F1)', () => {
  it('keeps the default declaration without a conversation and for kinds that do not override segments', () => {
    for (const scope of [undefined, conversation('group'), conversation('private')]) {
      expect(resolveOutboundSupportedSegments(id, snapshot, scope)).toContain('share');
      expect(resolveOutboundMarkdownPolicy(id, snapshot, scope)).toBe('native');
      expect(resolveOutboundInteractivePolicy(id, snapshot, scope)).toBe('native');
      expect(resolveOutboundMediaPolicy(id, snapshot, scope)).toBe('passthrough');
    }
  });

  it('replaces the whole declaration for a kind section that declares segments', () => {
    const channel = conversation('channel');
    expect(resolveOutboundSupportedSegments(id, snapshot, channel)).toEqual(['text', 'mention', 'image', 'markdown', 'keyboard']);
    const ai = resolveAiOutboundSegments(id, snapshot, channel);
    expect(ai.types).not.toContain('share');
    expect(ai.extensions).toBeUndefined();
    // The kind shorthand selects the same section.
    expect(resolveAiOutboundSegments(id, snapshot, 'channel').types).toEqual(ai.types);
    expect(resolveAiOutboundSegments(id, snapshot, 'group').types).toContain('share');
  });

  it('applies the thread section after the conversation kind', () => {
    const thread = conversation('channel', 'topic-1');
    expect(resolveOutboundSupportedSegments(id, snapshot, thread)).toEqual(['text']);
    expect(resolveOutboundMarkdownPolicy(id, snapshot, thread)).toBe('text');
    expect(resolveOutboundInteractivePolicy(id, snapshot, thread)).toBe('text');
    expect(resolveOutboundMediaPolicy(id, snapshot, thread)).toBe('url-or-text');
    expect(resolveOutboundHtmlPolicy(id, snapshot, thread)).toBe('text');
    expect(resolveOutboundHtmlPolicy(id, snapshot, conversation('channel'))).toBe('image');
  });

  it('resolves a multi-endpoint record id against its slot declaration', () => {
    expect(resolveOutboundSupportedSegments('adapter:scene~bot-2' as never, snapshot, conversation('channel')))
      .not.toContain('share');
  });

  it('rejects a rich card in the overriding kind and delivers it elsewhere', async () => {
    const group = await projectOutboundPayload([shareCard], conversation('group'), snapshot);
    expect(group.payload).toEqual([shareCard]);
    await expect(projectOutboundPayload([shareCard], conversation('channel'), snapshot))
      .rejects.toSatisfy((error: unknown) => error instanceof EndpointDeliveryError && error.code === 'unsupported_operation');
  });

  it('projects markdown and keyboards with the kind-specific policy', async () => {
    const payload = [
      { type: 'markdown', data: { content: '**完成**' } },
      { type: 'keyboard', data: { rows: [[{ id: 'ok', label: '确认', payload: 'x:s:ok' }]] } },
    ];
    const native = await projectOutboundPayload(payload, conversation('channel'), snapshot);
    expect((native.payload as { type: string }[]).map(segment => segment.type)).toEqual(['markdown', 'keyboard']);
    expect(native.rendering.fallbacks).toEqual([]);
    const thread = await projectOutboundPayload(payload, conversation('channel', 'topic-1'), snapshot);
    expect((thread.payload as { type: string }[]).every(segment => segment.type === 'text')).toBe(true);
    expect(thread.rendering.fallbacks).toEqual(expect.arrayContaining(['markdown_text_policy', 'interactive_text_policy']));
  });

  it('keeps the plain `segments` declaration when the adapter has no profile', () => {
    const plain = snapshotOf(defineAdapter({
      capabilities: ['outbound'],
      segments: { supported: ['text', 'share'], outboundMedia: ['url'] },
      createAdapter: () => { throw new Error('not used'); },
    }));
    expect(resolveOutboundSupportedSegments(id, plain, conversation('channel', 'topic-1'))).toEqual(['text', 'share']);
  });
});
