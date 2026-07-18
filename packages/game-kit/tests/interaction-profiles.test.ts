import { describe, expect, it } from 'vitest';
import { applyInteractionProfile } from '../src/interaction-profiles.js';

describe('applyInteractionProfile', () => {
  const base = {
    id: 'a',
    label: 'A',
    payload: 'hub:s1:g_ttt',
  };

  it('menu profile uses command mode', () => {
    expect(applyInteractionProfile(base, { profile: 'menu' }).mode).toBe('command');
  });

  it('gameplay profile uses callback mode', () => {
    expect(applyInteractionProfile(base, { profile: 'gameplay' }).mode).toBe('callback');
  });

  it('terminal profile uses command with enter in private', () => {
    const priv = applyInteractionProfile(base, { profile: 'terminal', channelType: 'private' });
    expect(priv.mode).toBe('command');
    expect(priv.command?.enter).toBe(true);

    const group = applyInteractionProfile(base, { profile: 'terminal', channelType: 'group' });
    expect(group.command?.enter).toBe(false);
  });

  it('respects explicit mode override', () => {
    expect(
      applyInteractionProfile({ ...base, mode: 'callback' }, { profile: 'menu' }).mode,
    ).toBe('callback');
  });
});
