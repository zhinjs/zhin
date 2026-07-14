import { parseOutput } from '@zhin.js/ai';
import { mergeToolOutboundElements } from '../media/media-tool-bridge.js';
import { logPhase } from '../internal/phase-trace.js';
import { EMPTY_USAGE } from './turn-metrics.js';
import type { AgentLoopTurnResult } from '../core/agent-loop-turn.js';
import type { ZhinAgentPrivate, OutputElement } from '../internal/agent-host.js';
import type { Message } from '@zhin.js/core';
import type { SessionSystem } from '../session/session-system.js';
import type { HostTurnPath } from '../internal/host-types.js';
import { TurnSupersededError } from './prompt-controller.js';

export type TurnPipelineMode = 'text' | 'multimodal';

export async function handleTurnSuperseded(
  host: ZhinAgentPrivate,
  sessionId: string,
  commMessage: Message,
  mode: TurnPipelineMode,
  err: TurnSupersededError,
): Promise<OutputElement[]> {
  if (mode === 'text') {
    logPhase(host.phaseConfig, 'turn.superseded', sessionId, { sessionKey: err.sessionKey });
  }
  host.emitter.emit('ai.typing.stop', host.emitter.createPayload(sessionId, commMessage, mode, {
    reason: 'superseded',
  }));
  await host.finalizeActiveTurn({ usage: EMPTY_USAGE, path: 'superseded' });
  return [];
}

export interface FinalizeTurnAfterLoopParams {
  host: ZhinAgentPrivate;
  sessionSystem: SessionSystem;
  sessionId: string;
  commMessage: Message;
  mode: TurnPipelineMode;
  loopResult: AgentLoopTurnResult;
  isNewSession: boolean;
  rawContent: string;
  reply: string;
  /** multimodal 可显式传 `multimodal`；text 默认用 loopResult.path */
  finishPath?: AgentLoopTurnResult['path'];
  filterMs?: string;
  startedAt?: number;
}

export async function finalizeTurnAfterAgentLoop(p: FinalizeTurnAfterLoopParams): Promise<void> {
  const reportPath = p.finishPath ?? p.loopResult.path;
  const finalizePath: HostTurnPath = reportPath;
  await p.host.emitter.dispatch('ai.response', p.host.emitter.createPayload(p.sessionId, p.commMessage, p.mode, {
    path: reportPath,
    model: p.loopResult.model,
    iterations: p.loopResult.iterations,
    reply: p.reply,
  }));
  await p.sessionSystem.touchAfterTurn(p.host, p.sessionId);
  if (p.isNewSession) {
    p.host.emitSessionNewEvent(p.sessionId, p.commMessage, p.mode, p.rawContent, p.reply);
  }
  await p.host.finalizeActiveTurn({
    usage: p.loopResult.usage,
    path: finalizePath,
    iterations: p.loopResult.iterations,
    model: p.loopResult.model,
    userInput: p.rawContent.trim() || undefined,
    thinking: p.loopResult.thinking,
    output: p.reply.trim() || undefined,
  });
  await p.host.emitter.dispatch('ai.processing.finish', p.host.emitter.createPayload(p.sessionId, p.commMessage, p.mode, {
    path: reportPath,
    model: p.loopResult.model,
    reply: p.reply,
  }));
  p.host.emitter.emit('ai.typing.stop', p.host.emitter.createPayload(p.sessionId, p.commMessage, p.mode, {
    reason: 'processing_complete',
  }));
  if (p.mode === 'text' && p.startedAt != null) {
    logPhase(p.host.phaseConfig, 'turn.end', p.sessionId, {
      path: reportPath,
      filter_ms: p.filterMs,
      total_ms: Math.round(performance.now() - p.startedAt),
    });
  }
}

export function buildTextTurnOutbound(reply: string, loopResult: AgentLoopTurnResult): OutputElement[] {
  const outbound = mergeToolOutboundElements(parseOutput(reply), loopResult.toolCalls);
  if (!reply.trim() && outbound.length === 0) return [];
  return outbound;
}
