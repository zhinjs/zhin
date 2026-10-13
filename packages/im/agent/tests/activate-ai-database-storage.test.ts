import { describe, expect, it, vi } from 'vitest';
import type { AIConfig } from '@zhin.js/ai';
import { activateAiDatabaseStorage } from '../src/init/activate-ai-database-storage.js';
import type { AIServiceRefs } from '../src/internal/ai-service-refs.js';
import { prepareWorkroomDatabaseStorage } from '../src/workroom-runtime/workroom-database-storage.js';
import { MemoryWorkroomJournalPayloadPort } from '../src/workroom/journal/index.js';

describe('activateAiDatabaseStorage', () => {
  const requiredModels = [
    'agent_sessions',
    'agent_messages',
    'agent_summaries',
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
        null,
      )).rejects.toThrow(`requires the ${missingModel} model`);
      expect(configure).not.toHaveBeenCalled();
    },
  );

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
