/**
 * #1250 `confirm-every-step-no-batch`: within one turn, a confirmed high-risk call covers later calls of
 * the same initiator, the same tool, the same high-risk category and the same target, and only while no
 * new kind of recorded source reached the model since that answer. A different tool, target, category or
 * initiator, a newly recorded source, and every new turn, ask again.
 *
 * Only config / schedule calls are batched by target (the object they change, such as a job id or a
 * config key). A shell command, a file write and a message to another conversation are batched only by
 * the whole call (every argument the same), because their other arguments (the command, the content,
 * the text) are what was confirmed.
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

/** Categories whose calls are batched by target; every other category only by the whole call. */
const TARGET_BATCHED_KINDS: ReadonlySet<HighRiskActionKind> = new Set(['config', 'schedule']);

/**
 * Argument names that identify what a config / schedule call acts on (a job, a key). Only the ones the
 * tool's own input schema declares count, so the model cannot make two calls share a target by adding
 * an argument the tool does not have.
 */
const TARGET_ARGUMENTS: ReadonlySet<string> = new Set([
  'id', 'job_id', 'jobId', 'task_id', 'taskId',
  'target', 'target_id', 'targetId',
  'conversation', 'conversation_id', 'conversationId', 'scene_id', 'sceneId',
  'group_id', 'groupId', 'channel_id', 'channelId', 'user_id', 'userId',
  'path', 'file_path', 'filePath', 'key',
]);

/**
 * Declared arguments that may also name what a call acts on but are not in `TARGET_ARGUMENTS` (lists of
 * ids, addresses, recipients, names). A tool that declares one is batched only by the whole call, since
 * two calls on the same `id` could still act on different objects through it. Compared after removing
 * `_` / `-` and lower-casing.
 */
const OTHER_IDENTIFYING_ARGUMENTS: ReadonlySet<string> = new Set([
  'ids', 'jobids', 'taskids', 'paths', 'filepaths', 'files', 'file', 'targets', 'targetids', 'keys',
  'url', 'urls', 'uri', 'uris', 'href', 'link', 'endpoint', 'endpointid', 'host', 'server',
  'to', 'cc', 'bcc', 'recipient', 'recipients', 'receiver', 'receivers', 'dest', 'destination', 'destinations',
  'address', 'addresses', 'email', 'emails', 'phone', 'account', 'accountid',
  'name', 'names', 'username', 'scope', 'session', 'sessionid', 'sessionkey',
  'chat', 'chatid', 'chatids', 'room', 'roomid', 'thread', 'threadid', 'group', 'groupids', 'channel', 'channelids',
  'user', 'users', 'userids', 'member', 'members', 'memberid', 'memberids', 'scene', 'sceneids',
  'conversations', 'conversationids', 'plugin', 'pluginid', 'plugins', 'namespace', 'section', 'item', 'items',
]);

type ToolView = Readonly<{ name: string; owner: string; mcpServer?: string; inputSchema?: unknown }>;

/**
 * The target of one call of category `kind`. For config / schedule, when the tool declares identifying
 * arguments (all of them primitive, none of them array-typed, and no other identifying argument
 * declared), the target is the owning plugin, the MCP server (if any), the tool and those values:
 * later calls of that tool on the same object share it. Otherwise (and always for shell, outbound and
 * file_write) it is the tool plus every argument, so only an identical call shares it.
 */
export function highRiskConfirmationTarget(
  tool: ToolView,
  kind: HighRiskActionKind,
  input: Readonly<Record<string, unknown>>,
): string {
  const exactCall = `call:${JSON.stringify([tool.owner, tool.mcpServer ?? null, tool.name, stableValue(input)])}`;
  if (!TARGET_BATCHED_KINDS.has(kind)) return exactCall;
  const declared = declaredArguments(tool.inputSchema);
  for (const [name, schema] of declared) {
    if (OTHER_IDENTIFYING_ARGUMENTS.has(name.replace(/[_-]/gu, '').toLowerCase())) return exactCall;
    if (TARGET_ARGUMENTS.has(name) && declaresArray(schema)) return exactCall;
  }
  const identifying = [...TARGET_ARGUMENTS].filter(name => declared.has(name) && input[name] !== undefined);
  if (!identifying.length || !identifying.every(name => isPrimitive(input[name]))) return exactCall;
  return `target:${JSON.stringify([tool.owner, tool.mcpServer ?? null, tool.name, ...identifying.map(name => [name, input[name]])])}`;
}

/** Confirmations given in one turn; owned by that turn's tool runtime. */
export class TurnHighRiskConfirmations {
  readonly #confirmed = new Map<string, Readonly<{ authority: HighRiskConfirmationAuthority; sources: ReadonlySet<string> }>>();

  /**
   * What an earlier confirmation of the same turn, initiator, category and target settled, if any.
   * `sources`: the keys of the sources recorded in the turn now (`TurnProvenance.sourceKeys`). A source
   * that was not recorded when the answer was given voids it: the call asks again.
   */
  covering(key: HighRiskConfirmationKey, sources: readonly string[]): HighRiskConfirmationAuthority | undefined {
    const entry = this.#confirmed.get(confirmationKey(key));
    return entry && sources.every(source => entry.sources.has(source)) ? entry.authority : undefined;
  }

  /**
   * Records an approved confirmation given while `sources` were recorded. A weaker answer never
   * replaces a stronger one that still covers these sources; a voided record is replaced.
   */
  record(key: HighRiskConfirmationKey, authority: HighRiskConfirmationAuthority, sources: readonly string[]): void {
    const id = confirmationKey(key);
    const existing = this.#confirmed.get(id);
    if (existing && sources.every(source => existing.sources.has(source))
      && AUTHORITY_RANK[existing.authority] >= AUTHORITY_RANK[authority]) return;
    this.#confirmed.set(id, Object.freeze({ authority, sources: new Set(sources) }));
  }
}

export type HighRiskConfirmationKey = Readonly<{
  turnId: string;
  requesterId: string;
  kind: HighRiskActionKind;
  /** `highRiskConfirmationTarget`: it includes the tool, so another tool never shares a record. */
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

function declaredArguments(schema: unknown): ReadonlyMap<string, unknown> {
  if (!schema || typeof schema !== 'object') return new Map();
  const properties = (schema as { properties?: unknown }).properties;
  return properties && typeof properties === 'object' ? new Map(Object.entries(properties)) : new Map();
}

/** Whether an argument schema allows an array (`type: 'array'`, a type list with it, or `items`). */
function declaresArray(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return false;
  const record = schema as { type?: unknown; items?: unknown; anyOf?: unknown; oneOf?: unknown };
  if (record.type === 'array' || (Array.isArray(record.type) && record.type.includes('array')) || record.items !== undefined) return true;
  return [record.anyOf, record.oneOf].some(list => Array.isArray(list) && list.some(declaresArray));
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
