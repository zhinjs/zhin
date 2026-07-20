import { describe, expect, it } from 'vitest';
import { defineAiDatabaseModels } from '../src/init/define-ai-database-models.js';

describe('defineAiDatabaseModels', () => {
  it('registers ADR 0009 AI / orchestration / collaboration tables', () => {
    const names: string[] = [];
    const count = defineAiDatabaseModels((name, definition) => {
      names.push(name);
      expect(definition).toBeTruthy();
      expect(typeof definition).toBe('object');
    });
    expect(count).toBe(16);
    expect(names).toEqual([
      'im_transcripts',
      'agent_sessions',
      'agent_messages',
      'agent_summaries',
      'ai_user_profiles',
      'orchestration_runs',
      'orchestration_tasks',
      'orchestration_events',
      'memory_entries',
      'collaboration_scenes',
      'collaboration_scene_members',
      'collaboration_scene_artifacts',
      'collaboration_scene_aliases',
      'collaboration_init_sessions',
      'collaboration_init_observations',
      'collaboration_scene_member_channels',
    ]);
  });
});
