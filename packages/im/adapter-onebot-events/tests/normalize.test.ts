import { composeSideEventName, formatSideEventName } from '@zhin.js/core';
import { mapNoticeParts, mapRequestParts, resolveSideEventDedupeKey } from '../src/normalize.js';

describe('side-event normalize', () => {
  describe('mapNoticeParts', () => {
    it('OneBot group_increase → group + member_increase', () => {
      expect(mapNoticeParts('onebot', 'group_increase')).toEqual({
        scene_type: 'group',
        sub_type: 'member_increase',
      });
    });

    it('OneBot friend_add → friend + increase', () => {
      expect(mapNoticeParts('onebot', 'friend_add')).toEqual({
        scene_type: 'friend',
        sub_type: 'increase',
      });
    });

    it('notify poke 群 → group + poke', () => {
      expect(mapNoticeParts('onebot', 'notify', { sub_type: 'poke', is_group: true }))
        .toEqual({ scene_type: 'group', sub_type: 'poke' });
    });

    it('notify poke 私聊 → friend + poke', () => {
      expect(mapNoticeParts('onebot', 'notify', { sub_type: 'poke', is_group: false }))
        .toEqual({ scene_type: 'friend', sub_type: 'poke' });
    });

    it('essence add → group + essence_add', () => {
      expect(mapNoticeParts('napcat', 'essence', { sub_type: 'add' })).toEqual({
        scene_type: 'group',
        sub_type: 'essence_add',
      });
    });
  });

  describe('mapRequestParts', () => {
    it('friend → friend + add', () => {
      expect(mapRequestParts('onebot', 'friend')).toEqual({ scene_type: 'friend', sub_type: 'add' });
    });

    it('group invite → group + invite', () => {
      expect(mapRequestParts('onebot', 'group', 'invite')).toEqual({
        scene_type: 'group',
        sub_type: 'invite',
      });
    });

    it('group add → group + add', () => {
      expect(mapRequestParts('onebot', 'group', 'add')).toEqual({
        scene_type: 'group',
        sub_type: 'add',
      });
    });
  });

  describe('composeSideEventName', () => {
    it('组合完整事件名', () => {
      expect(composeSideEventName('notice', 'group', 'member_increase'))
        .toBe('notice.group.member_increase');
      expect(formatSideEventName({
        name: 'notice.group.member_increase',
      })).toBe('notice.group.member_increase');
    });
  });

  describe('resolveSideEventDedupeKey', () => {
    it('优先使用 flag', () => {
      expect(resolveSideEventDedupeKey({ flag: 'abc' }, 'request')).toBe('request:abc');
    });

    it('同一群两个人入群（平台不给 time）键不同，不会互相去重', () => {
      const a = resolveSideEventDedupeKey({ notice_type: 'group', sub_type: 'increase', group_id: 1048877509, user_id: 1001 }, 'notice');
      const b = resolveSideEventDedupeKey({ notice_type: 'group', sub_type: 'increase', group_id: 1048877509, user_id: 1002 }, 'notice');
      expect(a).not.toBe(b);
    });

    it('同一事件重复投递键相同', () => {
      const raw = { time: 1700000000, notice_type: 'group', sub_type: 'decrease', group_id: 1, user_id: 2, operator_id: 3 };
      expect(resolveSideEventDedupeKey(raw, 'notice')).toBe(resolveSideEventDedupeKey({ ...raw }, 'notice'));
    });
  });
});
