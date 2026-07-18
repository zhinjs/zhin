import { createHostGameDb, createInMemoryGameDb } from '@zhin.js/game-kit';
import type { DatabaseHost } from '@zhin.js/plugin-runtime';
import { defineHostTables } from './models.js';
import { createServices, type TttDatabase, type SessionServices } from './session-service.js';
import { setGameServices } from './runtime-store.js';

const TTT_TABLES = ['ttt_sessions', 'ttt_queue', 'ttt_moves', 'ttt_spectators'] as const;

/** In-memory ttt tables for Plugin Runtime slice-2 (no DatabaseFeature). */
export function createInMemoryTttDb(): TttDatabase {
  return createInMemoryGameDb(TTT_TABLES) as unknown as TttDatabase;
}

export function mountTttMemoryServices(): SessionServices {
  const services = createServices(createInMemoryTttDb());
  setGameServices(services);
  return services;
}

export function mountTttHostServices(host: DatabaseHost): SessionServices {
  defineHostTables(host);
  const services = createServices(createHostGameDb(host, TTT_TABLES) as unknown as TttDatabase);
  setGameServices(services);
  return services;
}
