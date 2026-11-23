/**
 * Provenance chain and high-risk action confirmation (#727, M3.3).
 *
 * A turn becomes "tainted" as soon as content from a lower-trust source
 * (tool results, web pages, files, sub-agent reports, background
 * conversation events) reaches the model. From then on a model-chosen
 * high-risk action — running a shell command, messaging another
 * conversation, changing configuration or scheduling a task — may have been
 * steered by that content, so it is always routed through the ApprovalPort,
 * even when the configured policy would allow it outright. The approval card
 * shows the chain of sources that led to the call.
 *
 * Unattended turns have no ApprovalPort, so such calls are denied there. A
 * live IM turn whose conversation has no approver with authority may still
 * ask the turn's own initiator to confirm their intent (#1250); that answer
 * never replaces an approval the call needs for other reasons.
 *
 * ADR 0067: each high-risk category has its own level (`confirmHighRisk`), and a first-party
 * plugin's read-only lookup is recorded as trusted output, which only `any_content` categories
 * count. MCP tools, web pages, files and stored memory are external content even when read-only.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { InitiatorTrustLevel } from './trust-level.js';
import { isFileWriteToolName, isOutboundToolName } from './trust-level.js';

/** ADR 0067 D2: the high-risk categories the provenance gate confirms. */
export type HighRiskActionKind = 'shell' | 'file_write' | 'outbound' | 'config' | 'schedule';

export const HIGH_RISK_ACTION_KINDS: readonly HighRiskActionKind[] = Object.freeze(
  ['shell', 'file_write', 'outbound', 'config', 'schedule'] as const,
);

/**
 * ADR 0067 D2: when a category asks first.
 * - `off`: never because of provenance;
 * - `untrusted_content`: once external content entered the turn (trusted first-party read-only output does not count);
 * - `any_content`: once any recorded source entered the turn, trusted output included (the pre-0067 meaning);
 * - `always`: every call, tainted or not.
 */
export type HighRiskConfirmLevel = 'off' | 'untrusted_content' | 'any_content' | 'always';

/** Config keys of the per-category form (`ai.agent.injectionGuard.confirmHighRisk.<key>`). */
export const HIGH_RISK_CONFIG_KEYS: Readonly<Record<HighRiskActionKind, string>> = Object.freeze({
  shell: 'shell',
  file_write: 'fileWrite',
  outbound: 'outbound',
  config: 'config',
  schedule: 'schedule',
});

/** Per-category form of `confirmHighRisk`; unset categories use {@link DEFAULT_HIGH_RISK_CONFIRM}. */
export type HighRiskConfirmTiers = Partial<Readonly<{
  shell: HighRiskConfirmLevel;
  fileWrite: HighRiskConfirmLevel;
  outbound: HighRiskConfirmLevel;
  config: HighRiskConfirmLevel;
  schedule: HighRiskConfirmLevel;
}>>;

/**
 * Raw `confirmHighRisk`. The string forms apply to every category: `external_content` keeps its
 * pre-0067 meaning (`any_content` everywhere), `always` / `off` are the same level everywhere.
 */
export type ConfirmHighRiskSetting = 'external_content' | 'always' | 'off' | HighRiskConfirmTiers;

/** Resolved levels, one per category. */
export type HighRiskConfirmPolicy = Readonly<Record<HighRiskActionKind, HighRiskConfirmLevel>>;

/** ADR 0067 D2 defaults: only schedules ignore trusted first-party read-only output. */
export const DEFAULT_HIGH_RISK_CONFIRM: HighRiskConfirmPolicy = Object.freeze({
  shell: 'any_content',
  file_write: 'any_content',
  outbound: 'any_content',
  config: 'any_content',
  schedule: 'untrusted_content',
});

/** `ai.agent.injectionGuard` as written in configuration. */
export interface InjectionGuardConfig {
  /** Unset: the ADR 0067 defaults. A string applies to every category; an object sets categories. */
  readonly confirmHighRisk?: ConfirmHighRiskSetting;
  /** `redact` (default): mask system-prompt, secret and other-session memory leaks in replies. `off`: no check. */
  readonly outboundCheck?: 'redact' | 'off';
  /** Tools whose results are trusted (e.g. a first-party lookup); their output does not taint the turn. */
  readonly trustedOutputTools?: readonly string[];
}

export interface InjectionGuardSettings {
  readonly confirmHighRisk: HighRiskConfirmPolicy;
  readonly outboundCheck: 'redact' | 'off';
  readonly trustedOutputTools: readonly string[];
}

export const DEFAULT_INJECTION_GUARD: InjectionGuardSettings = Object.freeze({
  confirmHighRisk: DEFAULT_HIGH_RISK_CONFIRM,
  outboundCheck: 'redact',
  trustedOutputTools: Object.freeze([]) as readonly string[],
});

const LEVELS: ReadonlySet<string> = new Set(['off', 'untrusted_content', 'any_content', 'always']);
const STRICTNESS: Readonly<Record<HighRiskConfirmLevel, number>> = Object.freeze({
  off: 0, untrusted_content: 1, any_content: 2, always: 3,
});

/** ADR 0067 D3: raw `confirmHighRisk` to one level per category; anything unrecognised never relaxes. */
export function resolveHighRiskConfirm(raw: unknown): HighRiskConfirmPolicy {
  if (raw === undefined || raw === null) return DEFAULT_HIGH_RISK_CONFIRM;
  if (typeof raw === 'string') {
    const level: HighRiskConfirmLevel = raw === 'off' ? 'off' : raw === 'always' ? 'always' : 'any_content';
    return Object.freeze(Object.fromEntries(HIGH_RISK_ACTION_KINDS.map(kind => [kind, level])) as Record<HighRiskActionKind, HighRiskConfirmLevel>);
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return Object.freeze(Object.fromEntries(HIGH_RISK_ACTION_KINDS.map(kind => [kind, 'any_content'])) as Record<HighRiskActionKind, HighRiskConfirmLevel>);
  }
  const tiers = raw as Record<string, unknown>;
  return Object.freeze(Object.fromEntries(HIGH_RISK_ACTION_KINDS.map((kind) => {
    // Idempotent: a resolved policy (`file_write`) reads back as itself; the config key wins when both exist.
    const value = tiers[HIGH_RISK_CONFIG_KEYS[kind]] ?? tiers[kind];
    if (value === undefined) return [kind, DEFAULT_HIGH_RISK_CONFIRM[kind]];
    return [kind, typeof value === 'string' && LEVELS.has(value) ? value : 'any_content'];
  })) as Record<HighRiskActionKind, HighRiskConfirmLevel>);
}

/** The stricter of two levels. */
export function stricterConfirmLevel(a: HighRiskConfirmLevel, b: HighRiskConfirmLevel): HighRiskConfirmLevel {
  return STRICTNESS[a] >= STRICTNESS[b] ? a : b;
}

export function resolveInjectionGuard(raw?: InjectionGuardConfig | Partial<InjectionGuardSettings>): InjectionGuardSettings {
  return Object.freeze({
    confirmHighRisk: resolveHighRiskConfirm(raw?.confirmHighRisk),
    outboundCheck: raw?.outboundCheck === 'off' ? 'off' : 'redact',
    trustedOutputTools: Object.freeze([...(raw?.trustedOutputTools ?? [])]),
  });
}

/** Policy name reported when a call is gated or denied because of its provenance. */
export const PROVENANCE_POLICY = 'external-content-confirmation';

type ToolView = Readonly<{
  name: string;
  tags?: readonly string[];
  readOnly?: boolean;
  risk?: string;
  riskCategory?: string;
  /** Set on MCP tools (ADR 0065); they are never trusted output. */
  mcpServer?: string;
  /** ADR 0067 D1: owned by a first-party (`zhin.js` / `@zhin.js/*`) plugin package. */
  firstParty?: boolean;
}>;

/**
 * Harness tools whose output is produced by zhin itself (catalog lookups,
 * skill loading) rather than by an outside source.
 */
const HARNESS_OUTPUT_TOOLS = new Set(['discover', 'load_tool', 'load_skill', 'ask_user']);

/**
 * ADR 0067 D1.2: built-in tools whose results carry outside text even though they are read-only:
 * web pages, workspace / uploaded files, and stores that earlier turns (or other people) wrote.
 */
const BUILTIN_EXTERNAL_CONTENT_TOOLS = new Set([
  'web_fetch', 'web_search',
  'read_file', 'list_dir', 'glob', 'grep', 'knowledge_search', 'get_local_assets',
  'memory_search', 'todo_read', 'get_self_profile',
]);

/** Tag an author puts on a read-only tool that returns text other people can write (ADR 0067 D1.2). */
export const EXTERNAL_CONTENT_TAG = 'external_content';
/** Tag an author puts on a tool whose output is fully trusted (never recorded). */
export const TRUSTED_OUTPUT_TAG = 'trusted_output';

const READ_VERB = /^(?:get|read|list|show|view|query|search|find|check)_/;
/** #1250: `<noun>_<read verb>` names (`schedule_list`, `remind_list`, `config_get`) read too. */
const READ_SUFFIX = /_(?:list|get|show|status)$/;
/**
 * #1250: a write verb anywhere in the name is a write marker. It outranks a `readOnly` declaration and
 * the read suffix, so neither can lift a config / schedule name such as `schedule_add_list` out of its category.
 */
const WRITE_VERB = /(?:^|_)(?:add|create|new|set|update|edit|modify|change|patch|put|write|save|upsert|remove|delete|del|rm|drop|clear|reset|purge|cancel|enable|disable|pause|resume|start|stop|run|exec|execute|trigger|fire|install|uninstall|apply|import|restore|reload|move|rename|send)(?:_|$)/;
const CONFIG_NAME = /(?:^|_)(?:config|configs|configuration|setting|settings|plugin_install|install_plugin|uninstall_plugin)(?:_|$)/;
const SCHEDULE_NAME = /(?:^|_)(?:schedule|schedules|cron|crons|reminder|reminders|remind|timer|timers|alarm|alarms)(?:_|$)/;

/**
 * ADR 0067 D2.1: `schedule_preview` runs its prompt right away, so it never gets the schedule
 * relaxation: it asks at `any_content` at least (an explicit `off` for schedules still switches it off).
 */
const SCHEDULE_PREVIEW_TOOL = 'schedule_preview';

/** ADR 0067 D2: the level a call of `toolName` in category `kind` asks at under `policy`. */
export function highRiskConfirmLevel(
  toolName: string,
  kind: HighRiskActionKind,
  policy: HighRiskConfirmPolicy,
): HighRiskConfirmLevel {
  const level = policy[kind];
  if (kind === 'schedule' && toolName === SCHEDULE_PREVIEW_TOOL && level !== 'off') {
    return stricterConfirmLevel(level, 'any_content');
  }
  return level;
}

/** ADR 0067 D2: the default level of a call (the floor unattended turns never go below). */
export function defaultHighRiskConfirmLevel(toolName: string, kind: HighRiskActionKind): HighRiskConfirmLevel {
  return kind === 'schedule' && toolName === SCHEDULE_PREVIEW_TOOL ? 'any_content' : DEFAULT_HIGH_RISK_CONFIRM[kind];
}

/**
 * The high-risk category of a tool call, or undefined for ordinary tools.
 *
 * #1250 `schedule-list-classified-high-risk`: a config / schedule category that comes only from the
 * tool's name is dropped for a tool that reads: one whose code declares `readOnly: true`, or whose
 * name ends in a read verb (`_list`, `_get`, `_show`, `_status`). The stricter declaration wins: a
 * category tag, a built-in shell / file-write / outbound name, `risk: 'dangerous'`, a `riskCategory`
 * or a write verb in the name keeps the category. `readOnly` comes from the tool definition (code),
 * never from call arguments.
 */
export function classifyHighRiskAction(
  tool: Pick<ToolView, 'name' | 'tags'> & Partial<Pick<ToolView, 'readOnly' | 'risk' | 'riskCategory'>>,
): HighRiskActionKind | undefined {
  const tags = tool.tags ?? [];
  if (tool.name === 'bash' || tags.includes('shell')) return 'shell';
  if (tags.includes('outbound') || isOutboundToolName(tool.name)) return 'outbound';
  if (tags.includes('file_write') || isFileWriteToolName(tool.name)) return 'file_write';
  if (tags.includes('config')) return 'config';
  if (tags.includes('schedule')) return 'schedule';
  const kind = nameCategory(tool.name);
  if (kind === undefined || readsOnlyByDeclaration(tool)) return undefined;
  return kind;
}

/** The pre-#1250 name rule: config / schedule names, except the ones that start with a read verb. */
function nameCategory(name: string): HighRiskActionKind | undefined {
  if (READ_VERB.test(name)) return undefined;
  if (CONFIG_NAME.test(name)) return 'config';
  if (SCHEDULE_NAME.test(name)) return 'schedule';
  return undefined;
}

/**
 * Output trust (ADR 0067 D1) keeps the category rule it had before #1250: a config / schedule tool
 * that reads (such as `schedule_list`, whose rows carry prompts other people wrote) is not trusted
 * output because of a `readOnly` declaration or a read suffix alone.
 */
function hasOutputHighRiskCategory(tool: Pick<ToolView, 'name' | 'tags'>): boolean {
  const tags = tool.tags ?? [];
  return classifyHighRiskAction({ name: tool.name, tags }) !== undefined || nameCategory(tool.name) !== undefined;
}

/** #1250: whether a config / schedule-named tool is a read (see `classifyHighRiskAction`). */
function readsOnlyByDeclaration(tool: Pick<ToolView, 'name'> & Partial<Pick<ToolView, 'readOnly' | 'risk' | 'riskCategory'>>): boolean {
  if (tool.risk === 'dangerous' || tool.riskCategory !== undefined) return false;
  if (WRITE_VERB.test(tool.name)) return false;
  return tool.readOnly === true || READ_SUFFIX.test(tool.name);
}

/**
 * ADR 0067 D1: how a completed call of `tool` is recorded.
 * - `none`: produced by zhin itself, or declared trusted by the deployer / author;
 * - `trusted`: a first-party plugin's effective read-only lookup (counts only for `any_content`);
 * - `external`: everything else, MCP tools included even when upstream marks them read-only.
 */
export function classifyToolOutput(tool: ToolView, settings: Pick<InjectionGuardSettings, 'trustedOutputTools'>): 'none' | 'trusted' | 'external' {
  if (HARNESS_OUTPUT_TOOLS.has(tool.name)) return 'none';
  if (settings.trustedOutputTools.includes(tool.name)) return 'none';
  const tags = tool.tags ?? [];
  if (tags.includes(TRUSTED_OUTPUT_TAG)) return 'none';
  if (tool.mcpServer !== undefined) return 'external';
  if (tags.includes(EXTERNAL_CONTENT_TAG) || BUILTIN_EXTERNAL_CONTENT_TOOLS.has(tool.name)) return 'external';
  if (tool.firstParty === true
    && tool.readOnly === true
    && tool.risk !== 'dangerous'
    && tool.riskCategory === undefined
    && !hasOutputHighRiskCategory(tool)) return 'trusted';
  return 'external';
}

/** Whether a completed call of `tool` brought lower-trust content into the turn (trusted output included). */
export function isExternalContentSource(tool: ToolView, settings: Pick<InjectionGuardSettings, 'trustedOutputTools'>): boolean {
  return classifyToolOutput(tool, settings) !== 'none';
}

export type ProvenanceSource =
  /** `trusted`: a first-party read-only lookup (ADR 0067 D1.3); absent means external content. */
  | Readonly<{ kind: 'tool_result'; toolName: string; trusted?: boolean }>
  /**
   * Background messages / scene events of the conversation that arrived since the last turn,
   * excluding the agent's own replies delivered in this session (#1250, ADR 0067 D7) and, in a private
   * chat, the initiator's own original messages there (ADR 0067 D8). `scene` only picks the
   * wording of the approval card; it is not part of the source key.
   */
  | Readonly<{ kind: 'conversation_context'; scene?: 'private' | 'group' | 'channel' }>
  /** A perception-model description of user media (`ai.multimodal.perception`). */
  | Readonly<{ kind: 'media_perception' }>
  /**
   * ADR 0067 D2.1: the prompt of a scheduled task the model created after reading recorded content;
   * restored at the start of every due run and preview. Never trusted. `sources`: the creating turn's.
   */
  | Readonly<{ kind: 'scheduled_prompt'; sources?: readonly string[] }>;

/** ADR 0067 D2.1: what a scheduled task keeps of the turn that created it (see `ScheduleJob.provenance`). */
export type ScheduledPromptProvenance = Readonly<{ tainted: true; sources: readonly string[] }>;

const MAX_PERSISTED_SOURCES = 10;

const MAX_CHAIN_SOURCES = 5;

const LEVEL_LABELS: Readonly<Record<InitiatorTrustLevel, string>> = Object.freeze({
  owner: '主人',
  trusted_member: '信任成员',
  group_member: '群成员',
});

const ACTION_LABELS: Readonly<Record<HighRiskActionKind, string>> = Object.freeze({
  shell: '执行命令',
  file_write: '写文件',
  outbound: '向其他会话发消息',
  config: '修改配置',
  schedule: '创建或修改定时任务',
});

/** Records which lower-trust sources reached the model during one turn. */
export class TurnProvenance {
  readonly #sources: ProvenanceSource[] = [];

  record(source: ProvenanceSource): void {
    const key = sourceKey(source);
    const index = this.#sources.findIndex((existing) => sourceKey(existing) === key);
    if (index >= 0) {
      // A tool is recorded once; it never moves from external back to trusted.
      const existing = this.#sources[index]!;
      if (existing.kind === 'tool_result' && existing.trusted === true && !(source.kind === 'tool_result' && source.trusted === true)) {
        this.#sources[index] = Object.freeze({ ...source });
      }
      return;
    }
    this.#sources.push(Object.freeze({ ...source }));
  }

  /** Any recorded source, trusted first-party output included. */
  get tainted(): boolean {
    return this.#sources.length > 0;
  }

  /** ADR 0067: a source other than trusted first-party read-only output. */
  get taintedByUntrusted(): boolean {
    return this.#sources.some(source => !(source.kind === 'tool_result' && source.trusted === true));
  }

  /** Whether a category at `level` asks before this call (ADR 0067 D2). */
  requiresConfirmation(level: HighRiskConfirmLevel): boolean {
    switch (level) {
      case 'off': return false;
      case 'always': return true;
      case 'any_content': return this.tainted;
      case 'untrusted_content': return this.taintedByUntrusted;
    }
  }

  get sources(): readonly ProvenanceSource[] {
    return Object.freeze([...this.#sources]);
  }

  /**
   * ADR 0067 D2.1: what a scheduled task created now keeps: any recorded source (trusted output
   * included) marks it, because its prompt may carry what that content said. Undefined on a clean turn.
   */
  snapshotForSchedule(): ScheduledPromptProvenance | undefined {
    if (!this.tainted) return undefined;
    const keys = this.#sources.flatMap(source => source.kind === 'scheduled_prompt'
      ? (source.sources?.length ? source.sources : ['scheduled_prompt'])
      : [sourceKey(source) + (source.kind === 'tool_result' && source.trusted ? ':trusted' : '')]);
    return Object.freeze({ tainted: true, sources: Object.freeze([...new Set(keys)].slice(0, MAX_PERSISTED_SOURCES)) });
  }

  /** Human-readable chain for approval cards, e.g. `主人的消息 → 工具 web_fetch 的结果 → 本次调用 bash`. */
  describeChain(initiator: InitiatorTrustLevel, toolName: string): string {
    const shown = this.#sources.slice(0, MAX_CHAIN_SOURCES).map(describeSource);
    const hidden = this.#sources.length - shown.length;
    return [
      `${LEVEL_LABELS[initiator]}的消息`,
      ...shown,
      ...(hidden > 0 ? [`另外 ${hidden} 个来源`] : []),
      `本次调用 ${toolName}`,
    ].join(' → ');
  }
}

/** Approval question shown when a tainted turn attempts a high-risk action (ADR 0067: or the category is `always`). */
export function formatProvenanceReason(kind: HighRiskActionKind, chain: string, tainted = true): string {
  if (!tainted) return `按配置，${ACTION_LABELS[kind]}每次都需要确认。\n来源链：${chain}`;
  return [
    `这次${ACTION_LABELS[kind]}发生在读取外部内容之后，外部内容可能夹带了指令。`,
    `来源链：${chain}`,
  ].join('\n');
}

export const PROVENANCE_UNATTENDED_REASON =
  '读取外部内容之后的高危动作（执行命令、写文件、向其他会话发消息、修改配置、定时任务）需要人工确认，无人值守的回合无法确认，已拒绝。';

/** #1250: a live conversation that cannot show a confirmation is not an unattended turn; say which it is. */
export const PROVENANCE_NO_CHANNEL_REASON =
  '读取外部内容之后的高危动作（执行命令、写文件、向其他会话发消息、修改配置、定时任务）需要发起人确认，'
  + '但当前会话没有可用的确认渠道，已拒绝。这不是无人值守的回合，用户也没有拒绝。';

function describeSource(source: ProvenanceSource): string {
  switch (source.kind) {
    case 'tool_result': return `工具 ${source.toolName} 的结果${source.trusted ? '（第一方只读）' : ''}`;
    case 'conversation_context': return describeConversationContext(source.scene);
    case 'media_perception': return '图片/媒体的自动描述';
    case 'scheduled_prompt': {
      const shown = (source.sources ?? []).slice(0, MAX_CHAIN_SOURCES).map(describePersistedSource);
      return `定时任务的提示词（创建时已读过${shown.length ? `：${shown.join('、')}` : '外部内容'}）`;
    }
  }
}

/** #1250: a private chat has no group; a stored key does not keep the scene. */
function describeConversationContext(scene: 'private' | 'group' | 'channel' | undefined): string {
  switch (scene) {
    // ADR 0067 D8: the initiator's own original messages never count, so this is someone else's or rewritten content.
    case 'private': return '私聊里的背景消息';
    case 'group':
    case 'channel': return '群聊背景消息';
    default: return '会话背景消息';
  }
}

/** Renders a key written by {@link TurnProvenance.snapshotForSchedule}. */
function describePersistedSource(key: string): string {
  if (key.startsWith('tool:')) {
    const trusted = key.endsWith(':trusted');
    const name = key.slice('tool:'.length, trusted ? -':trusted'.length : undefined);
    return `工具 ${name} 的结果${trusted ? '（第一方只读）' : ''}`;
  }
  if (key === 'conversation_context') return describeConversationContext(undefined);
  if (key === 'media_perception') return '图片/媒体的自动描述';
  if (key === 'scheduled_prompt') return '另一个定时任务的提示词';
  return key;
}

/**
 * ADR 0067 D2.1: parses a stored `ScheduleJob.provenance`. Absent stays absent (jobs from before the
 * field, or created by a person); anything present but malformed fails closed as tainted.
 */
export function parseScheduledPromptProvenance(raw: unknown): ScheduledPromptProvenance | undefined {
  if (raw === undefined || raw === null) return undefined;
  const sources = typeof raw === 'object' && Array.isArray((raw as { sources?: unknown }).sources)
    ? ((raw as { sources: unknown[] }).sources).filter((item): item is string => typeof item === 'string')
      .slice(0, MAX_PERSISTED_SOURCES)
    : [];
  return Object.freeze({ tainted: true, sources: Object.freeze(sources) });
}

/** The provenance of the turn whose tool call is executing (ADR 0067 D2.1). */
const activeTurnProvenance = new AsyncLocalStorage<{ current?: TurnProvenance }>();

/**
 * Runs `execute` (one tool call) so that the tool can read the calling turn's provenance with
 * {@link currentTurnProvenance}. The binding ends with the call: timers the tool started see none.
 */
export async function runWithTurnProvenance<T>(provenance: TurnProvenance, execute: () => Promise<T>): Promise<T> {
  const holder: { current?: TurnProvenance } = { current: provenance };
  try {
    return await activeTurnProvenance.run(holder, execute);
  } finally {
    holder.current = undefined;
  }
}

/** The provenance of the tool call in progress; undefined outside a turn's tool call (Console, RPC). */
export function currentTurnProvenance(): TurnProvenance | undefined {
  return activeTurnProvenance.getStore()?.current;
}

function sourceKey(source: ProvenanceSource): string {
  return source.kind === 'tool_result' ? `tool:${source.toolName}` : source.kind;
}
