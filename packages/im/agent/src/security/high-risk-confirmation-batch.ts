/**
 * #1250 `confirm-every-step-no-batch`: within one turn, a confirmed high-risk call covers later calls of
 * the same initiator, the same tool, the same high-risk category and the same target, and only while no
 * new source and no further external content reached the model since that answer (a second page read by
 * the same tool counts). A different tool, target, category or initiator, a newly recorded source or
 * external content, and every new turn, ask again.
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
 * Argument names that identify what a config / schedule call acts on (a job, a key), compared after
 * removing `_` / `-` and lower-casing (`job_id`, `jobId` and `JobID` are the same name). Only the ones
 * the tool's own input schema declares count, so the model cannot make two calls share a target by
 * adding an argument the tool does not have.
 */
const TARGET_ARGUMENTS: ReadonlySet<string> = new Set([
  'id', 'jobid', 'taskid',
  'target', 'targetid',
  'conversation', 'conversationid', 'sceneid',
  'groupid', 'channelid', 'userid',
  'path', 'filepath', 'key',
]);

/**
 * #1250: the declared arguments that only carry the new value of the target (read from the Host's
 * `schedule_update` and the config / schedule tools: a cron, a label, a value), compared like
 * `TARGET_ARGUMENTS`. A tool is batched by target only when every argument it declares is one target
 * argument or one of these: any other argument (a `field`, a `slug`, an `index`, ...) might pick another
 * object under the same id, so such a tool is batched only by the whole call. Free text that the job
 * or setting runs or shows (`prompt`, `description`) is not listed: a confirmed label or cron change
 * must not cover a later rewrite of what the job does.
 */
const VALUE_ARGUMENTS: ReadonlySet<string> = new Set([
  'cron', 'schedulekind', 'delayminutes', 'label', 'enabled', 'value',
]);

type ToolView = Readonly<{ name: string; owner: string; mcpServer?: string; inputSchema?: unknown }>;

/**
 * The target of one call of category `kind`. For config / schedule, when the tool declares exactly one
 * target argument with a plain primitive type, every other declared argument is a known value argument,
 * the call passes only declared arguments and gives the target a primitive value, the target is the
 * owning plugin, the MCP server (if any), the tool and that value: later calls of that tool on the same
 * object share it. Otherwise (and always for shell, outbound and file_write) it is the tool plus every
 * argument, so only an identical call shares it.
 */
export function highRiskConfirmationTarget(
  tool: ToolView,
  kind: HighRiskActionKind,
  input: Readonly<Record<string, unknown>>,
): string {
  const exactCall = `call:${JSON.stringify([tool.owner, tool.mcpServer ?? null, tool.name, stableValue(input)])}`;
  if (!TARGET_BATCHED_KINDS.has(kind)) return exactCall;
  const declared = declaredArguments(tool.inputSchema);
  const identifying: string[] = [];
  for (const name of declared.keys()) {
    const normalized = normalizeArgumentName(name);
    if (TARGET_ARGUMENTS.has(normalized)) identifying.push(name);
    else if (!VALUE_ARGUMENTS.has(normalized)) return exactCall;
  }
  if (identifying.length !== 1) return exactCall;
  const target = identifying[0]!;
  if (!declaresPlainPrimitive(declared.get(target))) return exactCall;
  if (Object.keys(input).some(name => !declared.has(name))) return exactCall;
  const value = input[target];
  if (!isPrimitive(value)) return exactCall;
  return `target:${JSON.stringify([tool.owner, tool.mcpServer ?? null, tool.name, target, value])}`;
}

/**
 * What the turn had recorded when a confirmation was given or a call is checked: the source keys
 * (`TurnProvenance.sourceKeys`) and the external content count (`TurnProvenance.contentEntries`).
 */
export type HighRiskConfirmationSources = Readonly<{ keys: readonly string[]; contentEntries: number }>;

/** Confirmations given in one turn; owned by that turn's tool runtime. */
export class TurnHighRiskConfirmations {
  readonly #confirmed = new Map<string, Readonly<{
    authority: HighRiskConfirmationAuthority;
    sources: ReadonlySet<string>;
    contentEntries: number;
  }>>();

  /**
   * What an earlier confirmation of the same turn, initiator, category and target settled, if any.
   * A source key that was not recorded when the answer was given, or any external content that entered
   * the turn after it (another page of the same tool included), voids it: the call asks again.
   */
  covering(key: HighRiskConfirmationKey, sources: HighRiskConfirmationSources): HighRiskConfirmationAuthority | undefined {
    const entry = this.#confirmed.get(confirmationKey(key));
    return entry && covers(entry, sources) ? entry.authority : undefined;
  }

  /**
   * Records an approved confirmation given while `sources` were recorded. A weaker answer never
   * replaces a stronger one that still covers these sources; a voided record is replaced.
   */
  record(key: HighRiskConfirmationKey, authority: HighRiskConfirmationAuthority, sources: HighRiskConfirmationSources): void {
    const id = confirmationKey(key);
    const existing = this.#confirmed.get(id);
    if (existing && covers(existing, sources) && AUTHORITY_RANK[existing.authority] >= AUTHORITY_RANK[authority]) return;
    this.#confirmed.set(id, Object.freeze({ authority, sources: new Set(sources.keys), contentEntries: sources.contentEntries }));
  }
}

function covers(
  entry: Readonly<{ sources: ReadonlySet<string>; contentEntries: number }>,
  sources: HighRiskConfirmationSources,
): boolean {
  return sources.contentEntries === entry.contentEntries && sources.keys.every(source => entry.sources.has(source));
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

function normalizeArgumentName(name: string): string {
  return name.replace(/[_-]/gu, '').toLowerCase();
}

/**
 * Whether an argument schema is one plain primitive type (`string`, `number`, `integer`): no type list,
 * array, object, `$ref`, or combination (`anyOf` / `oneOf` / `allOf` / `not`), which might let one
 * value stand for several objects.
 */
function declaresPlainPrimitive(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return false;
  const record = schema as Record<string, unknown>;
  if (['$ref', 'items', 'properties', 'anyOf', 'oneOf', 'allOf', 'not', 'additionalProperties', 'prefixItems']
    .some(keyword => record[keyword] !== undefined)) return false;
  return record.type === 'string' || record.type === 'number' || record.type === 'integer';
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
