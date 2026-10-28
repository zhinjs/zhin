import { describe, expect, it } from 'vitest';
import { defineAiDatabaseModels } from '../src/init/define-ai-database-models.js';

function collect(register: (define: (name: string, definition: Record<string, unknown>) => void) => number) {
  const names: string[] = [];
  const count = register((name, definition) => {
    names.push(name);
    expect(definition).toBeTruthy();
    expect(typeof definition).toBe('object');
  });
  return { names, count };
}

describe('defineAiDatabaseModels', () => {
  it('registers agent persistence tables', () => {
    const { names, count } = collect(defineAiDatabaseModels);
    expect(count).toBe(13);
    expect(names).toEqual([
      'agent_sessions',
      'agent_messages',
      'agent_summaries',
      'ai_user_profiles',
      'ai_user_relations',
      'ai_session_profiles',
      'ai_decision_events',
      'ai_control_state',
      'ai_session_ops',
      'ai_announcements',
      'ai_session_events',
      'ai_group_rules',
      'memory_entries',
    ]);
  });
});
