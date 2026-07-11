import type { GameId } from '../types.js';

export type LotteryAgentTask = 'daily_pipeline';

export interface LotteryAgentContext {
  syncSummary?: string;
  newDrawsSummary?: string;
  games?: GameId[];
  push?: boolean;
}

/** Prompt when agent is invoked interactively (cron uses code pipeline). */
export function buildDailyPipelinePrompt(ctx: LotteryAgentContext): string {
  const games = (ctx.games ?? []).join(', ') || 'kl8, ssq, dlt, fc3d, pl3, pl5';
  return [
    '[lottery daily_pipeline]',
    `games: ${games}`,
    'Steps: lottery_sync → review pending (skip if empty) → lottery_compute_recommend → lottery_publish_report',
    ctx.push ? 'push: true' : 'push: false',
  ].join('\n');
}
