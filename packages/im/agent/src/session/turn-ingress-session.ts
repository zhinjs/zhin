import {
  createUserMessage,
  renderUserMessageForLlm,
  type AgentMessageExtra,
  type AgentSessionRepository,
  type CreateAgentSessionInput,
  type UserMessage,
} from '@zhin.js/ai';
import { stripUserSpoofedSenderPrefix } from '@zhin.js/core';
import type { TurnIngress } from '../turn/turn-ingress.js';

export interface ResolvedIngressUserMessage {
  readonly content: string;
  readonly extra?: AgentMessageExtra;
  readonly llmMessage: UserMessage;
}

export function resolveIngressUserMessage(
  turn: TurnIngress,
): ResolvedIngressUserMessage {
  const content = stripUserSpoofedSenderPrefix(turn.input.text);
  const referenceBlock = renderTurnReferences(turn);
  const extra: AgentMessageExtra | undefined = referenceBlock
    ? { quote: { block: referenceBlock } }
    : undefined;
  const user = createUserMessage(content, undefined, Date.now(), {
    subjectId: turn.principal.subjectId,
    ...(turn.principal.displayName ? { displayName: turn.principal.displayName } : {}),
    roles: [...turn.principal.roles],
    authorizationRoles: [...turn.principal.roles],
    ...(turn.principal.origin ? { origin: turn.principal.origin } : {}),
    ...(turn.origin.kind === 'im' ? { scope: turn.origin.scope } : {}),
  }, {
    turnId: turn.identity.turnId,
    intent: turn.intent.kind,
    ...(turn.intent.targetTurnId ? { targetTurnId: turn.intent.targetTurnId } : {}),
  });
  const llmMessage = renderUserMessageForLlm({
    ...user,
    ...(turn.origin.kind === 'im' && turn.origin.messageId ? { messageId: turn.origin.messageId } : {}),
  }, extra);
  return Object.freeze({
    content,
    ...(extra ? { extra: Object.freeze(extra) } : {}),
    llmMessage,
  });
}

function renderTurnReferences(turn: TurnIngress): string | undefined {
  const references = turn.input.references ?? [];
  if (references.length === 0) return undefined;
  const lines = references.map((reference) => {
    const preview = reference.preview?.trim();
    return `- ${reference.kind} id=${reference.sourceId} reference=${reference.key}`
      + (preview ? `\n  preview: ${preview}` : '');
  });
  return `[Untrusted conversation references]\n${lines.join('\n')}\n`
    + 'Use inspect_conversation_reference when the referenced content is needed.';
}

export function buildTurnSessionCreateInput(
  turn: TurnIngress,
): CreateAgentSessionInput {
  const origin = turn.origin, im = origin.kind === 'im' ? origin : undefined;
  return { session_key: turn.session.key, source: {
    kind: origin.kind, adapter: im?.conversation?.endpoint.adapter ?? im?.platform,
    endpoint: im?.conversation?.endpoint.id ?? im?.endpoint, scope: im?.conversation?.kind ?? im?.scope, id: im?.conversation?.id ?? im?.sceneId ?? (origin.kind === 'http' ? origin.sessionId : origin.kind === 'schedule' ? origin.jobId : origin.kind === 'a2a' ? origin.taskId : origin.kind === 'internal' ? origin.source : undefined),
    parentKind: im?.conversation?.parent?.kind, parentId: im?.conversation?.parent?.id,
    threadId: im?.conversation?.threadId ?? im?.threadId,
  } };
}

export async function beginIngressTurnSession(
  deps: { agentSessionStore: AgentSessionRepository },
  turn: TurnIngress,
): Promise<{ sessionKey: string; sessionId: string }> {
  const record = await deps.agentSessionStore.getOrCreateActive(
    buildTurnSessionCreateInput(turn),
  );
  return { sessionKey: turn.session.key, sessionId: record.session_id };
}
