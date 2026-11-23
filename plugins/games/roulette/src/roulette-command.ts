import { gamePlayerFromInput } from '@zhin.js/game-kit';
import { runRouletteAction } from './game-flow.js';
import { normalizeRouletteAction, getRouletteHelp } from './roulette-actions.js';
import { resolveRouletteFlow, senderRolesOf, type RouletteCapabilityContext } from './runtime.js';

/**
 * Shared entry for the `roulette` command (its route, alias and `轮盘` short-entry `match`) and the
 * `roulette-fire` middleware (a bare 「开枪」 on the shooter's turn). Returns null for an unknown
 * action; the command answers that with its help (#1250 第 82 批: no alias middleware any more).
 */
export async function runRouletteCommand(
  context: RouletteCapabilityContext,
  input: unknown,
  rawAction: string,
): Promise<string | null> {
  const action = normalizeRouletteAction(rawAction);
  if (!action) return null;
  if (action === 'help') return getRouletteHelp(gamePlayerFromInput(input, context));
  const flow = resolveRouletteFlow(context);
  const actor = {
    message: gamePlayerFromInput(input, context),
    roles: senderRolesOf(input),
  };
  return runRouletteAction(flow, actor, action);
}
