import { createHostGameDb, createInMemoryGameDb } from '@zhin.js/game-kit';
import type { DatabaseHost } from '@zhin.js/plugin-runtime';
import { defineHostTables } from './models.js';
import { createServices, type GuessDatabase, type SessionService } from './session-service.js';
import { setGameServices } from './runtime-store.js';

const GUESS_TABLES = ['guess_sessions'] as const;

/** In-memory guess_sessions for Plugin Runtime slice-2 (no DatabaseFeature). */
export function createInMemoryGuessDb(): GuessDatabase {
  return createInMemoryGameDb(GUESS_TABLES) as unknown as GuessDatabase;
}

export function mountGuessMemoryServices(): SessionService {
  const services = createServices(createInMemoryGuessDb());
  setGameServices(services);
  return services;
}

export function mountGuessHostServices(host: DatabaseHost): SessionService {
  defineHostTables(host);
  const services = createServices(createHostGameDb(host, GUESS_TABLES) as unknown as GuessDatabase);
  setGameServices(services);
  return services;
}
