import { describe, expect, it } from 'vitest';
import { scenePromptPartsForTurn } from '../../src/context/turn-envelope.js';
import { appendScene, joinSystemPrompt } from '../../src/prompt/assembly.js';
import type { TurnContextView } from '../../src/context/turn-envelope.js';

const turn = (state: Record<string, unknown> = {}): TurnContextView => ({
  origin: { kind: 'im', platform: 'icqq', endpoint: 'bot', scope: 'group', sceneId: 'g' },
  principal: { subjectId: 'member', roles: ['user'] },
  session: { key: 'icqq:bot:group:g' },
  input: { contextState: state },
} as TurnContextView);

describe('scene identity and current state', () => {
  it('keeps mutable facts out of the session-stable system tail', () => {
    const before = scenePromptPartsForTurn(turn({ bot: { platformRole: 'admin' },
      conversation: { name: 'Before', ownerId: 'a', adminIds: ['b', 'a'], memberCount: 12, muteAll: false } }))!;
    const after = scenePromptPartsForTurn(turn({ bot: { platformRole: 'member' },
      conversation: { name: 'After', ownerId: 'b', adminIds: ['c'], memberCount: 13, muteAll: true } }))!;
    const system = (identity: string) => joinSystemPrompt(appendScene({ stable: 'fixed instructions', scene: '' }, identity));
    expect(system(before.identity)).toEqual(system(after.identity));
    expect(before.identity).toBe('[scene_id:g;scene_type:group;]');
    expect(before.state).toContain('admins:a,b;');
    expect(after.state).toBe('[scene_name:After;owner_id:b;admins:c;member_count:13;global_mute:true;assistant_role:member;]');
    expect(after.state).not.toMatch(/Before|assistant_role:admin|member_count:12/);
    expect(system(after.identity).text).not.toMatch(/After|owner_id|admins|member_count|mute|assistant_role/);
  });

  it('does not replay known facts after the next observation becomes unknown', () => {
    expect(scenePromptPartsForTurn(turn({ bot: { platformRole: 'admin' } }))!.state).toContain('assistant_role:admin');
    expect(scenePromptPartsForTurn(turn())).toEqual({ identity: '[scene_id:g;scene_type:group;]' });
  });

  it('updates identity when the canonical conversation binding changes', () => {
    const base = turn();
    if (base.origin.kind !== 'im') throw new Error('expected IM');
    const rebound = { ...base, origin: { ...base.origin, conversation: {
      endpoint: { adapter: 'icqq', id: 'bot' }, kind: 'channel' as const, id: 'channel-new', name: 'New channel',
    } } };
    expect(scenePromptPartsForTurn(rebound)).toEqual({ identity: '[scene_id:channel-new;scene_type:channel;]', state: '[scene_name:New channel;]' });
  });

  it('does not manufacture IM identity for other turn origins', () => {
    expect(scenePromptPartsForTurn({ ...turn(), origin: { kind: 'internal', source: 'synthetic' } } as TurnContextView)).toBeUndefined();
  });
});
