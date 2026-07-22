import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Message } from '@zhin.js/core';
import { tryBuildCollaborationOutboundBatches } from '../../src/collaboration/structured-ai-outbound.js';
import { sanitizeAssistantReply } from '../../src/core/text-sanitize.js';

function mockRootWithAdapter() {
  return {
    inject: () => ({
      endpoints: new Map([
        ['8596238', { $platformUserId: '8596238' }],
      ]),
    }),
  } as never;
}

const privateMessage = {
  $adapter: 'icqq',
  $endpoint: '8596238',
  $channel: { type: 'private', id: '1659488338' },
} as Message;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('outputSchemaRequired structured outbound', () => {
  it('parses segment-array JSON reply into MessageElements when outputSchema is on', async () => {
    const root = mockRootWithAdapter();
    const replyJson = JSON.stringify({
      segments: [
        { type: 'mention', data: { target: '1001' } },
        { type: 'text', data: { text: '看图' } },
        { type: 'image', data: { media: { kind: 'url', value: 'https://x/y.png' } } },
      ],
    });
    const elements = [{ type: 'text' as const, content: replyJson }];

    const batches = await tryBuildCollaborationOutboundBatches(privateMessage, elements, {
      outputSchemaRequired: true,
      root,
    });

    expect(batches).toEqual([[
      { type: 'mention', data: { target: '1001' } },
      { type: 'text', data: { text: '看图' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://x/y.png' } } },
    ]]);
  });

  it('parses text + mentions DSL reply when outputSchema is on', async () => {
    const root = mockRootWithAdapter();
    const elements = [{
      type: 'text' as const,
      content: '{"text":"大家好","segments":[{"type":"dice","data":{"result":3}}]}',
    }];

    const batches = await tryBuildCollaborationOutboundBatches(privateMessage, elements, {
      outputSchemaRequired: true,
      root,
    });

    expect(batches).toEqual([[
      { type: 'text', data: { text: '大家好' } },
      { type: 'dice', data: { result: 3 } },
    ]]);
  });

  it('returns null for plain prose so the normal fallback chain still applies', async () => {
    const root = mockRootWithAdapter();
    const elements = [{ type: 'text' as const, content: '只是普通文本回复' }];

    const batches = await tryBuildCollaborationOutboundBatches(privateMessage, elements, {
      outputSchemaRequired: true,
      root,
    });

    expect(batches).toBeNull();
  });

  it('does not parse JSON reply when outputSchemaRequired is off and no other trigger', async () => {
    const root = mockRootWithAdapter();
    const elements = [{
      type: 'text' as const,
      content: '{"segments":[{"type":"text","data":{"text":"hi"}}]}',
    }];

    const batches = await tryBuildCollaborationOutboundBatches(privateMessage, elements, { root });

    expect(batches).toBeNull();
  });
});

describe('sanitizeAssistantReply with outbound JSON', () => {
  it('keeps outbound JSON text intact', () => {
    const json = '{"segments":[{"type":"text","data":{"text":"hi"}}]}';
    expect(sanitizeAssistantReply(json)).toBe(json);
  });

  it('strips think blocks but preserves the JSON body', () => {
    const json = '{"text":"你好"}';
    expect(sanitizeAssistantReply(`<think>reasoning…</think>${json}`)).toBe(json);
  });
});
