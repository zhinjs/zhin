import { describe, expect, it } from 'vitest';
import {
  consoleRpcPermission,
  parseConsoleInboxEvent,
  parseConsoleSseFrame,
} from '../src/index.js';

describe('Console RPC protocol', () => {
  it('validates canonical inbox pushes at the protocol seam', () => {
    expect(parseConsoleInboxEvent({
      type: 'request.receive',
      data: { adapter: 'icqq', endpointKey: '10001', comment: 'hello' },
    })).toEqual({
      type: 'request.receive',
      kind: 'request',
      adapter: 'icqq',
      endpointKey: '10001',
      payload: {
        adapter: 'icqq',
        endpointKey: '10001',
        comment: 'hello',
      },
    });
    expect(parseConsoleInboxEvent({
      type: 'endpoint:request',
      data: { $adapter: 'icqq', bot: '10001' },
    })).toBeNull();
    expect(parseConsoleInboxEvent({ type: 'hmr:reload', data: {} })).toBeNull();
    expect(parseConsoleInboxEvent({ type: 'message.receive', data: {} })).toBeNull();
  });

  it('maps canonical RPC names to permissions and leaves legacy names unmapped', () => {
    expect(consoleRpcPermission('endpoint.friends')).toBe('endpoint.view');
    expect(consoleRpcPermission('endpoint.group_kick')).toBe('endpoint.operate');
    expect(consoleRpcPermission('db:delete')).toBe('ops.database.write');
    expect(consoleRpcPermission('endpoint.send_message')).toBe('endpoint.operate');
    expect(consoleRpcPermission('endpoint:friends')).toBeNull();
  });

  it('parses standard SSE event, id and typed extension fields', () => {
    expect(parseConsoleSseFrame([
      'id: 42',
      'event: message.receive',
      'runtime: runtime-a',
      'timestamp: 1720000000000',
      'data: {"adapter":"sandbox",',
      'data: "endpointKey":"bot"}',
    ].join('\n'))).toEqual({
      eventId: 42,
      runtimeId: 'runtime-a',
      timestamp: 1720000000000,
      type: 'message.receive',
      data: { adapter: 'sandbox', endpointKey: 'bot' },
    });
    expect(parseConsoleSseFrame('event: broken\ndata: {')).toBeNull();
  });
});
