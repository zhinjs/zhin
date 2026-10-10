import type { ToolExecutionContext } from '@zhin.js/tool';
import type { AgentDecisionRuntime } from './types.js';
import { rankDecisionCandidates } from './rank.js';

/** Supplied by the composition root from the operation's held generation. */
export type NativeSearchDecisionResolver = (context: ToolExecutionContext) => AgentDecisionRuntime | undefined;

export function resolveSearchDecision(
  resolveDecision: NativeSearchDecisionResolver | undefined,
  context: ToolExecutionContext,
): AgentDecisionRuntime | undefined {
  if (!resolveDecision) return undefined;
  // External processing of governed Assignment data requires separate authority.
  if (context.policy.unattended || context.principal.roles.includes('workroom_assignment')) return undefined;
  const runtime = resolveDecision(context);
  return runtime?.config.memory && runtime.config.memory.mode !== 'off' ? runtime : undefined;
}

/** Existing retrieval owns candidate visibility; decision can only reorder or remove hits. */
export async function rerankDecisionMatches<T>(
  runtime: AgentDecisionRuntime | undefined,
  query: string,
  matches: readonly T[],
  describe: (match: T) => string,
  limit: number,
  signal: AbortSignal,
): Promise<readonly T[]> {
  const ranking = await rankDecisionCandidates(runtime, 'memory', query,
    matches.map((match, index) => ({ name: `hit_${index}`, description: describe(match) })), signal);
  if (!ranking.applied) return matches.slice(0, limit);
  const byName = new Map(matches.map((match, index) => [`hit_${index}`, match]));
  return ranking.selectedNames.slice(0, limit).flatMap(name => {
    const match = byName.get(name);
    return match === undefined ? [] : [match];
  });
}
