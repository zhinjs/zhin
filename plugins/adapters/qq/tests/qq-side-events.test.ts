import { getAdapterLogger } from '@zhin.js/logger';
import { describe, expect, it, vi } from 'vitest';
import {
  bindQqBotSideEvents,
  receiveQqSideEvent,
} from '../src/side-event-dispatch.js';

describe('QQ side events', () => {
  it('listens at the notice root once and reconstructs the leaf event name', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const dispatch = vi.fn();
    bindQqBotSideEvents({
      on(event, listener) { listeners.set(event, listener); },
    }, dispatch);

    expect([...listeners.keys()]).toEqual(['notice']);
    listeners.get('notice')?.({ notice_type: 'group', sub_type: 'member.increase' });
    expect(dispatch).toHaveBeenCalledWith(
      'notice.group.member.increase',
      expect.objectContaining({ notice_type: 'group' }),
    );
  });

  it.each([
    ['notice.group.member.increase', 'member_increase'],
    ['notice.group.member.decrease', 'member_decrease'],
  ] as const)('normalizes %s into canonical group notices', async (eventName, subType) => {
    const received: unknown[] = [];
    receiveQqSideEvent(
      async (name, payload) => {
        expect(name).toBe('notice.receive');
        received.push(payload);
      },
      'qq-main',
      {},
      eventName,
      {
        group_id: 'group-1',
        user_id: 'member-1',
        operator_id: 'admin-1',
        time: 1_700_000_000,
      },
      getAdapterLogger('qq', 'test'),
    );

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({
      $endpoint: 'qq-main',
      $scene_id: 'group-1',
      $scene_type: 'group',
      $sub_type: subType,
      $actor: { id: 'admin-1' },
      $target: { id: 'member-1' },
      $timestamp: 1_700_000_000_000,
    });
  });

  it('uses qq-official-bot 1.3 decline fields for request rejection', async () => {
    const approveGroupJoinRequest = vi.fn(async () => undefined);
    receiveQqSideEvent(
      async (name, payload) => {
        expect(name).toBe('request.receive');
        await (payload as { $reject(reason?: string): Promise<void> }).$reject('资料不完整');
      },
      'qq-main',
      { approveGroupJoinRequest },
      'notice.group.join_request',
      {
        group_id: 'group-1',
        user_id: 'member-1',
        join_request_id: 'request-1',
        apply_at: '2026-09-07T00:00:00.000Z',
        verify_info: { verify_message: '申请加入' },
      },
      getAdapterLogger('qq', 'test'),
    );

    await vi.waitFor(() => expect(approveGroupJoinRequest).toHaveBeenCalledTimes(1));
    expect(approveGroupJoinRequest).toHaveBeenCalledWith('group-1', 'member-1', {
      op: 'decline',
      join_request_id: 'request-1',
      reject_reason: '资料不完整',
    });
  });
});
