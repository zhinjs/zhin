import { createHash } from 'node:crypto';
import type { AssistantMessage, ProviderStateScope, AgentMessage } from '../llm/types/agent-message.js';
import type { Context } from '../llm/types/context.js';
import type { ExecutionBinding, ProviderCallContext } from './types.js';

export function providerStateScope(input: Readonly<{ binding: ExecutionBinding; context: ProviderCallContext }>): ProviderStateScope {
  const { binding, context } = input;
  const sessionKey = createHash('sha256').update(JSON.stringify([
    context.rootId, context.ownerId, context.sessionKey ?? `operation:${context.operationId}`, context.epoch ?? null,
  ])).digest('hex');
  return Object.freeze({ serviceId: binding.service.id, accountId: binding.account.id,
    accountIncarnation: binding.account.incarnation, model: binding.model.id, protocol: binding.model.protocol,
    sessionKey, ...(context.epoch !== undefined ? { epoch: context.epoch } : {}) });
}
function sameScope(left: ProviderStateScope | undefined, right: ProviderStateScope): boolean {
  return !!left && left.serviceId === right.serviceId && left.accountId === right.accountId
    && left.accountIncarnation === right.accountIncarnation && left.model === right.model && left.protocol === right.protocol
    && left.sessionKey === right.sessionKey && left.epoch === right.epoch;
}
/** Preserve human-visible content/tool IDs while dropping unowned supplier-only state. */
export function projectProviderState(input: Readonly<{ context: Context; scope: ProviderStateScope }>): Context {
  const messages = input.context.messages.map((message): AgentMessage => {
    if (message.role !== 'assistant') return message;
    const assistant = message as AssistantMessage;
    if (sameScope(assistant.providerStateScope, input.scope)) return assistant;
    const { providerStateScope: _scope, ...rest } = assistant;
    return { ...rest, content: assistant.content.filter(block => block.type !== 'thinking').map(block => {
      if (!('providerOptions' in block)) return block;
      const { providerOptions: _options, ...content } = block;
      return content;
    }) };
  });
  return { ...input.context, messages };
}
export function stampProviderState(input: Readonly<{ message: AssistantMessage; scope: ProviderStateScope }>): AssistantMessage {
  return { ...input.message, providerStateScope: input.scope };
}
