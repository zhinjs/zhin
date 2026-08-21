import { describe, expect, it } from 'vitest';
import { defineAiDatabaseModels } from '../src/init/define-ai-database-models.js';

describe('defineAiDatabaseModels', () => {
  it('registers AI and orchestration tables', () => {
    const names: string[] = [];
    const count = defineAiDatabaseModels((name, definition) => {
      names.push(name);
      expect(definition).toBeTruthy();
      expect(typeof definition).toBe('object');
    });
    expect(count).toBe(7);
    expect(names).toEqual([
      'agent_sessions',
      'agent_messages',
      'agent_summaries',
      'ai_user_profiles',
      'workroom_events',
      'workroom_catalog',
      'memory_entries',
    ]);
  });
});
