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
    expect(count).toBe(16);
    expect(names).toEqual([
      'agent_sessions',
      'agent_messages',
      'agent_summaries',
      'ai_user_profiles',
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
      'memory_entries',
    ]);
  });
});
