import { gamePlayerFromInput } from '@zhin.js/game-kit';
import { runRouletteAction } from './game-flow.js';
import { normalizeRouletteAction, getRouletteHelp } from './roulette-actions.js';
import { resolveRouletteFlow, senderRolesOf, type RouletteCapabilityContext } from './runtime.js';

/**
 * Shared entry for the `roulette` command and the `轮盘` alias middleware.
 * Returns null for unknown words so the alias middleware lets the chat through.
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
