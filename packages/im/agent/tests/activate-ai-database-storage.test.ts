import { describe, expect, it, vi } from 'vitest';
import type { AIConfig } from '@zhin.js/ai';
import { activateAiDatabaseStorage } from '../src/init/activate-ai-database-storage.js';
import type { AIServiceRefs } from '../src/internal/ai-service-refs.js';
import { ActivatableWorkroomCatalog } from '../src/workroom/catalog.js';
import {
  ActivatableWorkroomJournal,
  MemoryWorkroomJournalPayloadPort,
} from '../src/workroom/journal.js';

describe('activateAiDatabaseStorage', () => {
  const requiredModels = [
    'agent_sessions',
    'agent_messages',
    'agent_summaries',
    'workroom_events',
    'workroom_catalog',
  ];

  it.each(requiredModels)(
    'rejects database mode before configuration when the %s model is absent',
    async (missingModel) => {
      const configure = vi.fn();
      const refs = { zhinAgent: { configure } } as unknown as AIServiceRefs;
      const models = requiredModels
        .filter((name) => name !== missingModel)
        .map((name) => [name, {}] as const);

      await expect(activateAiDatabaseStorage(
        { models: new Map(models) },
        refs,
        { sessions: { useDatabase: true } } as AIConfig,
        new ActivatableWorkroomJournal(),
        new MemoryWorkroomJournalPayloadPort(),
        new ActivatableWorkroomCatalog(),
        null,
      )).rejects.toThrow(`requires the ${missingModel} model`);
      expect(configure).not.toHaveBeenCalled();
    },
  );
});
