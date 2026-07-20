import { createHostGameDb, createInMemoryGameDb } from '@zhin.js/game-kit';
import type { DatabaseHost } from '@zhin.js/plugin-runtime';
import { defineHostTables } from './models.js';
import { createServices, type DiceDatabase, type SessionService } from './session-service.js';

const DICE_TABLES = ['dice_sessions'] as const;

/** In-memory dice_sessions for Plugin Runtime slice-2 (no DatabaseFeature). */
export function createInMemoryDiceDb(): DiceDatabase {
  return createInMemoryGameDb(DICE_TABLES) as unknown as DiceDatabase;
}

export function mountDiceMemoryServices(): SessionService {
  const services = createServices(createInMemoryDiceDb());
  return services;
}

export function mountDiceHostServices(host: DatabaseHost): SessionService {
  defineHostTables(host);
  const services = createServices(createHostGameDb(host, DICE_TABLES) as unknown as DiceDatabase);
  return services;
}
