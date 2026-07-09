import { randomUUID } from 'node:crypto';
import { resolveIMSessionIdFromMessage } from '@zhin.js/core';
import type { OutputElement } from '@zhin.js/ai';
import type { Message, Tool } from '../orchestrator/types.js';
import type { TurnEvent } from '../event/turn-event.js';
import type { InboundTurnQueue } from '../turn/inbound-turn-queue.js';
import type { ResolvedInboundQueueConfig } from '../turn/inbound-queue-config.js';
import { runWithInboundQueue } from '../turn/inbound-queue-runtime.js';
import { processTextTurn } from './turn-pipeline.js';
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

  yield { type: 'turn_start', sessionId, turnId };

  const eventQueue: TurnEvent[] = [];
  let resolveWaiting: (() => void) | undefined;
  let done = false;
  let sawTurnEnd = false;
  let finalOutput: OutputElement[] = [];
  let finalError: Error | undefined;

  const onTurnEvent = (event: TurnEvent) => {
    if (event.type === 'turn_end') sawTurnEnd = true;
    eventQueue.push(event);
    resolveWaiting?.();
  };

  const runPromise = runInTurnContext(turnId, () =>
    runWithInboundQueue(commMessage, inboundQueueConfig, inboundTurnQueue, {
      content,
      run: (mergedContent) =>
        processTextTurn(agent, mergedContent, commMessage, externalTools, undefined, { onTurnEvent }),
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

  if (finalError) {
    yield { type: 'error', error: finalError, recoverable: false };
  } else if (!sawTurnEnd) {
    yield {
      type: 'turn_end',
      output: finalOutput,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  await runPromise.catch(() => {});
}
