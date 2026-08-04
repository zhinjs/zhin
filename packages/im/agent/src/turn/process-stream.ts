import { randomUUID } from 'node:crypto';
import { resolveIMSessionIdFromMessage } from '@zhin.js/core';
import type { OutputElement } from '@zhin.js/ai';
import { AgentRunJournal } from '@zhin.js/ai/agent-stream';
import type { Message, Tool } from '../orchestrator/types.js';
import type { TurnEvent } from '../event/turn-event.js';
import { publishTurnStreamEvents } from '../event/publish-agent-stream.js';
import { readHttpSessionId } from '../session/resolve-session-interaction-port.js';
import type { InboundTurnQueue } from '../turn/inbound-turn-queue.js';
import type { ResolvedInboundQueueConfig } from '../turn/inbound-queue-config.js';
import { runWithInboundQueue } from '../turn/inbound-queue-runtime.js';
import { processTextTurn } from './turn-pipeline.js';
import { TurnTerminalGate, isTurnCancellation, turnCancelledEvent } from './turn-terminal.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';

export async function* processTextTurnStream(
  agent: ZhinAgentPrivate,
  opts: {
    content: string;
    commMessage: Message;
    externalTools: Tool[];
    inboundQueueConfig: ResolvedInboundQueueConfig;
    inboundTurnQueue: InboundTurnQueue;
    runInTurnContext: <T>(turnId: string, fn: () => Promise<T>) => Promise<T>;
  },
): AsyncGenerator<TurnEvent, void, undefined> {
  const { content, commMessage, externalTools, inboundQueueConfig, inboundTurnQueue, runInTurnContext } = opts;
  const turnId = randomUUID();
  const sessionId = resolveIMSessionIdFromMessage(commMessage);

  const streamCtx = () => ({
    sessionId,
    turnId,
    httpSessionId: readHttpSessionId(commMessage),
  });
  const journal = new AgentRunJournal({ sessionId, turnId });

  const turnStart: TurnEvent = { type: 'turn_start', sessionId, turnId };
  yield turnStart;
  publishTurnStreamEvents(agent, turnStart, streamCtx(), journal);

  const eventQueue: TurnEvent[] = [];
  let resolveWaiting: (() => void) | undefined;
  let done = false;
  const terminal = new TurnTerminalGate();
  let finalOutput: OutputElement[] = [];
  let finalError: Error | undefined;

  const onTurnEvent = (event: TurnEvent) => {
    if (!terminal.accept(event)) return;
    eventQueue.push(event);
    publishTurnStreamEvents(agent, event, streamCtx(), journal);
    resolveWaiting?.();
  };

  const runPromise = runInTurnContext(turnId, () =>
    runWithInboundQueue(commMessage, inboundQueueConfig, inboundTurnQueue, {
      content,
      run: (mergedContent) =>
        processTextTurn(agent, mergedContent, commMessage, externalTools, undefined, { onTurnEvent, journal }),
    }),
  ).then((output) => {
    finalOutput = output;
    done = true;
    resolveWaiting?.();
  }).catch((err) => {
    finalError = err instanceof Error ? err : new Error(String(err));
    done = true;
    resolveWaiting?.();
  });

  while (!done || eventQueue.length > 0) {
    if (eventQueue.length > 0) {
      yield eventQueue.shift()!;
      continue;
    }
    if (!done) {
      await new Promise<void>((resolve) => { resolveWaiting = resolve; });
      resolveWaiting = undefined;
    }
  }

  if (!terminal.terminal && finalError) {
    const terminalEvent: TurnEvent = isTurnCancellation(finalError)
      ? turnCancelledEvent(finalError)
      : { type: 'error', error: finalError, recoverable: false };
    terminal.accept(terminalEvent);
    publishTurnStreamEvents(agent, terminalEvent, streamCtx(), journal);
    yield terminalEvent;
  } else if (!terminal.terminal) {
    const syntheticEnd: TurnEvent = {
      type: 'turn_end',
      output: finalOutput,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
    if (terminal.accept(syntheticEnd)) {
      publishTurnStreamEvents(agent, syntheticEnd, streamCtx(), journal);
      yield syntheticEnd;
    }
  }

  await runPromise.catch(() => {});
}
