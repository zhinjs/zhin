import { describe, expect, it } from 'vitest';
import type { RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { componentHostToken, type ComponentHost } from '@zhin.js/plugin-runtime';
import type { ConversationRef } from '@zhin.js/im-contract';
import { compiler } from '@zhin.js/kernel';
import { OutboundRenderer } from '../../src/plugin-runtime/im/outbound-renderer.js';
import type { IncomingContext } from '../../src/plugin-runtime/im/contracts.js';

const rootId = 'plugin:root';

function createHost(): ComponentHost {
  return { compileTemplate: (text, ctx) => compiler(text, { ...ctx }) };
}

function snapshotWithHost(): RuntimeSnapshot {
  const hostResources = new Map([[componentHostToken.id, createHost()]]);
  return {
    root: rootId,
    projections: new Map(),
    resources: new Map([[rootId, hostResources]]),
  } as unknown as RuntimeSnapshot;
}

function snapshotWithoutHost(): RuntimeSnapshot {
  return {
    root: rootId,
    projections: new Map(),
    resources: new Map([[rootId, new Map()]]),
  } as unknown as RuntimeSnapshot;
}

const requester = 'plugin:test' as never;

const conversation: ConversationRef = {
  endpoint: { id: 'sandbox:default', adapter: 'sandbox' },
  kind: 'group',
  id: 'test-channel-1',
};

const incoming: IncomingContext = {
  sender: { id: 'user-42', name: 'Alice', roles: ['admin'] },
  content: '你好机器人',
  messageId: 'msg-12345',
  timestamp: 1723370000000,
  endpointName: 'test-bot',
  mentioned: true,
};

describe('OutboundRenderer template compilation', () => {
  const renderer = new OutboundRenderer();

  it('evaluates ${expr} in plain string content', async () => {
    const result = await renderer.render('1+1=${1+1}', requester, snapshotWithHost(), conversation, incoming);
    expect(result).toBe('1+1=2');
  });

  it('leaves plain strings without ${} unchanged', async () => {
    const result = await renderer.render('hello world', requester, snapshotWithHost(), conversation, incoming);
    expect(result).toBe('hello world');
  });

  it('evaluates ${expr} in text segment data', async () => {
    const seg = { type: 'text', data: { text: '结果=${2*3}' } };
    const result = await renderer.render(seg, requester, snapshotWithHost(), conversation, incoming);
    expect(result).toEqual({ type: 'text', data: { text: '结果=6' } });
  });

  it('passes non-text segments through unchanged', async () => {
    const seg = { type: 'image', data: { url: 'https://example.com/a.png' } };
    const result = await renderer.render(seg, requester, snapshotWithHost(), conversation, incoming);
    expect(result).toBe(seg);
  });

  it('compiles templates inside arrays', async () => {
    const content = [
      { type: 'text', data: { text: '${1+1}' } },
      { type: 'image', data: { url: 'a.png' } },
    ] as const;
    const result = await renderer.render(content as any, requester, snapshotWithHost(), conversation, incoming);
    expect(result).toEqual([
      { type: 'text', data: { text: '2' } },
      { type: 'image', data: { url: 'a.png' } },
    ]);
  });

  it('blocks dangerous globalThis access via sandbox', async () => {
    const result = await renderer.render('${globalThis}', requester, snapshotWithHost(), conversation, incoming);
    expect(result).not.toContain('[object');
  });

  it('passes ${} through unchanged when ComponentHost is absent', async () => {
    const result = await renderer.render('${1+1}', requester, snapshotWithoutHost(), conversation, incoming);
    expect(result).toBe('${1+1}');
  });

  it('passes text segments through when ComponentHost is absent', async () => {
    const seg = { type: 'text', data: { text: '${2*3}' } };
    const result = await renderer.render(seg, requester, snapshotWithoutHost(), conversation, incoming);
    expect(result).toBe(seg);
  });

  describe('conversation context', () => {
    it('exposes adapter', async () => {
      const result = await renderer.render('平台=${adapter}', requester, snapshotWithHost(), conversation, incoming);
      expect(result).toBe('平台=sandbox');
    });

    it('exposes conversationId and kind', async () => {
      const result = await renderer.render(
        '会话=${conversationId} 类型=${kind}',
        requester, snapshotWithHost(), conversation, incoming,
      );
      expect(result).toBe('会话=test-channel-1 类型=group');
    });
  });

  describe('incoming message context', () => {
    it('exposes sender.name', async () => {
      const result = await renderer.render('你好 ${sender.name}', requester, snapshotWithHost(), conversation, incoming);
      expect(result).toBe('你好 Alice');
    });

    it('exposes incoming content', async () => {
      const result = await renderer.render('你说了: ${content}', requester, snapshotWithHost(), conversation, incoming);
      expect(result).toBe('你说了: 你好机器人');
    });

    it('exposes messageId', async () => {
      const result = await renderer.render('消息ID=${messageId}', requester, snapshotWithHost(), conversation, incoming);
      expect(result).toBe('消息ID=msg-12345');
    });

    it('exposes timestamp', async () => {
      const result = await renderer.render('时间=${timestamp}', requester, snapshotWithHost(), conversation, incoming);
      expect(result).toBe('时间=1723370000000');
    });

    it('exposes endpointName', async () => {
      const result = await renderer.render('机器人=${endpointName}', requester, snapshotWithHost(), conversation, incoming);
      expect(result).toBe('机器人=test-bot');
    });

    it('exposes mentioned', async () => {
      const result = await renderer.render('被@=${mentioned}', requester, snapshotWithHost(), conversation, incoming);
      expect(result).toBe('被@=true');
    });

    it('handles missing incoming gracefully', async () => {
      const result = await renderer.render('${sender}', requester, snapshotWithHost(), conversation);
      expect(result).toBe('undefined');
    });
  });
});
