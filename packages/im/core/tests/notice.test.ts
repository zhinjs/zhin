import { Notice, type NoticeBase } from '../src/notice.js';
import { buildNotice } from '../src/side-event/normalize.js';
import { formatSideEventName } from '../src/side-event/base.js';
import { expectTypeOf } from 'vitest';

const context = { endpoint: { adapter: 'root/qq', id: 'capability-1' }, generation: 7, client: () => ({ live: true }) };

describe('canonical Notice', () => {
  it('keeps raw fields in metadata without mutating the SDK event', () => {
    const raw = { id: 'native-id', type: 'native-type', group_id: 12345 };
    const input = buildNotice(raw, {
      id: 'n1', type: 'notice', name: 'notice.group.member_increase',
      conversation: { kind: 'group', id: '12345' }, timestamp: 1000,
      clientAdapter: 'qq', endpointId: 'bot1', target: { id: 'u1' },
    });
    const notice = new Notice(input, context);
    expectTypeOf(notice).toMatchTypeOf<NoticeBase>();
    expect(formatSideEventName(notice)).toBe('notice.group.member_increase');
    expect(notice.id).toBe('n1');
    expect(notice.metadata).toEqual(raw);
    expect(raw).toEqual({ id: 'native-id', type: 'native-type', group_id: 12345 });
    expect(notice).not.toHaveProperty('group_id');
    expect(notice).not.toHaveProperty('$id');
    expect(notice.conversation?.endpoint).toEqual(context.endpoint);
    expect(notice.endpointId).toBe('bot1');
    expect(notice.generation).toBe(7);
    expect(Object.isFrozen(notice)).toBe(true);
    expect(Object.isFrozen(notice.target)).toBe(true);
  });

  it('does not invent a conversation for an endpoint notice', () => {
    const notice = new Notice(buildNotice({}, {
      id: 'n2', type: 'notice', name: 'notice.endpoint.lifecycle', timestamp: 0,
    }), context);
    expect(notice.conversation).toBeUndefined();
  });
});
