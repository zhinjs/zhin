import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parseAgentToolDefinition } from '@zhin.js/tool';
import { createInMemoryLotteryDb } from '../src/memory-db.js';
import { upsertDraws } from '../src/db.js';
import { lotteryRuntimeToken, type LotteryRuntime } from '../src/runtime-state.js';
import { resolveLotteryConfig } from '../src/config.js';
import computeRecommend from '../tools/compute-recommend.js';
import getModelState from '../tools/get-model-state.js';
import history from '../tools/history.js';
import listPending from '../tools/list-pending.js';
import savePrediction from '../tools/save-prediction.js';
import statsSnapshot from '../tools/stats-snapshot.js';
import sync from '../tools/sync.js';

const TOOLS = [
  computeRecommend,
  getModelState,
  history,
  listPending,
  savePrediction,
  statsSnapshot,
  sync,
] as const;

function runtime(): LotteryRuntime {
  return {
    db: createInMemoryLotteryDb(),
    config: resolveLotteryConfig({ pickCount: 1, historyLimit: 10 }),
    enabledGames: [],
    outbound: null,
  };
}

function context(value: LotteryRuntime) {
  return {
    use: (token: typeof lotteryRuntimeToken) => {
      expect(token).toBe(lotteryRuntimeToken);
      return value;
    },
  } as never;
}

describe('lottery ToolFeature definitions', () => {
  it('ships the convention directory and declares its Feature provider', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      files?: string[];
      scripts?: { build?: string };
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      zhin?: { features?: Array<{ package: string }> };
    };
    expect(manifest.files).toContain('tools');
    expect(manifest.scripts?.build).toContain('pnpm run clean');
    expect(manifest.dependencies?.zod).toBeDefined();
    expect(manifest.peerDependencies?.zod).toBeUndefined();
    expect(manifest.zhin?.features?.map((feature) => feature.package)).toContain('@zhin.js/tool');
  });

  it('uses only validated tools/*.ts convention definitions', () => {
    expect(TOOLS.map(parseAgentToolDefinition)).toEqual([...TOOLS]);
  });

  it('resolves data from the invoking owner capability context without cross-instance state', async () => {
    const first = runtime();
    const second = runtime();
    await upsertDraws(first.db, [{
      gameId: 'ssq',
      issue: '001',
      drawTime: '2026-01-01',
      numbers: { red: [1, 2, 3, 4, 5, 6], blue: [7] },
      source: 'fucai',
    }]);

    await expect(history.execute({ game: 'ssq' }, context(first))).resolves.toContain('001');
    await expect(history.execute({ game: 'ssq' }, context(second))).resolves.toBe('[]');
  });
});
