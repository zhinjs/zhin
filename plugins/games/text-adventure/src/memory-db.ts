import { createHostGameDb, createInMemoryGameDb } from '@zhin.js/game-kit';
import type { DatabaseHost } from '@zhin.js/plugin-runtime';
import { defineHostTables } from './models.js';
import { createServices, type AdvDatabase, type GameServices } from './session-service.js';

const ADV_TABLES = ['adv_sessions', 'adv_profiles'] as const;

/** In-memory adv tables for Plugin Runtime slice-2 (no DatabaseFeature). */
export function createInMemoryAdvDb(): AdvDatabase {
  return createInMemoryGameDb(ADV_TABLES) as unknown as AdvDatabase;
}

export function mountAdvMemoryServices(): GameServices {
  const services = createServices(createInMemoryAdvDb());
  return services;
}

export function mountAdvHostServices(host: DatabaseHost): GameServices {
  defineHostTables(host);
  const services = createServices(createHostGameDb(host, ADV_TABLES) as unknown as AdvDatabase);
  return services;
}
