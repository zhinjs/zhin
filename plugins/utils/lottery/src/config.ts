import type { Kl8Config, Kl8ConfigInput } from './games/kl8-groups.js';
import { resolveKl8Config } from './games/kl8-groups.js';
import type { GameId } from './types.js';
import { resolveEnabledGames } from './games/registry.js';

export interface LotteryConfig {
  readonly pickCount: number;
  readonly scheduleCron: string;
  readonly historyLimit: number;
  readonly scheduleEnabled: boolean;
  readonly backtestEnabled: boolean;
  readonly backtestWindow: number;
  readonly backtestRandomTrials: number;
  readonly backtestMinHistory: number;
  readonly backtestAdaptive: boolean;
  readonly weightPersistEnabled: boolean;
  readonly weightHoldoutFallback: boolean;
  readonly kl8?: Kl8ConfigInput;
  readonly games: readonly string[];
  /** Plugin Runtime OutboundHost push targets (cron / publish). */
  readonly pushTargets: readonly LotteryPushTargetConfig[];
}

export interface LotteryPushTargetConfig {
  readonly adapter: string;
  readonly endpointId?: string;
  readonly channelType?: string;
  readonly channelId: string;
}

export const DEFAULT_LOTTERY_CONFIG: LotteryConfig = {
  pickCount: 5,
  scheduleCron: '0 0 18 * * *',
  historyLimit: 500,
  scheduleEnabled: true,
  backtestEnabled: true,
  backtestWindow: 50,
  backtestRandomTrials: 64,
  backtestMinHistory: 30,
  backtestAdaptive: true,
  weightPersistEnabled: true,
  weightHoldoutFallback: true,
  kl8: {
    pickCount: 5,
    recommendGroups: 3,
    groupStrategies: ['balanced', 'hot', 'cold'],
  },
  games: ['kl8', 'ssq', 'dlt', 'fc3d', 'pl3', 'pl5'],
  pushTargets: [],
};

export function resolveLotteryConfig(raw: Partial<LotteryConfig> | undefined): LotteryConfig {
  const pushTargets = Array.isArray(raw?.pushTargets)
    ? raw!.pushTargets
        .filter((t): t is LotteryPushTargetConfig =>
          !!t && typeof t === 'object'
          && typeof t.adapter === 'string'
          && typeof t.channelId === 'string'
          && t.adapter.length > 0
          && t.channelId.length > 0)
        .map((t) => Object.freeze({
          adapter: t.adapter,
          endpointId: typeof t.endpointId === 'string' ? t.endpointId : t.adapter,
          channelType: typeof t.channelType === 'string' ? t.channelType : 'private',
          channelId: t.channelId,
        }))
    : [];
  return {
    ...DEFAULT_LOTTERY_CONFIG,
    ...raw,
    games: raw?.games?.length ? [...raw.games] : [...DEFAULT_LOTTERY_CONFIG.games],
    kl8: { ...DEFAULT_LOTTERY_CONFIG.kl8, ...raw?.kl8 },
    pushTargets,
  };
}

export function lotteryKl8(config: LotteryConfig): Kl8Config {
  return resolveKl8Config(config.pickCount, config.kl8);
}

export function lotteryEnabledGames(config: LotteryConfig): GameId[] {
  return resolveEnabledGames([...config.games]);
}
