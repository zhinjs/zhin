import { createHostGameDb, createInMemoryGameDb } from '@zhin.js/game-kit';
import type { DatabaseHost } from '@zhin.js/plugin-runtime';
import { defineHostTables } from './models.js';
import { createServices, type RpsDatabase, type SessionService } from './session-service.js';

const RPS_TABLES = ['rps_sessions'] as const;

/** In-memory rps_sessions for Plugin Runtime slice-2 (no DatabaseFeature). */
export function createInMemoryRpsDb(): RpsDatabase {
  return createInMemoryGameDb(RPS_TABLES) as unknown as RpsDatabase;
}

export function mountRpsMemoryServices(): SessionService {
  const services = createServices(createInMemoryRpsDb());
  return services;
}

export function mountRpsHostServices(host: DatabaseHost): SessionService {
  defineHostTables(host);
  const services = createServices(createHostGameDb(host, RPS_TABLES) as unknown as RpsDatabase);
  return services;
}
