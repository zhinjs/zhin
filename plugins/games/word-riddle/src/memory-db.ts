import { createHostGameDb, createInMemoryGameDb } from '@zhin.js/game-kit';
import type { DatabaseHost } from '@zhin.js/plugin-runtime';
import { defineHostTables } from './models.js';
import { createServices, type RiddleDatabase, type SessionService } from './session-service.js';

const RIDDLE_TABLES = ['word_riddle_sessions'] as const;

/** In-memory word_riddle_sessions for Plugin Runtime slice-2 (no DatabaseFeature). */
export function createInMemoryRiddleDb(): RiddleDatabase {
  return createInMemoryGameDb(RIDDLE_TABLES) as unknown as RiddleDatabase;
}

export function mountRiddleMemoryServices(): SessionService {
  const services = createServices(createInMemoryRiddleDb());
  return services;
}

export function mountRiddleHostServices(host: DatabaseHost): SessionService {
  defineHostTables(host);
  const services = createServices(createHostGameDb(host, RIDDLE_TABLES) as unknown as RiddleDatabase);
  return services;
}
