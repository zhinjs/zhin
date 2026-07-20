import { defineCommand } from '@zhin.js/command';
import { parseGameId } from '../../src/games/registry.js';
import {
  buildPipelineDeps,
  formatPipelineReply,
  runLotteryPipeline,
  resolveLotteryConfig,
  type LotteryConfig,
} from '../../src/command-helpers.js';

export default defineCommand<LotteryConfig>({
  description: 'Run full pipeline: sync → review → recommend (manual, no push)',
  async execute({ params, config }) {
    const cfg = resolveLotteryConfig(config);
    const gid = parseGameId(String(params.game ?? ''));
    const out = await runLotteryPipeline(buildPipelineDeps(cfg), {
      gameId: gid ?? undefined,
      push: false,
    });
    return formatPipelineReply(out);
  },
});
