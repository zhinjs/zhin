/**
 * Shared runtime deps for lottery agent/ authoring tools.
 * Set once from plugin index during init — never call getPlugin() from tool execute.
 */
import type { GameId } from './types.js';
import type { LotteryDb } from './db.js';
import type { Kl8Config } from './games/kl8-groups.js';

export interface LotteryAgentDeps {
  getDb: () => LotteryDb | null;
  getConfig: () => { pickCount: number; historyLimit: number; kl8: Kl8Config };
  enabledGames: () => GameId[];
  scheduleCron: () => string;
  scheduleEnabled: () => boolean;
  pipelinePush: boolean;
}

let _deps: LotteryAgentDeps | null = null;
const registrations: Array<{ readonly value: LotteryAgentDeps }> = [];

export function setLotteryAgentDeps(deps: LotteryAgentDeps): void {
  _deps = deps;
}

/** Generation-owned Agent dependency binding used by Plugin Runtime setup(). */
export function registerLotteryAgentDeps(deps: LotteryAgentDeps): () => void {
  const registration = Object.freeze({ value: deps });
  registrations.push(registration);
  return () => {
    const index = registrations.lastIndexOf(registration);
    if (index >= 0) registrations.splice(index, 1);
  };
}

export function getLotteryAgentDeps(): LotteryAgentDeps {
  const deps = registrations[registrations.length - 1]?.value ?? _deps;
  if (!deps) throw new Error('lottery agent deps not initialized');
  return deps;
}
