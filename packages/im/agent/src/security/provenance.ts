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
 * Unattended turns have no ApprovalPort, so such calls are denied there.
 */
import type { InitiatorTrustLevel } from './trust-level.js';
import { isOutboundToolName } from './trust-level.js';

export type HighRiskActionKind = 'shell' | 'outbound' | 'config' | 'schedule';

export interface InjectionGuardSettings {
  /**
   * `external_content` (default): once lower-trust content entered the turn,
   * high-risk actions require approval. `off`: no provenance confirmation.
   */
  readonly confirmHighRisk: 'external_content' | 'off';
  /** `redact` (default): mask system-prompt, secret and other-session memory leaks in replies. `off`: no check. */
  readonly outboundCheck: 'redact' | 'off';
  /** Tools whose results are trusted (e.g. a first-party lookup); their output does not taint the turn. */
  readonly trustedOutputTools: readonly string[];
}

export const DEFAULT_INJECTION_GUARD: InjectionGuardSettings = Object.freeze({
  confirmHighRisk: 'external_content',
  outboundCheck: 'redact',
  trustedOutputTools: Object.freeze([]) as readonly string[],
});

export function resolveInjectionGuard(raw?: Partial<InjectionGuardSettings>): InjectionGuardSettings {
  return Object.freeze({
    confirmHighRisk: raw?.confirmHighRisk === 'off' ? 'off' : 'external_content',
    outboundCheck: raw?.outboundCheck === 'off' ? 'off' : 'redact',
    trustedOutputTools: Object.freeze([...(raw?.trustedOutputTools ?? [])]),
  });
}

/** Policy name reported when a call is gated or denied because of its provenance. */
export const PROVENANCE_POLICY = 'external-content-confirmation';

type ToolView = Readonly<{ name: string; tags?: readonly string[] }>;

/**
 * Harness tools whose output is produced by zhin itself (catalog lookups,
 * skill loading) rather than by an outside source.
 */
const HARNESS_OUTPUT_TOOLS = new Set(['discover', 'load_tool', 'load_skill', 'ask_user']);

const READ_VERB = /^(?:get|read|list|show|view|query|search|find|check)_/;
const CONFIG_NAME = /(?:^|_)(?:config|configs|configuration|setting|settings|plugin_install|install_plugin|uninstall_plugin)(?:_|$)/;
const SCHEDULE_NAME = /(?:^|_)(?:schedule|schedules|cron|crons|reminder|reminders|remind|timer|timers|alarm|alarms)(?:_|$)/;

/** The high-risk category of a tool call, or undefined for ordinary tools. */
export function classifyHighRiskAction(tool: ToolView): HighRiskActionKind | undefined {
  const tags = tool.tags ?? [];
  if (tool.name === 'bash' || tags.includes('shell')) return 'shell';
  if (tags.includes('outbound') || isOutboundToolName(tool.name)) return 'outbound';
  if (tags.includes('config')) return 'config';
  if (tags.includes('schedule')) return 'schedule';
  if (READ_VERB.test(tool.name)) return undefined;
  if (CONFIG_NAME.test(tool.name)) return 'config';
  if (SCHEDULE_NAME.test(tool.name)) return 'schedule';
  return undefined;
}

/** Whether a completed call of `tool` brought lower-trust content into the turn. */
export function isExternalContentSource(tool: ToolView, settings: InjectionGuardSettings): boolean {
  if (HARNESS_OUTPUT_TOOLS.has(tool.name)) return false;
  if (settings.trustedOutputTools.includes(tool.name)) return false;
  if (tool.tags?.includes('trusted_output')) return false;
  // Conservative: every other result (built-in, plugin, MCP, sub-agent report) is data from outside.
  return true;
}

export type ProvenanceSource =
  | Readonly<{ kind: 'tool_result'; toolName: string }>
  | Readonly<{ kind: 'subagent_report' }>
  | Readonly<{ kind: 'conversation_context' }>;

const MAX_CHAIN_SOURCES = 5;

const LEVEL_LABELS: Readonly<Record<InitiatorTrustLevel, string>> = Object.freeze({
  owner: '主人',
  trusted_member: '信任成员',
  group_member: '群成员',
});

const ACTION_LABELS: Readonly<Record<HighRiskActionKind, string>> = Object.freeze({
  shell: '执行命令',
  outbound: '向其他会话发消息',
  config: '修改配置',
  schedule: '创建或修改定时任务',
});

/** Records which lower-trust sources reached the model during one turn. */
export class TurnProvenance {
  readonly #sources: ProvenanceSource[] = [];

  record(source: ProvenanceSource): void {
    const key = sourceKey(source);
    if (this.#sources.some((existing) => sourceKey(existing) === key)) return;
    this.#sources.push(Object.freeze({ ...source }));
  }

  get tainted(): boolean {
    return this.#sources.length > 0;
  }

  get sources(): readonly ProvenanceSource[] {
    return Object.freeze([...this.#sources]);
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

/** Approval question shown when a tainted turn attempts a high-risk action. */
export function formatProvenanceReason(kind: HighRiskActionKind, chain: string): string {
  return [
    `这次${ACTION_LABELS[kind]}发生在读取外部内容之后，外部内容可能夹带了指令。`,
    `来源链：${chain}`,
  ].join('\n');
}

export const PROVENANCE_UNATTENDED_REASON =
  '读取外部内容之后的高危动作（执行命令、向其他会话发消息、修改配置、定时任务）需要人工确认，无人值守的回合无法确认，已拒绝。';

function describeSource(source: ProvenanceSource): string {
  switch (source.kind) {
    case 'tool_result': return `工具 ${source.toolName} 的结果`;
    case 'subagent_report': return '子 agent 的报告';
    case 'conversation_context': return '群聊背景消息';
  }
}

function sourceKey(source: ProvenanceSource): string {
  return source.kind === 'tool_result' ? `tool:${source.toolName}` : source.kind;
}
