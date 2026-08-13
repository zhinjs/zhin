import type { OutputElement, Usage } from '@zhin.js/ai';
import type { ApprovalPort } from '../session/session-interaction-port.js';
import type { PermissionSubject } from '@zhin.js/permission';
import type { ToolInvocationOrigin } from '@zhin.js/tool';

export type TurnScope = 'private' | 'group' | 'channel';

export type TurnOrigin = Exclude<ToolInvocationOrigin, Readonly<{ kind: 'mcp'; requestId: string }>>;

export interface TurnIdentity {
  readonly rootId: string;
  readonly generation: number;
  readonly traceId: string;
  readonly turnId: string;
}

export interface TurnPrincipal {
  readonly subjectId: string;
  readonly displayName?: string;
  readonly roles: readonly string[];
}

export interface TurnMedia {
  readonly kind: 'image' | 'audio' | 'video' | 'file';
  readonly source: Readonly<{
    kind: 'url' | 'path' | 'base64' | 'platform_ref';
    value: string;
  }>;
  readonly mimeType?: string;
  readonly name?: string;
}

export interface TurnInput {
  readonly text: string;
  readonly media?: readonly TurnMedia[];
  readonly quote?: Readonly<{ messageId?: string; text?: string }>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TurnSessionAddress {
  readonly key: string;
}

export interface TurnPolicyContext {
  readonly permissions: readonly string[];
  readonly unattended: boolean;
}

export interface FrozenCapabilityCatalog {
  readonly tools: readonly string[];
  readonly skills: readonly string[];
}

export type DeliveryOutcome =
  | Readonly<{ status: 'sent'; messageId?: string }>
  | Readonly<{ status: 'suppressed' }>
  | Readonly<{ status: 'unsupported'; code: string }>
  | Readonly<{ status: 'rejected'; code: string }>
  | Readonly<{ status: 'failed'; code: string; retryable: boolean }>;

export interface ReplyPort {
  send(output: readonly OutputElement[]): Promise<DeliveryOutcome>;
}

export interface ActivityPort {
  publish(event: Readonly<{ type: string; data?: unknown }>): void | Promise<void>;
}

export interface TurnJournalPort {
  append(event: import('../event/turn-event.js').TurnEvent): void | Promise<void>;
}

export interface DeliveryIntent {
  readonly intentId: string;
  readonly parentTurnId: string;
  readonly target: Readonly<Record<string, unknown>>;
  readonly output: readonly OutputElement[];
}

export interface DeliveryPort {
  deliver(intent: DeliveryIntent, signal: AbortSignal): Promise<DeliveryOutcome>;
}

export interface TurnPorts {
  readonly journal: TurnJournalPort;
  readonly reply?: ReplyPort;
  readonly approval?: ApprovalPort;
  readonly activity?: ActivityPort;
  readonly delivery?: DeliveryPort;
}

/** Ports supplied by an ingress adapter; Journal authority is injected by AgentRuntime. */
export type TurnRequestPorts = Omit<TurnPorts, 'journal'>;

export interface TurnIngress {
  readonly identity: Readonly<TurnIdentity>;
  readonly origin: TurnOrigin;
  readonly principal: Readonly<TurnPrincipal>;
  readonly input: Readonly<TurnInput>;
  readonly session: Readonly<TurnSessionAddress>;
  readonly policy: Readonly<TurnPolicyContext>;
  readonly capabilities: Readonly<FrozenCapabilityCatalog>;
  readonly signal: AbortSignal;
  readonly ports: Readonly<TurnPorts>;
}

export type TurnIngressInput = TurnIngress;

export interface TurnRequest {
  readonly identity: Readonly<{
    traceId: string;
    turnId: string;
  }>;
  readonly origin: TurnOrigin;
  readonly principal: Readonly<TurnPrincipal>;
  readonly input: Readonly<TurnInput>;
  readonly session: Readonly<TurnSessionAddress>;
  readonly policy: Readonly<TurnPolicyContext>;
  readonly signal: AbortSignal;
  readonly ports: Readonly<TurnRequestPorts>;
}

export type TurnAccessContext = Pick<TurnRequest, 'origin' | 'principal' | 'policy'>;

export type TurnOutcome =
  | Readonly<{ status: 'completed'; output: readonly OutputElement[]; usage: Usage }>
  | Readonly<{ status: 'failed'; error: Readonly<{ code: string; message: string; retryable: boolean }>; usage: Usage }>
  | Readonly<{ status: 'cancelled'; reason: string; usage: Usage }>
  | Readonly<{ status: 'budget_exceeded'; budget: string; usage: Usage }>;

export function createTurnIngress(input: TurnIngressInput): TurnIngress {
  requireText(input.identity.rootId, 'identity.rootId');
  requireText(input.identity.traceId, 'identity.traceId');
  requireText(input.identity.turnId, 'identity.turnId');
  if (!Number.isSafeInteger(input.identity.generation) || input.identity.generation < 0) {
    throw new TypeError('TurnIngress identity.generation must be a non-negative integer');
  }
  requireText(input.session.key, 'session.key');
  requireText(input.principal.subjectId, 'principal.subjectId');
  if (input.policy.unattended && (input.ports.reply || input.ports.approval)) {
    throw new TypeError('Unattended TurnIngress cannot expose reply or approval ports');
  }
  if (!input.ports.journal || typeof input.ports.journal.append !== 'function') {
    throw new TypeError('TurnIngress ports.journal is required');
  }
  if (!(input.signal instanceof AbortSignal)) {
    throw new TypeError('TurnIngress signal must be an AbortSignal');
  }

  return Object.freeze({
    identity: freezeData(input.identity),
    origin: freezeData(input.origin),
    principal: freezeData(input.principal),
    input: freezeData(input.input),
    session: freezeData(input.session),
    policy: freezeData(input.policy),
    capabilities: freezeData(input.capabilities),
    signal: input.signal,
    ports: Object.freeze({ ...input.ports }),
  });
}

export function turnPermissionSubject(turn: TurnAccessContext): PermissionSubject {
  const im = turn.origin.kind === 'im' ? turn.origin : undefined;
  return Object.freeze({
    ...(im ? { adapter: im.platform, endpoint: im.endpoint } : {}),
    ...(im ? { scene: Object.freeze({ id: im.sceneId, type: im.scope }) } : {}),
    sender: Object.freeze({
      id: turn.principal.subjectId,
      ...(turn.principal.displayName ? { name: turn.principal.displayName } : {}),
      role: turn.principal.roles,
      permissions: turn.policy.permissions,
    }),
  });
}

export function resolveTurnContextValue(turn: TurnIngress, key: string): unknown {
  const im = turn.origin.kind === 'im' ? turn.origin : undefined;
  switch (key) {
    case 'platform': return im?.platform;
    case 'endpointKey': return im?.endpoint;
    case 'messageId': return im?.messageId;
    case 'sceneId': return im?.sceneId;
    case 'senderId': return turn.principal.subjectId;
    case 'scope': return im?.scope;
    case 'sessionKey': return turn.session.key;
    case 'turnId': return turn.identity.turnId;
    case 'traceId': return turn.identity.traceId;
    default: return turn.input.metadata?.[key];
  }
}

function requireText(value: string, field: string): void {
  if (!value.trim()) throw new TypeError(`TurnIngress ${field} is required`);
}

function freezeData<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => freezeData(item))) as T;
  }
  if (!value || typeof value !== 'object') return value;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const result = Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, freezeData(item)]),
  );
  return Object.freeze(result) as T;
}
