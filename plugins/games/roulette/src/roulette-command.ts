import { messageFromCommandInput } from '@zhin.js/game-kit';
import { runRouletteAction } from './game-flow.js';
import { normalizeRouletteAction, getRouletteHelp } from './roulette-actions.js';
import { endpointOf, resolveRouletteFlow, senderRolesOf, type RouletteCapabilityContext } from './runtime.js';

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
  if (action === 'help') return getRouletteHelp(messageFromCommandInput(input, context));
  const flow = resolveRouletteFlow(context);
  const actor = {
    message: messageFromCommandInput(input, context),
    endpoint: endpointOf(input),
    roles: senderRolesOf(input),
  };
  return runRouletteAction(flow, actor, action);
}
