import { describe, expect, it } from 'vitest';
import { defineAiDatabaseModels } from '../src/init/define-ai-database-models.js';
import { defineWorkroomDatabaseModels } from '../src/workroom-runtime/workroom-database-models.js';

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
    expect(count).toBe(5);
    expect(names).toEqual([
      'agent_sessions',
      'agent_messages',
      'agent_summaries',
      'ai_user_profiles',
      'memory_entries',
    ]);
  });
});

describe('defineWorkroomDatabaseModels', () => {
  it('registers Workroom, portfolio and data-governance tables', () => {
    const { names, count } = collect(defineWorkroomDatabaseModels);
    expect(count).toBe(11);
    expect(names).toEqual([
      'workroom_events',
      'workroom_catalog',
      'workroom_assignment_authority_grants',
      'portfolio_control_outbox',
      'payload_lifecycle_events',
      'payload_vault_objects',
      'payload_vault_audit',
      'payload_vault_handoffs',
      'payload_vault_handoff_retirements',
      'workroom_project_knowledge',
      'workroom_overlay_pack_promotions',
    ]);
  });

  it('together with agent tables registers 16 tables', () => {
    expect(collect(defineAiDatabaseModels).count + collect(defineWorkroomDatabaseModels).count).toBe(16);
  });
});
