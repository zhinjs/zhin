import { describe, expect, it } from 'vitest';
import {
  createSlackInboundFilterState,
  shouldDropSlackInboundMessage,
} from '../src/slack-inbound-filter.js';
import { formatSlackMessageRef, parseSlackMessageRef } from '../src/slack-message-ref.js';

const BOT = 'U0BGD0B665U';

describe('slack-message-ref', () => {
  it('round-trips channel and ts', () => {
    const ref = formatSlackMessageRef('C001', '1700000000.000000');
    expect(parseSlackMessageRef(ref)).toEqual({ channel: 'C001', ts: '1700000000.000000' });
  });
});

describe('shouldDropSlackInboundMessage', () => {
  it('drops channel message when app_mention will follow', () => {
    const state = createSlackInboundFilterState();
    const event = {
      type: 'message',
      channel: 'C001',
      channel_type: 'channel',
      ts: '1700000000.000000',
      user: 'U999',
      text: `<@${BOT}> hello`,
    } as const;

    expect(shouldDropSlackInboundMessage(event, state, BOT)).toBe(true);
    expect(shouldDropSlackInboundMessage({ ...event, type: 'app_mention' }, state, BOT)).toBe(false);
  });

  it('dedupes same channel:ts within ttl', () => {
    const state = createSlackInboundFilterState();
    const event = {
      type: 'app_mention',
      channel: 'C001',
      channel_type: 'channel',
      ts: '1700000000.000000',
      user: 'U999',
      text: `<@${BOT}> hello`,
    } as const;

    expect(shouldDropSlackInboundMessage(event, state, BOT)).toBe(false);
    expect(shouldDropSlackInboundMessage(event, state, BOT)).toBe(true);
  });

  it('drops bot own messages', () => {
    const state = createSlackInboundFilterState();
    expect(shouldDropSlackInboundMessage({
      type: 'message',
      channel: 'C001',
      channel_type: 'channel',
      ts: '1700000000.000001',
      user: BOT,
      text: 'reply',
    } as const, state, BOT)).toBe(true);
  });

  it('keeps dm messages without app_mention', () => {
    const state = createSlackInboundFilterState();
    expect(shouldDropSlackInboundMessage({
      type: 'message',
      channel: 'D001',
      channel_type: 'im',
      ts: '1700000000.000002',
      user: 'U999',
      text: 'hi',
    } as const, state, BOT)).toBe(false);
  });
});
