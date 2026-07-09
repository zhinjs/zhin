import { randomUUID } from 'node:crypto';
import { resolveIMSessionIdFromMessage } from '@zhin.js/core';
import type { AgentMessage, ImageContent, OutputElement, UserMessage } from '@zhin.js/ai';
import type { Message } from '../orchestrator/types.js';
import type { Plugin } from '@zhin.js/core';
import { PromptAccessDeniedError } from './prompt-access.js';
import { resolveToolRequesterRole } from '../security/owner-approve-always-store.js';
import { normalizePromptMessages } from './prompt-input.js';
import { processTextTurn } from '../turn/turn-pipeline.js';
import type { OnChunkCallback } from '../config/index.js';
import type { PromptController } from '../turn/prompt-controller.js';
import type { ZhinAgentEventEmitter } from '../event/event-emitter.js';
import type { ZhinAgentPrivate } from '../internal/agent-host.js';

export function assertMasterForPromptControl(
  emitter: ZhinAgentEventEmitter,
  commMessage: Message,
): void {
  const plugin = emitter.getHostPlugin();
  if (!plugin) {
    throw new PromptAccessDeniedError('steer/followUp 需要有效的 master 上下文');
  }
  try {
    const role = resolveToolRequesterRole(plugin, commMessage);
    if (role !== 'master') {
      throw new PromptAccessDeniedError('steer/followUp 仅 master 可用');
    }
  } catch (error) {
    if (error instanceof PromptAccessDeniedError) throw error;
    throw new PromptAccessDeniedError('steer/followUp 需要有效的 master 上下文');
  }
}

export async function runPromptTurn(
  agent: ZhinAgentPrivate,
  input: string | AgentMessage | AgentMessage[],
  commMessage: Message,
  runInTurnContext: <T>(turnId: string, fn: () => Promise<T>) => Promise<T>,
  options?: { images?: ImageContent[]; onChunk?: OnChunkCallback },
): Promise<OutputElement[]> {
  const messages = normalizePromptMessages(input, options?.images);
  const text = messages
    .flatMap((message) => {
      if (message.role !== 'user') return [] as string[];
      const user = message as UserMessage;
      return user.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text);
    })
    .join('\n')
    .trim();
  return runInTurnContext(randomUUID(), () =>
    processTextTurn(agent, text, commMessage, [], options?.onChunk, {
      prebuiltMessages: messages,
    }),
  );
}

export function steerMessage(
  promptController: PromptController,
  emitter: ZhinAgentEventEmitter,
  message: AgentMessage,
  commMessage: Message,
): void {
  assertMasterForPromptControl(emitter, commMessage);
  const sessionKey = resolveIMSessionIdFromMessage(commMessage);
  promptController.steer(sessionKey, message);
}

export function followUpMessage(
  promptController: PromptController,
  emitter: ZhinAgentEventEmitter,
  message: AgentMessage,
  commMessage: Message,
): void {
  assertMasterForPromptControl(emitter, commMessage);
  const sessionKey = resolveIMSessionIdFromMessage(commMessage);
  promptController.followUp(sessionKey, message);
}
