import { describe, expect, it } from 'vitest';
import {
  QueueIMFieldContractError,
  isMessageType,
  normalizeQueueOutboundDetail,
  normalizeRecordToSendOptions,
  toSendOptions,
  type QueueEnvelope,
} from '../src/built/queue-im-field-contract.js';
import type { SendOptions } from '../src/types.js';

describe('queue IM field contract', () => {
  it('normalizes canonical outbound detail', () => {
    const detail = normalizeQueueOutboundDetail({
      context: 'qq',
      endpoint: 'bot1',
      channelId: 'group1',
      channelType: 'group',
      content: 'hello',
      senderId: 'user1',
    });

    expect(detail).toEqual({
      context: 'qq',
      endpoint: 'bot1',
      channelId: 'group1',
      channelType: 'group',
      content: 'hello',
      senderId: 'user1',
    });
  });

  it('rejects legacy alias keys', () => {
    expect(() => normalizeQueueOutboundDetail({
      adapter: 'qq',
      endpoint: 'bot1',
      id: 'legacy',
      type: 'group',
      text: 'legacy text',
    })).toThrow(QueueIMFieldContractError);
  });

  it('rejects invalid message type', () => {
    expect(() => normalizeQueueOutboundDetail({
      context: 'qq',
      endpoint: 'bot1',
      channelId: 'guild1',
      channelType: 'guild',
      content: 'hello',
    })).toThrow(QueueIMFieldContractError);
  });

  it('rejects missing required fields with error metadata', () => {
    try {
      normalizeQueueOutboundDetail({ context: 'qq' });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(QueueIMFieldContractError);
      expect((error as QueueIMFieldContractError).code).toBe('missing_field');
      expect((error as QueueIMFieldContractError).field).toBe('endpoint');
    }
  });

  it('converts normalized detail into SendOptions', () => {
    const sendOptions: SendOptions = toSendOptions({
      context: 'qq',
      endpoint: 'bot1',
      channelId: 'group1',
      channelType: 'group',
      content: [{ type: 'text', data: { text: 'hello' } }],
    });

    expect(sendOptions).toEqual({
      context: 'qq',
      endpoint: 'bot1',
      id: 'group1',
      type: 'group',
      content: [{ type: 'text', data: { text: 'hello' } }],
    });
  });

  it('normalizes envelope detail to SendOptions', () => {
    const envelope: QueueEnvelope = {
      kind: 'outgoing',
      type: 'message.send',
      detail: {
        context: 'qq',
        endpoint: 'bot1',
        channelId: 'group1',
        channelType: 'channel',
        content: 'hello',
      },
    };

    expect(normalizeRecordToSendOptions(envelope.detail)).toMatchObject({
      context: 'qq',
      type: 'channel',
      id: 'group1',
    });
  });

  it('guards MessageType values', () => {
    expect(isMessageType('private')).toBe(true);
    expect(isMessageType('dm')).toBe(false);
  });
});

