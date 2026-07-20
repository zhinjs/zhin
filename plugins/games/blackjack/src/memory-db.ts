import { createHostGameDb, createInMemoryGameDb } from '@zhin.js/game-kit';
import type { DatabaseHost } from '@zhin.js/plugin-runtime';
import { defineHostTables } from './models.js';
import { createServices, type BjDatabase, type SessionService } from './session-service.js';
import { setGameServices } from './runtime-store.js';

const BJ_TABLES = ['bj_sessions'] as const;

/** In-memory bj_sessions for Plugin Runtime slice-2 (no DatabaseFeature). */
export function createInMemoryBjDb(): BjDatabase {
  return createInMemoryGameDb(BJ_TABLES) as unknown as BjDatabase;
}

export function mountBjMemoryServices(): SessionService {
  const services = createServices(createInMemoryBjDb());
  setGameServices(services);
  return services;
}

export function mountBjHostServices(host: DatabaseHost): SessionService {
  defineHostTables(host);
  const services = createServices(createHostGameDb(host, BJ_TABLES) as unknown as BjDatabase);
  setGameServices(services);
  return services;
}
