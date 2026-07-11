import { describe, it, expect } from 'vitest';
import { mapNoticeParts } from 'zhin.js';
import { formatSlackNotice, isSlackNoticeEvent, resolveSlackSideEventDedupeKey } from '../src/slack-side-events.js';

describe('SLACK_NOTICE_PARTS_MAP via mapNoticeParts', () => {
  it('member_joined_channel → group.member_increase', () => {
    const parts = mapNoticeParts('slack', 'member_joined_channel');
    expect(parts).toEqual({ scene_type: 'group', sub_type: 'member_increase' });
  });

  it('member_left_channel → group.member_decrease', () => {
    const parts = mapNoticeParts('slack', 'member_left_channel');
    expect(parts).toEqual({ scene_type: 'group', sub_type: 'member_decrease' });
  });

  it('reaction_added → group.emoji_reaction', () => {
    const parts = mapNoticeParts('slack', 'reaction_added');
    expect(parts).toEqual({ scene_type: 'group', sub_type: 'emoji_reaction' });
  });

  it('reaction_removed → group.emoji_reaction', () => {
    const parts = mapNoticeParts('slack', 'reaction_removed');
    expect(parts).toEqual({ scene_type: 'group', sub_type: 'emoji_reaction' });
  });

  it('message_deleted → group.recall', () => {
    const parts = mapNoticeParts('slack', 'message_deleted');
    expect(parts).toEqual({ scene_type: 'group', sub_type: 'recall' });
  });

  it('channel_archive → slack.channel_archive', () => {
    const parts = mapNoticeParts('slack', 'channel_archive');
    expect(parts).toEqual({ scene_type: 'slack', sub_type: 'channel_archive' });
  });

  it('team_join → friend.increase', () => {
    const parts = mapNoticeParts('slack', 'team_join');
    expect(parts).toEqual({ scene_type: 'friend', sub_type: 'increase' });
  });

  it('pin_added → slack.pin_added', () => {
    const parts = mapNoticeParts('slack', 'pin_added');
    expect(parts).toEqual({ scene_type: 'slack', sub_type: 'pin_added' });
  });

  it('unknown event → slack.<event>', () => {
    const parts = mapNoticeParts('slack', 'some_unknown_event');
    expect(parts).toEqual({ scene_type: 'slack', sub_type: 'some_unknown_event' });
  });
});

describe('isSlackNoticeEvent', () => {
  it('should return true for known notice events', () => {
    expect(isSlackNoticeEvent('member_joined_channel')).toBe(true);
    expect(isSlackNoticeEvent('reaction_added')).toBe(true);
    expect(isSlackNoticeEvent('pin_removed')).toBe(true);
  });

  it('should return false for message events', () => {
    expect(isSlackNoticeEvent('message')).toBe(false);
    expect(isSlackNoticeEvent('app_mention')).toBe(false);
  });
});

describe('formatSlackNotice', () => {
  it('should produce a valid Notice from a member_joined_channel event', () => {
    const event = {
      type: 'member_joined_channel',
      user: 'U12345',
      channel: 'C001',
      event_ts: '1700000000.000000',
    };
    const notice = formatSlackNotice(event, 'test-endpoint');

    expect(notice.$adapter).toBe('slack');
    expect(notice.$endpoint).toBe('test-endpoint');
    expect(notice.$type).toBe('notice');
    expect(notice.$scene_type).toBe('group');
    expect(notice.$sub_type).toBe('member_increase');
    expect(notice.$scene_id).toBe('C001');
    expect(notice.$actor?.id).toBe('U12345');
  });

  it('should produce a valid Notice from a reaction_added event', () => {
    const event = {
      type: 'reaction_added',
      user: 'U99999',
      item: { channel: 'C002', ts: '1700000001.000000' },
      item_user: 'U12345',
      reaction: 'thumbsup',
      event_ts: '1700000002.000000',
    };
    const notice = formatSlackNotice(event, 'test-endpoint');

    expect(notice.$scene_type).toBe('group');
    expect(notice.$sub_type).toBe('emoji_reaction');
    expect(notice.$scene_id).toBe('C002');
    expect(notice.$actor?.id).toBe('U99999');
    expect(notice.$target?.id).toBe('U12345');
  });
});

describe('resolveSlackSideEventDedupeKey', () => {
  it('should produce a deterministic key', () => {
    const event = {
      type: 'member_joined_channel',
      user: 'U12345',
      channel: 'C001',
      event_ts: '1700000000.000000',
    };
    const key = resolveSlackSideEventDedupeKey(event);
    expect(key).toBe('slack:1700000000.000000_member_joined_channel_C001_U12345');
  });
});
