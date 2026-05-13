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
  it('normalizes aliases into canonical outbound detail', () => {
    const detail = normalizeQueueOutboundDetail({
      adapter: 'qq',
      bot: 'bot1',
      id: 'group1',
      type: 'group',
      text: 'hello',
      senderId: 'user1',
    });

    expect(detail).toEqual({
      context: 'qq',
      bot: 'bot1',
      channelId: 'group1',
      channelType: 'group',
      content: 'hello',
      senderId: 'user1',
    });
  });

  it('prefers canonical keys when aliases conflict', () => {
    const detail = normalizeQueueOutboundDetail({
      context: 'qq',
      adapter: 'telegram',
      bot: 'bot1',
      channelId: 'canonical',
      id: 'legacy',
      channelType: 'private',
      type: 'group',
      content: 'canonical content',
      text: 'legacy text',
    });

    expect(detail.context).toBe('qq');
    expect(detail.channelId).toBe('canonical');
    expect(detail.channelType).toBe('private');
    expect(detail.content).toBe('canonical content');
  });

  it('rejects invalid message type', () => {
    expect(() => normalizeQueueOutboundDetail({
      context: 'qq',
      bot: 'bot1',
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
      expect((error as QueueIMFieldContractError).field).toBe('bot');
    }
  });

  it('converts normalized detail into SendOptions', () => {
    const sendOptions: SendOptions = toSendOptions({
      context: 'qq',
      bot: 'bot1',
      channelId: 'group1',
      channelType: 'group',
      content: [{ type: 'text', data: { text: 'hello' } }],
    });

    expect(sendOptions).toEqual({
      context: 'qq',
      bot: 'bot1',
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
        bot: 'bot1',
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

