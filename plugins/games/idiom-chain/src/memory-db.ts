import { createHostGameDb, createInMemoryGameDb } from '@zhin.js/game-kit';
import type { DatabaseHost } from '@zhin.js/plugin-runtime';
import { defineHostTables } from './models.js';
import { createServices, type ChainDatabase, type SessionService } from './session-service.js';
import { setGameServices } from './runtime-store.js';

const CHAIN_TABLES = ['idiom_chain_sessions'] as const;

/** In-memory idiom_chain_sessions for Plugin Runtime slice-2 (no DatabaseFeature). */
export function createInMemoryChainDb(): ChainDatabase {
  return createInMemoryGameDb(CHAIN_TABLES) as unknown as ChainDatabase;
}

export function mountChainMemoryServices(): SessionService {
  const services = createServices(createInMemoryChainDb());
  setGameServices(services);
  return services;
}

export function mountChainHostServices(host: DatabaseHost): SessionService {
  defineHostTables(host);
  const services = createServices(createHostGameDb(host, CHAIN_TABLES) as unknown as ChainDatabase);
  setGameServices(services);
  return services;
}
