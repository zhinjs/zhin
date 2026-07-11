import { mapNoticeParts, mapRequestParts, mapNoticeType, mapRequestType, resolveSideEventDedupeKey } from '../src/side-event/normalize.js';
import { composeSideEventName, formatSideEventName } from '../src/side-event/base.js';

describe('side-event normalize', () => {
  describe('mapNoticeParts', () => {
    it('OneBot group_increase → group + member_increase', () => {
      expect(mapNoticeParts('onebot', 'group_increase')).toEqual({
        scene_type: 'group',
        sub_type: 'member_increase',
      });
      expect(mapNoticeType('onebot', 'group_increase')).toBe('notice.group.member_increase');
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

    it('KOOK joined_guild → group + member_increase', () => {
      expect(mapNoticeParts('kook', 'joined_guild')).toEqual({
        scene_type: 'group',
        sub_type: 'member_increase',
      });
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
      expect(mapRequestType('onebot', 'friend')).toBe('request.friend.add');
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
        $type: 'notice',
        $scene_type: 'group',
        $sub_type: 'member_increase',
      })).toBe('notice.group.member_increase');
    });
  });

  describe('resolveSideEventDedupeKey', () => {
    it('优先使用 flag', () => {
      expect(resolveSideEventDedupeKey({ flag: 'abc' }, 'request')).toBe('request:abc');
    });
  });
});
