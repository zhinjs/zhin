/**
 * #1250 `confirm-every-step-no-batch`: within one turn, a confirmed high-risk call covers later calls of
 * the same initiator, the same high-risk category and the same target, so one task is confirmed once
 * instead of once per step. A different target, category or initiator, and every new turn, asks again.
 *
 * The record lives in the memory of one turn's tool runtime only: it is never persisted, never shared
 * between turns or sessions, and never covers more authority than the answer that created it.
 */
import type { HighRiskActionKind } from './provenance.js';

/**
 * Who settled a confirmation. `intent`: only the initiator confirmed their intent (no authority);
 * `admin`: an answer that an admin may give (the request allowed `adminMayApprove`); `owner`: the
 * request required the bot owner.
 */
export type HighRiskConfirmationAuthority = 'intent' | 'admin' | 'owner';

const AUTHORITY_RANK: Readonly<Record<HighRiskConfirmationAuthority, number>> = Object.freeze({ intent: 0, admin: 1, owner: 2 });

/**
 * Argument names that identify what a call acts on (a job, a conversation, a file, a key). Only the
 * ones the tool's own input schema declares count, so the model cannot make two calls share a target
 * by adding an argument the tool does not have.
 */
const TARGET_ARGUMENTS: readonly string[] = Object.freeze([
  'id', 'job_id', 'jobId', 'task_id', 'taskId',
  'target', 'target_id', 'targetId',
  'conversation', 'conversation_id', 'conversationId', 'scene_id', 'sceneId',
  'group_id', 'groupId', 'channel_id', 'channelId', 'user_id', 'userId',
  'path', 'file_path', 'filePath', 'key',
]);

type ToolView = Readonly<{ name: string; owner: string; inputSchema?: unknown }>;

/**
 * The target of one call. With identifying arguments the tool declares (all of them primitives), the
 * target is the owning plugin plus those values: calls of that plugin on the same object share it.
 * Otherwise it is the tool name plus every argument, so only an identical call shares it.
 */
export function highRiskConfirmationTarget(tool: ToolView, input: Readonly<Record<string, unknown>>): string {
  const declared = declaredArguments(tool.inputSchema);
  const identifying = TARGET_ARGUMENTS.filter(name => declared.has(name) && input[name] !== undefined);
  if (identifying.length && identifying.every(name => isPrimitive(input[name]))) {
    return `plugin:${JSON.stringify([tool.owner, ...identifying.map(name => [name, input[name]])])}`;
  }
  return `call:${JSON.stringify([tool.name, stableValue(input)])}`;
}

/** Confirmations given in one turn; owned by that turn's tool runtime. */
export class TurnHighRiskConfirmations {
  readonly #confirmed = new Map<string, HighRiskConfirmationAuthority>();

  /** What an earlier confirmation of the same turn, initiator, category and target settled, if any. */
  covering(key: HighRiskConfirmationKey): HighRiskConfirmationAuthority | undefined {
    return this.#confirmed.get(confirmationKey(key));
  }

  /** Records an approved confirmation; a weaker answer never replaces a stronger one. */
  record(key: HighRiskConfirmationKey, authority: HighRiskConfirmationAuthority): void {
    const id = confirmationKey(key);
    const existing = this.#confirmed.get(id);
    if (existing === undefined || AUTHORITY_RANK[authority] > AUTHORITY_RANK[existing]) this.#confirmed.set(id, authority);
  }
}

export type HighRiskConfirmationKey = Readonly<{
  turnId: string;
  requesterId: string;
  kind: HighRiskActionKind;
  target: string;
}>;

/** Whether a recorded answer also settles an authorization that needs `needed`. */
export function confirmationCoversAuthority(
  recorded: HighRiskConfirmationAuthority,
  needed: Exclude<HighRiskConfirmationAuthority, 'intent'>,
): boolean {
  return recorded !== 'intent' && AUTHORITY_RANK[recorded] >= AUTHORITY_RANK[needed];
}

function confirmationKey(key: HighRiskConfirmationKey): string {
  return JSON.stringify([key.turnId, key.requesterId, key.kind, key.target]);
}

function declaredArguments(schema: unknown): ReadonlySet<string> {
  if (!schema || typeof schema !== 'object') return new Set();
  const properties = (schema as { properties?: unknown }).properties;
  return properties && typeof properties === 'object' ? new Set(Object.keys(properties)) : new Set();
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean';
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value === undefined ? null : value;
}
