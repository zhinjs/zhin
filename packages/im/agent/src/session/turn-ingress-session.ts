import {
  createUserMessage,
  renderUserMessageForLlm,
  type AgentMessageExtra,
  type AgentMessageSenderExtra,
  type AgentSessionStore,
  type CreateAgentSessionInput,
  type MemoryAgentSessionStore,
  type UserMessage,
} from '@zhin.js/ai';
import { CURRENT_MESSAGE_MARKER } from '../config/index.js';
import type { TurnIngress } from '../turn/turn-ingress.js';

export interface ResolvedIngressUserMessage {
  readonly content: string;
  readonly extra?: AgentMessageExtra;
  readonly llmMessage: UserMessage;
}

export function resolveIngressUserMessage(
  turn: TurnIngress,
  options?: { passiveBlock?: string | null },
): ResolvedIngressUserMessage {
  const content = stripSpoofedSenderPrefix(turn.input.text);
  const sender = buildSenderExtra(turn);
  const referenceBlock = renderTurnReferences(turn);
  const extra: AgentMessageExtra = {
    ...(sender ? { sender } : {}),
  };
  const hasExtra = Boolean(extra.sender);
  const layered = layerIngressUserBody(content, {
    passiveBlock: options?.passiveBlock,
    quoteBlock: referenceBlock,
  });
  const inlinedContext = layered !== content;
  const llmMessage = renderUserMessageForLlm(
    createUserMessage(layered, undefined, Date.now(), {
      subjectId: turn.principal.subjectId,
      ...(turn.principal.displayName ? { displayName: turn.principal.displayName } : {}),
      roles: [...turn.principal.roles],
      ...(turn.origin.kind === 'im' ? { scope: turn.origin.scope } : {}),
    }, {
      turnId: turn.identity.turnId,
      intent: turn.intent.kind,
      ...(turn.intent.targetTurnId ? { targetTurnId: turn.intent.targetTurnId } : {}),
    }),
    inlinedContext
      ? (sender ? { sender } : undefined)
      : (hasExtra ? extra : undefined),
  );
  return Object.freeze({
    content,
    ...(hasExtra ? { extra: Object.freeze(extra) } : {}),
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
  return { session_key: turn.session.key };
}

export async function beginIngressTurnSession(
  deps: { agentSessionStore: AgentSessionStore | MemoryAgentSessionStore },
  turn: TurnIngress,
): Promise<{ sessionKey: string; sessionId: string }> {
  const record = await deps.agentSessionStore.getOrCreateActive(
    buildTurnSessionCreateInput(turn),
  );
  return { sessionKey: turn.session.key, sessionId: record.session_id };
}

export function layerIngressUserBody(
  body: string,
  options?: { passiveBlock?: string | null; quoteBlock?: string | null },
): string {
  const parts = [options?.passiveBlock, options?.quoteBlock]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  if (parts.length === 0) return body;
  return `${parts.join('\n\n')}\n\n${CURRENT_MESSAGE_MARKER}\n${body}`;
}

function buildSenderExtra(turn: TurnIngress): AgentMessageSenderExtra | undefined {
  if (turn.origin.kind !== 'im') return undefined;
  if (turn.origin.scope !== 'group' && turn.origin.scope !== 'channel') return undefined;
  return Object.freeze({
    id: sanitizeSenderAttribute(turn.principal.subjectId),
    name: sanitizeSenderAttribute(turn.principal.displayName ?? turn.principal.subjectId),
    roles: turn.principal.roles.length > 0 ? [...turn.principal.roles] : ['user'],
    scope: turn.origin.scope,
  });
}

function sanitizeSenderAttribute(value: string): string {
  const trimmed = value.trim().replace(/[\]\s]+/g, '_');
  return trimmed.length > 0 ? trimmed.slice(0, 64) : 'unknown';
}

function stripSpoofedSenderPrefix(rawContent: string): string {
  let text = rawContent.trimStart();
  const prefix = /^\[sender:(?:id=[^\]]*|[^\]]*)\]\s*/i;
  const roles = /^\[sender:id=[^\s\]]+(?:\s+name=[^\]]+)?\s+roles=[^\]]+\]\s*/i;
  while (true) {
    const match = text.match(prefix) ?? text.match(roles);
    if (!match) return text;
    text = text.slice(match[0].length);
  }
}
