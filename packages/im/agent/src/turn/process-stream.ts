import { randomUUID } from 'node:crypto';
import { resolveIMSessionIdFromMessage } from '@zhin.js/core';
import { AgentRunJournal } from '@zhin.js/ai/agent-stream';
import type { Message, Tool } from '../resource-hub/types.js';
import type { TurnEvent } from '../event/turn-event.js';
import { publishTurnStreamEvents } from '../event/publish-agent-stream.js';
import type { HostMailbox } from '../collaboration/host-mailbox.js';
import type { ZhinAgentEventEmitter } from '../event/event-emitter.js';
import { runAsMailTurn } from './mail-turn-runtime.js';
import { processTextTurn } from './turn-pipeline.js';
import { isTurnCancellation, turnCancelledEvent } from './turn-terminal.js';
import { streamTurnEvents } from './turn-event-source.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';

export async function* processTextTurnStream(
  agent: ZhinAgentPrivate,
  opts: {
    content: string;
    commMessage: Message;
    externalTools: Tool[];
    hostMailbox: HostMailbox;
    emitter?: ZhinAgentEventEmitter;
    runInTurnContext: <T>(turnId: string, fn: () => Promise<T>) => Promise<T>;
  },
): AsyncGenerator<TurnEvent, void, undefined> {
  const { content, commMessage, externalTools, hostMailbox, emitter, runInTurnContext } = opts;
  const turnId = randomUUID();
  const sessionId = resolveIMSessionIdFromMessage(commMessage);

  const streamCtx = () => ({
    sessionId,
    turnId,
  });
  const journal = new AgentRunJournal({ sessionId, turnId });

  const turnStart: TurnEvent = { type: 'turn_start', sessionId, turnId };
  yield turnStart;
  publishTurnStreamEvents(agent, turnStart, streamCtx(), journal);

  const source = streamTurnEvents({
    execute: (emit) => runInTurnContext(turnId, () =>
      runAsMailTurn(hostMailbox, commMessage, {
        content,
        ...(emitter ? { emitter } : {}),
        run: (mergedContent, signal) =>
          processTextTurn(agent, mergedContent, commMessage, externalTools, undefined, {
            signal,
            onTurnEvent: emit,
            journal,
          }),
        merged: () => [],
      })),
    mapError: (error) => isTurnCancellation(error)
      ? turnCancelledEvent(error)
      : {
          type: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
          recoverable: false,
        },
  });

  for await (const event of source) {
    publishTurnStreamEvents(agent, event, streamCtx(), journal);
    yield event;
  }
}
