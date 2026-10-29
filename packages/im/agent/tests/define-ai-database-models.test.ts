import { describe, expect, it } from 'vitest';
import { defineAiDatabaseModels } from '../src/init/define-ai-database-models.js';

function collect(register: (define: (name: string, definition: Record<string, unknown>, options?: { readonly addColumns?: readonly string[] }) => void) => number) {
  const names: string[] = [];
  const options = new Map<string, readonly string[] | undefined>();
  const count = register((name, definition, option) => {
    names.push(name);
    options.set(name, option?.addColumns);
    expect(definition).toBeTruthy();
    expect(typeof definition).toBe('object');
  });
  return { names, count, options };
}

describe('defineAiDatabaseModels', () => {
  it('registers agent persistence tables', () => {
    const { names, count, options } = collect(defineAiDatabaseModels);
    expect(count).toBe(14);
    expect(names).toEqual([
      'agent_sessions',
      'agent_messages',
      'agent_summaries',
      'ai_user_profiles',
      'ai_user_relations',
      'ai_session_profiles',
      'ai_scene_members',
      'ai_decision_events',
      'ai_control_state',
      'ai_session_ops',
      'ai_announcements',
      'ai_session_events',
      'ai_group_rules',
      'memory_entries',
    ]);
    // ADR 0041 §6: columns added to an existing table migrate additively.
    expect(options.get('ai_session_profiles')).toEqual(['owner_id', 'member_count', 'facts_updated_at']);
  });
});
