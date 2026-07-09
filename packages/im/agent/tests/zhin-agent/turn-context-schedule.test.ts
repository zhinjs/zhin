import { describe, expect, it } from 'vitest';
import {
  appendTurnActiveSkills,
  captureDeferredSnapshotBefore,
  getDeferredSnapshotBefore,
  getScheduleTurnContext,
  getTurnActiveSkillsFromContext,
  runInTurnContext,
  setScheduleTurnContext,
  setTurnActiveSkills,
} from '../../src/internal/turn-context.js';
import { computeDeferredDelta } from '../../src/turn/turn-deferred-delta.js';
import { TurnTracker } from '../../src/turn/turn-tracker.js';

describe('turn context schedule ALS', () => {
  it('stores and reads turnActiveSkills within runInTurnContext', async () => {
    const tracker = new TurnTracker();
    await runInTurnContext('t1', tracker, async () => {
      setTurnActiveSkills('baseline');
      appendTurnActiveSkills('extra skill');
      expect(getTurnActiveSkillsFromContext()).toBe('baseline\n\nextra skill');
    });
    expect(getTurnActiveSkillsFromContext()).toBe('');
  });

  it('initializes scheduleContext from runInTurnContext init', async () => {
    const tracker = new TurnTracker();
    await runInTurnContext('t1', tracker, async () => {
      expect(getScheduleTurnContext()).toEqual({
        preview: true,
        jobId: 'j1',
      });
    }, {
      scheduleContext: { preview: true, jobId: 'j1' },
    });
  });

  it('allows mutating scheduleContext during turn', async () => {
    const tracker = new TurnTracker();
    await runInTurnContext('t1', tracker, async () => {
      setScheduleTurnContext({ activityFeedback: true });
      expect(getScheduleTurnContext()?.activityFeedback).toBe(true);
    });
  });

  it('captureDeferredSnapshotBefore stores immutable before snapshot', async () => {
    const tracker = new TurnTracker();
    await runInTurnContext('t1', tracker, async () => {
      captureDeferredSnapshotBefore({
        loadedTools: { web_search: 1 },
        loadedSkills: ['weather'],
      });
      const before = getDeferredSnapshotBefore()!;
      before.loadedSkills.push('mutated');
      before.loadedTools['new'] = 2;
      expect(getDeferredSnapshotBefore()?.loadedSkills).toEqual(['weather']);
      expect(Object.keys(getDeferredSnapshotBefore()!.loadedTools)).toEqual(['web_search']);
    });
  });
});

describe('computeDeferredDelta', () => {
  it('returns skill and tool delta excluding meta and always-loaded tools', () => {
    const delta = computeDeferredDelta(
      {
        loadedTools: {
          discover: 1,
          load_tool: 1,
          web_search: 2,
          weather_tool: 3,
        },
        loadedSkills: ['always', 'weather'],
      },
      ['discover', 'load_tool', 'load_skill'],
      {
        loadedTools: { discover: 1, load_tool: 1 },
        loadedSkills: ['always'],
      },
    );
    expect(delta.skills).toEqual(['weather']);
    expect(delta.tools).toEqual(['web_search', 'weather_tool']);
  });

  it('returns empty delta when before override is missing', () => {
    expect(computeDeferredDelta({ loadedTools: {}, loadedSkills: ['x'] })).toEqual({
      tools: [],
      skills: [],
    });
  });
});
