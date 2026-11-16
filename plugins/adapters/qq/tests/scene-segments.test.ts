import { describe, expect, it } from 'vitest';
import { projectOutboundPayload, resolveAiOutboundSegments, resolveOutboundSupportedSegments } from '@zhin.js/core/runtime';
import { EndpointDeliveryError, type ConversationRef } from '@zhin.js/im-contract';
import qqAdapter from '../adapters/qq/index.js';

/** ADR 0064 F1: the `channel` section replaces the segment declaration, so guild channels get no rich cards. */
type Snapshot = Parameters<typeof projectOutboundPayload>[2];
const snapshot = {
  root: 'root',
  tree: new Map(),
  capabilities: new Map([['adapter:qq', { id: 'adapter:qq', definition: qqAdapter }]]),
  resources: new Map([['root', new Map()]]),
} as unknown as Snapshot;
const id = 'adapter:qq' as Parameters<typeof resolveOutboundSupportedSegments>[0];
const conversation = (kind: ConversationRef['kind']) => ({
  endpoint: { id: 'adapter:qq', adapter: 'qq' }, kind, id: `${kind}-1`,
}) as ConversationRef;
const share = { type: 'share', data: {
  title: '标题', description: '描述', url: 'https://example.org/a', image: 'https://example.org/a.png',
} };

describe('QQ per-conversation segment declaration', () => {
  it('drops card and share only in guild channels', () => {
    for (const kind of ['private', 'group'] as const) {
      expect(resolveOutboundSupportedSegments(id, snapshot, conversation(kind))).toEqual(expect.arrayContaining(['card', 'share']));
    }
    const channel = resolveOutboundSupportedSegments(id, snapshot, conversation('channel'));
    expect(channel).not.toContain('card');
    expect(channel).not.toContain('share');
    expect(channel).toEqual(expect.arrayContaining(['markdown', 'keyboard', 'image']));
  });

  it('offers the model share cards outside channels only', () => {
    expect(resolveAiOutboundSegments(id, snapshot, 'group').types).toContain('share');
    expect(resolveAiOutboundSegments(id, snapshot, 'channel').types).not.toContain('share');
  });

  it('refuses a share card for a channel before it reaches the Endpoint', async () => {
    await expect(projectOutboundPayload([share], conversation('group'), snapshot)).resolves.toMatchObject({ payload: [share] });
    await expect(projectOutboundPayload([share], conversation('channel'), snapshot)).rejects.toSatisfy(
      (error: unknown) => error instanceof EndpointDeliveryError && error.code === 'unsupported_operation',
    );
  });
});
