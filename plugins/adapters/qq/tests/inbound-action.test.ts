import { describe, expect, it, vi } from 'vitest';
import {
  formatQqActionMessage,
  stripQqOutboundMessageId,
} from '../src/inbound-action.js';

describe('formatQqActionMessage $reply', () => {
  it('sends active message without event_id or reply segment', async () => {
    const send = vi.fn().mockResolvedValue('group-g1:msg-99');
    const event = {
      notice_type: 'group',
      group_id: 'g1',
      operator_id: 'u1',
      notice_id: 'interaction-abc',
      event_id: 'ws-envelope',
      data: { resolved: { button_id: 'c3', button_data: 'ttt:s1:3' } },
    } as Parameters<typeof formatQqActionMessage>[0];

    const message = formatQqActionMessage(event, { endpointName: 'zhin', send });
    await message.$reply?.([{ type: 'text', data: { text: 'board' } }]);

    expect(send).toHaveBeenCalledOnce();
    const content = send.mock.calls[0]![0] as Array<{ type: string; data: Record<string, unknown> }>;
    expect(content[0]).toEqual({ type: 'text', data: { text: 'board' } });
  });

  it('prepends msg_id only when quote is an explicit message id', async () => {
    const send = vi.fn().mockResolvedValue('group-g1:msg-100');
    const event = {
      notice_type: 'group',
      group_id: 'g1',
      operator_id: 'u1',
      notice_id: 'interaction-abc',
      data: { resolved: { button_id: 'c3' } },
    } as Parameters<typeof formatQqActionMessage>[0];

    const message = formatQqActionMessage(event, { endpointName: 'zhin', send });
    await message.$reply?.('board', 'group-g1:msg-99');

    const content = send.mock.calls[0]![0] as Array<{ type: string; data: Record<string, unknown> }>;
    expect(content[0]).toEqual({ type: 'reply', data: { id: 'msg-99' } });
  });
});

describe('stripQqOutboundMessageId', () => {
  it('strips adapter prefix', () => {
    expect(stripQqOutboundMessageId('group-abc:msg-1')).toBe('msg-1');
  });
});
