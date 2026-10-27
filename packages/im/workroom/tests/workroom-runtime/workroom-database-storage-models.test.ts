import { describe, expect, it } from 'vitest';
import { defineAiDatabaseModels } from '@zhin.js/agent/runtime';
import { defineWorkroomDatabaseModels } from '../../src/workroom-runtime/workroom-database-models.js';
import { prepareWorkroomDatabaseStorage } from '../../src/workroom-runtime/workroom-database-storage.js';
import { MemoryWorkroomJournalPayloadPort } from '../../src/workroom/journal/index.js';

function collect(register: (define: (name: string, definition: Record<string, unknown>) => void) => number) {
  const names: string[] = [];
  const count = register((name, definition) => {
    names.push(name);
    expect(definition).toBeTruthy();
    expect(typeof definition).toBe('object');
  });
  return { names, count };
}

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

  it('together with agent tables registers 20 tables', () => {
    expect(collect(defineAiDatabaseModels).count + collect(defineWorkroomDatabaseModels).count).toBe(20);
  });
});

describe('prepareWorkroomDatabaseStorage', () => {
  it.each(['workroom_events', 'workroom_catalog'])(
    'rejects Workroom preparation when the %s model is absent',
    async (missingModel) => {
      const models = ['workroom_events', 'workroom_catalog']
        .filter((name) => name !== missingModel)
        .map((name) => [name, {}] as const);
      await expect(prepareWorkroomDatabaseStorage(
        { models: new Map(models) },
        new MemoryWorkroomJournalPayloadPort(),
      )).rejects.toThrow(`requires the ${missingModel} model`);
    },
  );
});
