import { describe, it, expect } from 'vitest';
import { evaluateAchievements } from '../src/achievements.js';
import { playableSceneIds } from '../src/story-catalog.js';
import { ITEM_IDS } from '../src/story-items.js';
import { parseStringSet } from '../src/profile-parse.js';
import { formatMapProgress, formatProgressCompact } from '../src/profile-format.js';
import type { AdvProfileRow } from '../src/models.js';

function mockProfile(partial: Partial<AdvProfileRow>): AdvProfileRow {
  return {
    player_id: 'u1',
    player_name: 'tester',
    visited_scenes: '[]',
    endings_seen: '[]',
    items_found: '[]',
    achievements: '[]',
    runs_started: 0,
    runs_completed: 0,
    total_steps: 0,
    best_step_count: 0,
    updated_at: 0,
    created_at: 0,
    ...partial,
  };
}

describe('achievements', () => {
  it('unlocks first_footprint after 5 regions', () => {
    const visited = new Set(playableSceneIds().slice(0, 5));
    const newly = evaluateAchievements([], {
      visited,
      endings: new Set(),
      itemsFound: new Set(),
      runsCompleted: 0,
      bestStepCount: 0,
    });
    expect(newly).toContain('first_footprint');
  });

  it('unlocks marathon_runner at 50 steps', () => {
    const newly = evaluateAchievements([], {
      visited: new Set(),
      endings: new Set(),
      itemsFound: new Set(),
      runsCompleted: 0,
      bestStepCount: 0,
      lastRun: { stepCount: 50, inventory: [], endingId: 'escape' },
    });
    expect(newly).toContain('marathon_runner');
  });

  it('unlocks full_satchel when all items found', () => {
    const newly = evaluateAchievements([], {
      visited: new Set(),
      endings: new Set(),
      itemsFound: new Set(ITEM_IDS),
      runsCompleted: 0,
      bestStepCount: 0,
    });
    expect(newly).toContain('full_satchel');
  });
});

describe('profile format', () => {
  it('shows compact progress line', () => {
    const profile = mockProfile({
      visited_scenes: JSON.stringify(['start', 'rubble']),
      endings_seen: JSON.stringify(['coward']),
      achievements: JSON.stringify(['first_footprint']),
    });
    const line = formatProgressCompact(profile);
    expect(line).toContain('2/');
    expect(line).toContain('1/');
    expect(line).toContain('🏅');
  });

  it('map lists zones with checkmarks', () => {
    const profile = mockProfile({
      visited_scenes: JSON.stringify(['start']),
    });
    const text = formatMapProgress(profile);
    expect(text).toContain('秘境入口');
    expect(text).toContain('✅');
    expect(text).toContain('⬜');
  });
});

describe('parseStringSet', () => {
  it('accepts pre-parsed arrays from sqlite', () => {
    expect(parseStringSet(['a', 'b']).has('a')).toBe(true);
  });
});
