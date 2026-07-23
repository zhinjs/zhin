import { describe, expect, it } from 'vitest';
import {
  assertDemoConsoleRpcAllowed,
  endpointSendResult,
  normalizeConsolePushMessage,
  normalizeConsolePushType,
  normalizeConsoleRpcMessage,
  normalizeConsoleRpcType,
  parseConsoleInboxEvent,
} from '../src/index.js';

describe('Console RPC protocol', () => {
  it('canonicalizes legacy endpoint push aliases', () => {
    expect(normalizeConsolePushType('endpoint:message')).toBe('message.receive');
    expect(normalizeConsolePushType('endpoint:request')).toBe('request.receive');
    expect(normalizeConsolePushType('endpoint:notice')).toBe('notice.receive');
    expect(normalizeConsolePushMessage({
      type: 'endpoint:message',
      data: { $adapter: 'sandbox', endpoint: 'bot', channel_id: 'room' },
    })).toEqual({
      type: 'message.receive',
      data: {
        $adapter: 'sandbox',
        adapter: 'sandbox',
        endpoint: 'bot',
        endpointId: 'bot',
        channel_id: 'room',
        channelId: 'room',
      },
    });
  });

  it('parses inbox pushes once at the protocol seam', () => {
    expect(parseConsoleInboxEvent({
      type: 'endpoint:request',
      data: { $adapter: 'icqq', bot: '10001', comment: 'hello' },
    })).toEqual({
      type: 'request.receive',
      kind: 'request',
      adapter: 'icqq',
      endpointId: '10001',
      payload: {
        $adapter: 'icqq',
        adapter: 'icqq',
        bot: '10001',
        endpointId: '10001',
        comment: 'hello',
      },
    });
    expect(parseConsoleInboxEvent({ type: 'hmr:reload', data: {} })).toBeNull();
    expect(parseConsoleInboxEvent({ type: 'message.receive', data: {} })).toBeNull();
  });

  it('normalizes colon/camel aliases to canonical dot/snake names', () => {
    expect(normalizeConsoleRpcType('endpoint:sendMessage')).toBe('endpoint.send_message');
    expect(normalizeConsoleRpcType('endpoint:groupMembers')).toBe('endpoint.group_members');
    expect(normalizeConsoleRpcType('endpoint:requestApprove')).toBe('request.approve');
    expect(normalizeConsoleRpcType('endpoint:inboxMessages')).toBe('inbox.messages');
  });

  it('merges nested data once and maps payload aliases', () => {
    expect(normalizeConsoleRpcMessage({
      type: 'endpoint:sendMessage',
      requestId: 'r1',
      adapter: 'wrong',
      $endpoint: 'wrong-bot',
      data: {
        adapter: 'sandbox',
        endpointId: 'bot',
        id: 'room',
        type: 'group',
        content: 'hello',
      },
    })).toMatchObject({
      type: 'endpoint.send_message',
      requestId: 'r1',
      $adapter: 'sandbox',
      $endpoint: 'bot',
      $id: 'room',
      $type: 'group',
      $channel_id: 'room',
      $channel_type: 'group',
      $content: 'hello',
    });
  });

  it('applies one demo-scope policy after name normalization', () => {
    expect(assertDemoConsoleRpcAllowed('endpoint:friends')).toBeNull();
    expect(assertDemoConsoleRpcAllowed('endpoint:groupKick')).toBe(
      'Demo scope: RPC "endpoint.group_kick" is forbidden',
    );
    expect(assertDemoConsoleRpcAllowed('db:delete')).toContain('forbidden');
  });

  it('stabilizes endpoint send response aliases', () => {
    expect(endpointSendResult(42)).toEqual({ message_id: '42', messageId: '42' });
  });
});
