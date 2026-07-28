/**
 * Shared runtime deps for lottery agent/ authoring tools.
 * Set once from plugin index during init — never call getPlugin() from tool execute.
 */
import { createGenerationStore, DisposeStack, type Dispose } from '@zhin.js/plugin-runtime';
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

const agentDepsStore = createGenerationStore<LotteryAgentDeps>('lottery/agent-deps');

let _deps: LotteryAgentDeps | null = null;

export function setLotteryAgentDeps(deps: LotteryAgentDeps): void {
  _deps = deps;
}

/**
 * Generation-owned Agent dependency binding used by Plugin Runtime setup().
 * The fresh lifecycle is detached: callers own the returned dispose (setup()
 * hooks it into context.lifecycle); provide() does not retain the context.
 */
export function registerLotteryAgentDeps(deps: LotteryAgentDeps): Dispose {
  return agentDepsStore.provide({ lifecycle: new DisposeStack() }, deps);
}

export function getLotteryAgentDeps(): LotteryAgentDeps {
  const deps = agentDepsStore.tryUse() ?? _deps;
  if (!deps) throw new Error('lottery agent deps not initialized');
  return deps;
}
