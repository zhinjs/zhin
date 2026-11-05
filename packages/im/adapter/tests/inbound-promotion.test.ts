import { describe, expect, it, vi } from 'vitest';
import { createToken } from '@zhin.js/plugin-runtime';
import {
  createEndpointSpecification,
  endpointSpec,
  endpointEventGatewayToken,
  extractMentionTargetFromSegment,
  extractReplyIdFromSegment,
  promoteInboundMessagePayload,
  type Endpoint,
  type EndpointEvent,
} from '../src/index.js';
import { bindPlatformEndpoint } from '../src/endpoint-specification.js';

describe('inbound-promotion helpers', () => {
  it('extracts reply id from canonical or OneBot reply segments', () => {
    expect(extractReplyIdFromSegment({ type: 'reply', data: { message_id: 'msg-1' } })).toBe('msg-1');
    expect(extractReplyIdFromSegment({ type: 'reply', data: { id: 42 } })).toBe('42');
    expect(extractReplyIdFromSegment({ type: 'reply', data: { id: '  abc  ' } })).toBe('abc');
    expect(extractReplyIdFromSegment({ type: 'reply', data: { id: '   ' } })).toBeUndefined();
    expect(extractReplyIdFromSegment({ type: 'text', data: { text: 'hello' } })).toBeUndefined();
  });

  it('extracts mention target from mention or at segments', () => {
    expect(extractMentionTargetFromSegment({ type: 'mention', data: { target: '10001' } })).toBe('10001');
    expect(extractMentionTargetFromSegment({ type: 'at', data: { qq: 10001 } })).toBe('10001');
    expect(extractMentionTargetFromSegment({ type: 'at', data: { user_id: 'u-9' } })).toBe('u-9');
    expect(extractMentionTargetFromSegment({ type: 'at', data: { qq: 'ALL' } })).toBe('all');
    expect(extractMentionTargetFromSegment({ type: 'text', data: { text: '@bot' } })).toBeUndefined();
  });

  it('auto-promotes replyTo and mentioned from segments when not explicitly set', () => {
    const payload = {
      content: 'hi',
      segments: [
        { type: 'reply', data: { message_id: 'r-99' } },
        { type: 'mention', data: { target: '10001' } },
        { type: 'text', data: { text: 'hi' } },
      ],
    };
    const promoted = promoteInboundMessagePayload(payload, '10001');
    expect(promoted).toMatchObject({
      content: 'hi',
      replyTo: { id: 'r-99' },
      mentioned: true,
    });
    expect(Object.isFrozen((promoted as { replyTo?: unknown }).replyTo)).toBe(true);
  });

  it('ignores @all and leaves mentioned undefined when unmatched', () => {
    const payload = {
      content: 'announcement',
      segments: [
        { type: 'at', data: { qq: 'all' } },
        { type: 'mention', data: { target: '10002' } },
      ],
    };
    const result = promoteInboundMessagePayload(payload, '10001');
    expect(result).toBe(payload);
    expect('mentioned' in result).toBe(false);
  });

  it('preserves explicit replyTo and mentioned values without overwriting', () => {
    const payload = {
      content: 'hi',
      replyTo: { id: 'explicit-reply' },
      mentioned: false,
      segments: [
        { type: 'reply', data: { message_id: 'seg-reply' } },
        { type: 'mention', data: { target: '10001' } },
      ],
    };
    const result = promoteInboundMessagePayload(payload, '10001');
    expect(result).toBe(payload);
    expect(result.replyTo).toEqual({ id: 'explicit-reply' });
    expect(result.mentioned).toBe(false);
  });

  it('keeps frozen payloads frozen after promotion', () => {
    const frozen = Object.freeze({
      content: 'hi',
      segments: [{ type: 'reply', data: { id: '123' } }],
    });
    const promoted = promoteInboundMessagePayload(frozen, undefined);
    expect(Object.isFrozen(promoted)).toBe(true);
    expect((promoted as { replyTo?: { id: string } }).replyTo).toEqual({ id: '123' });
  });

  it('promotes replyTo and mentioned automatically inside createEndpointSpecification publish/publishAccepted', async () => {
    const received: EndpointEvent[] = [];
    class FakeEndpoint implements Endpoint {
      readonly [endpointSpec] = createEndpointSpecification(this, {
        name: 'bot-1',
        start() {},
        open() {},
        close() {},
        stop() {},
      });
    }
    const ep = new FakeEndpoint();
    bindPlatformEndpoint(ep, {
      id: 'fake:bot-1' as never,
      name: 'fake',
      signal: new AbortController().signal,
      use<T>(token: ReturnType<typeof createToken<T>>): T {
        if (token.id === endpointEventGatewayToken.id) {
          return {
            async run<R>(fn: (receipt: { receive(event: EndpointEvent): Promise<unknown> }) => R | Promise<R>): Promise<R> {
              return fn({
                async receive(event: EndpointEvent) {
                  received.push(event);
                },
              });
            },
            async receive(event: EndpointEvent) {
              received.push(event);
            },
          } as unknown as T;
        }
        throw new Error(`unexpected token: ${String(token.id)}`);
      },
    });
    ep[endpointSpec].reportSelfUserId('10001');

    await ep[endpointSpec].events.message({
      conversation: { kind: 'group', id: 'g-1' },
      content: 'hello',
      segments: [
        { type: 'reply', data: { message_id: 'q-1' } },
        { type: 'at', data: { qq: '10001' } },
      ],
    });

    await ep[endpointSpec].events.emitAccepted('message.receive', {
      conversation: { endpoint: ep[endpointSpec].identity, kind: 'group', id: 'g-1' },
      content: 'accepted',
      segments: [
        { type: 'reply', data: { id: 77 } },
        { type: 'mention', data: { target: '99999' } },
      ],
    });

    expect(received).toHaveLength(2);
    expect(received[0]?.payload).toMatchObject({
      replyTo: { id: 'q-1' },
      mentioned: true,
    });
    expect(received[1]?.payload).toMatchObject({
      replyTo: { id: '77' },
    });
    expect('mentioned' in (received[1]?.payload as Record<string, unknown>)).toBe(false);
    expect(vi.isMockFunction(received.push)).toBe(false);
  });
});
