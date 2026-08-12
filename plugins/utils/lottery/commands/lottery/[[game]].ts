import { defineCommand } from '@zhin.js/command';
import { parseGameId } from '../../src/games/registry.js';
import {
  buildPipelineDeps,
  formatPipelineReply,
  runLotteryPipeline,
  resolveLotteryConfig,
  type LotteryConfig,
} from '../../src/command-helpers.js';
import { lotteryRuntimeToken } from '../../src/runtime-state.js';

export default defineCommand<LotteryConfig>({
  description: 'Run full pipeline: sync → review → recommend (manual, no push)',
  params: { game: { type: 'string', default: '' } },
  async execute({ params, config, use }) {
    const cfg = resolveLotteryConfig(config);
    const gid = parseGameId(String(params.game ?? ''));
    const runtime = use(lotteryRuntimeToken);
    const out = await runLotteryPipeline(buildPipelineDeps(cfg, runtime.db), {
      gameId: gid ?? undefined,
      push: false,
    });
    return formatPipelineReply(out);
  },
});
