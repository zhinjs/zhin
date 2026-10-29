import { mapSlackNoticeParts } from '../src/side-event-map.js';

describe('Slack event mapping', () => {
  it('maps registered event types to canonical parts', () => {
    expect(mapSlackNoticeParts('member_joined_channel')).toEqual({ scene_type: 'group', sub_type: 'member_increase' });
    expect(mapSlackNoticeParts('reaction_removed')).toEqual({ scene_type: 'group', sub_type: 'emoji_reaction' });
    expect(mapSlackNoticeParts('message_deleted')).toEqual({ scene_type: 'group', sub_type: 'recall' });
    expect(mapSlackNoticeParts('team_join')).toEqual({ scene_type: 'friend', sub_type: 'increase' });
    expect(mapSlackNoticeParts('pin_added')).toEqual({ scene_type: 'slack', sub_type: 'pin_added' });
  });

  it('returns undefined for unregistered or prototype keys', () => {
    expect(mapSlackNoticeParts('message')).toBeUndefined();
    expect(mapSlackNoticeParts('toString')).toBeUndefined();
  });
});
