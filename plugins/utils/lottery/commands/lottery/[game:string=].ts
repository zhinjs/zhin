import { defineCommand } from '@zhin.js/command';
import { parseGameId } from '../../src/games/registry.js';
import {
  buildPipelineDeps,
  formatPipelineReply,
  getLotteryDb,
  runLotteryPipeline,
  resolveLotteryConfig,
  type LotteryConfig,
} from '../../src/command-helpers.js';
import { resolveLotteryRuntime } from '../../src/runtime-state.js';

export default defineCommand<LotteryConfig>({
  description: 'Run full pipeline: sync → review → recommend (manual, no push)',
  async execute({ params, config, owner, use }) {
    const cfg = resolveLotteryConfig(config);
    const gid = parseGameId(String(params.game ?? ''));
    const db = resolveLotteryRuntime({ owner, use })?.db ?? getLotteryDb();
    const out = await runLotteryPipeline(buildPipelineDeps(cfg, db), {
      gameId: gid ?? undefined,
      push: false,
    });
    return formatPipelineReply(out);
  },
});
