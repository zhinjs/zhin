/**
 * Shared runtime deps for lottery agent/ authoring tools.
 * Set once from plugin index during init — never call getPlugin() from tool execute.
 */
import type { Plugin } from 'zhin.js';
import type { GameId } from './types.js';
import type { LotteryDb } from './db.js';
import type { Kl8Config } from './games/kl8-groups.js';

export interface LotteryAgentDeps {
  getDb: () => LotteryDb | null;
  getConfig: () => { pickCount: number; historyLimit: number; kl8: Kl8Config };
  plugin: Plugin;
  enabledGames: () => GameId[];
  scheduleCron: () => string;
  scheduleEnabled: () => boolean;
  pipelinePush: boolean;
}

let _deps: LotteryAgentDeps | null = null;

export function setLotteryAgentDeps(deps: LotteryAgentDeps): void {
  _deps = deps;
}

export function getLotteryAgentDeps(): LotteryAgentDeps {
  if (!_deps) throw new Error('lottery agent deps not initialized');
  return _deps;
}
