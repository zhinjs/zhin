import { mapKookNoticeParts } from '../src/side-event-map.js';

describe('KOOK notice mapping', () => {
  it('maps registered extra.type values to canonical parts', () => {
    expect(mapKookNoticeParts('joined_guild')).toEqual({ scene_type: 'group', sub_type: 'member_increase' });
    expect(mapKookNoticeParts('exited_guild')).toEqual({ scene_type: 'group', sub_type: 'member_decrease' });
    expect(mapKookNoticeParts('deleted_private_message')).toEqual({ scene_type: 'friend', sub_type: 'recall' });
    expect(mapKookNoticeParts('added_reaction')).toEqual({ scene_type: 'group', sub_type: 'emoji_reaction' });
  });

  it('returns undefined for unregistered or prototype keys', () => {
    expect(mapKookNoticeParts('updated_guild')).toBeUndefined();
    expect(mapKookNoticeParts('constructor')).toBeUndefined();
  });
});
