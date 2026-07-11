/**
 * agentLoop turn runner (ADR 0009) — types + Promise collectors over AgentCore.run SSOT.
 */

export type {
  AgentLoopTurnInput,
  AgentLoopTurnResult,
  AgentLoopVisionTurnInput,
  AgentLoopVisionTurnResult,
} from './agent-core-run.js';

import { collectAgentLoopTurnRun, runAgentLoopTextTurnRun, runAgentLoopVisionTurnRun, type AgentLoopTurnInput, type AgentLoopTurnResult, type AgentLoopVisionTurnInput, type AgentLoopVisionTurnResult } from './agent-core-run.js';

export async function runAgentLoopTextTurn(input: AgentLoopTurnInput): Promise<AgentLoopTurnResult> {
  if (input.core) {
    return input.core.runTextTurn(input);
  }
  return collectAgentLoopTurnRun(runAgentLoopTextTurnRun(input));
}

export async function runAgentLoopVisionTurn(
  input: AgentLoopVisionTurnInput,
): Promise<AgentLoopVisionTurnResult> {
  if (input.core) {
    return input.core.runVisionTurn(input);
  }
  return collectAgentLoopTurnRun(runAgentLoopVisionTurnRun(input));
}
