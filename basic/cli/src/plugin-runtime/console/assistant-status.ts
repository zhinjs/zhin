import type { AmbientEngagementConfig } from '@zhin.js/ai';
import type { DecisionObservation } from '@zhin.js/agent/runtime';
import { definePluginConsoleRpc, type PluginConsoleRpc, type PluginConsoleRpcJson } from '@zhin.js/plugin-runtime';
import type { AmbientDecision } from '../agent/turn/ambient-engagement.js';
import { decisionReplayQueries, type DecisionEventsSource } from './decision-replay.js';
import { controlActions, controlQueries, type ControlAuditSource, type ControlPlaneSource } from './control-plane-rpc.js';
import {
  sessionOpsActions,
  sessionOpsQueries,
  type MemberLifecycleSource,
  type SessionOpsAuditSource,
  type SessionOpsSource,
} from './session-ops-rpc.js';
import {
  announcementActions,
  announcementQueries,
  type AnnouncementDispatcherSource,
  type AnnouncementsSource,
} from './announcements-rpc.js';
import { sessionEventActions, sessionEventQueries, type SessionEventsSource } from './session-events-rpc.js';
import { groupRuleActions, groupRuleQueries, type GroupRulesSource } from './group-rules-rpc.js';

import { UsageStatsService, usageStatsQueries, type UsageTraceDirSource } from './usage-stats-rpc.js';

/**
 * Ordinary-user-safe Console status for the Agent's 群聊插话 (ambient engagement) and 技能助手
 * (structured decisions) pages (#970). Process-owned and in memory only: it keeps a bounded
 * window of outcome metadata and never stores chat text, prompts, judge reasons or secrets.
 *
 * Served as `plugin.root.ambient` and `plugin.root.skills`. Also hosts the read-only decision
 * replay (ADR 0036 slice C) as `plugin.root.decisions` / `decision-turn` / `decisions-export`,
 * reading the Agent's `ai_decision_events` through {@link AssistantStatus.bindDecisionEvents}, and the
 * control plane (ADR 0036 slice D) as `plugin.root.control` (read) / `plugin.root.control-set` (action),
 * bound through {@link AssistantStatus.bindControlPlane}. ADR 0037 slice A adds the per-session ops config
 * (welcome / leave) as `plugin.root.session-ops` / `session-ops-preview` (read) / `session-ops-set` (action),
 * bound through {@link AssistantStatus.bindSessionOps}. ADR 0037 slice B adds announcements (draft → approve → send)
 * as `plugin.root.announcements` / `announcement` (read) and `announcement-*` (actions), bound through
 * {@link AssistantStatus.bindAnnouncements}. ADR 0037 slice D adds session events (schedule reminders) as
 * `plugin.root.session-events` / `session-event` (read) and `session-event-*` (actions), bound through
 * {@link AssistantStatus.bindSessionEvents}. ADR 0039 slice B adds group moderation rules as `plugin.root.group-rules` /
 * `group-rule` (read) and `group-rule-*` (actions), bound through {@link AssistantStatus.bindGroupRules}.
 */

export const AMBIENT_STATUS_PERMISSION = 'ambient:read';
export const SKILLS_STATUS_PERMISSION = 'skills:read';

const RECENT_LIMIT = 20;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const WINDOW_LIMIT = 2000;

export type AmbientOutcome = 'spoke' | 'watched' | 'stayed_quiet' | 'skipped';
export type AmbientSkipReason = 'cooldown' | 'hourly_cap' | 'judge_interval' | 'no_context' | 'judge_failed';

export interface AmbientRecentItem {
  readonly at: number;
  /** `platform:groupId`, the same form as `ai.trigger.ambient.conversations`. */
  readonly group: string;
  readonly outcome: AmbientOutcome;
  readonly skipReason?: AmbientSkipReason;
  /** Judge confidence rounded to two decimals. */
  readonly confidence?: number;
  /** Which kind of judge decided: the structured decision model or a chat model. */
  readonly judge?: 'decision' | 'chat-model';
}

export interface AmbientStatus {
  readonly enabled: boolean;
  /** `off` when no group is configured; `shadow` judges without replying. */
  readonly mode: 'off' | 'shadow' | 'active';
  /** Configured groups: a count, or `all` for `*`. */
  readonly groups: number | 'all';
  /** Configured chat-model judges in fallback order (`provider/model`). */
  readonly judges: readonly string[];
  readonly last24h: Readonly<Record<AmbientOutcome, number>>;
  /** Structured-decision shadow comparison over 24h: same / different call than the chat-model judge. */
  readonly decisionShadow: Readonly<{ agreed: number; disagreed: number }>;
  /** Newest first, at most 20. */
  readonly recent: readonly AmbientRecentItem[];
  readonly updatedAt: number | null;
}

export type SkillsTask = DecisionObservation['task'];

export interface SkillsTaskSummary {
  readonly task: SkillsTask;
  /** Mode seen on the latest call. */
  readonly mode: DecisionObservation['mode'];
  readonly calls: number;
  readonly selected: number;
  readonly abstained: number;
  readonly shadow: number;
  readonly failed: number;
  readonly averageMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly lastModel?: string;
  readonly lastAt: number;
}

export interface SkillsRecentItem {
  readonly at: number;
  readonly task: SkillsTask;
  readonly mode: DecisionObservation['mode'];
  readonly outcome: DecisionObservation['outcome'];
  readonly durationMs: number;
  readonly model?: string;
  /** Machine reason for a failed or abstained call, never free text. */
  readonly reason?: DecisionObservation['reason'];
}

export interface SkillsStatus {
  /** One row per decision task seen in the last 24h, sorted by task name. */
  readonly tasks: readonly SkillsTaskSummary[];
  readonly totals: Readonly<{ calls: number; inputTokens: number; outputTokens: number }>;
  /** Newest first, at most 20. */
  readonly recent: readonly SkillsRecentItem[];
  readonly updatedAt: number | null;
}

type AmbientConfigReader = () => AmbientEngagementConfig | undefined;

export interface AssistantStatusOptions {
  readonly now?: () => number;
}

export class AssistantStatus {
  readonly #now: () => number;
  readonly #ambient: AmbientRecentItem[] = [];
  readonly #shadow: Array<{ at: number; agreed: boolean }> = [];
  readonly #decisions: Array<SkillsRecentItem & Readonly<{ inputTokens: number; outputTokens: number }>> = [];
  #readAmbientConfig: AmbientConfigReader = () => undefined;
  #readDecisionEvents: DecisionEventsSource = () => undefined;
  #readControlPlane: ControlPlaneSource = () => undefined;
  #readControlAudit: ControlAuditSource = () => undefined;
  #readSessionOps: SessionOpsSource = () => undefined;
  #readMemberLifecycle: MemberLifecycleSource = () => undefined;
  #readSessionOpsAudit: SessionOpsAuditSource = () => undefined;
  #readAnnouncements: AnnouncementsSource = () => undefined;
  #readAnnouncementDispatcher: AnnouncementDispatcherSource = () => undefined;
  #readSessionEvents: SessionEventsSource = () => undefined;
  #readGroupRules: GroupRulesSource = () => undefined;
  #readUsageTraceDir: UsageTraceDirSource = () => undefined;
  readonly #usageStats = new UsageStatsService({ dir: () => this.#readUsageTraceDir(), now: () => this.#now() });

  /** Served as `plugin.root.ambient` / `plugin.root.skills`; read-only, permission-gated. */
  readonly consoleRpc: PluginConsoleRpc;

  constructor(options: AssistantStatusOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.consoleRpc = definePluginConsoleRpc({
      queries: {
        ambient: { requiredPermissions: [AMBIENT_STATUS_PERMISSION], handler: () => this.ambient() as unknown as PluginConsoleRpcJson },
        skills: { requiredPermissions: [SKILLS_STATUS_PERMISSION], handler: () => this.skills() as unknown as PluginConsoleRpcJson },
        ...decisionReplayQueries(() => this.#readDecisionEvents(), this.#now),
        ...controlQueries(() => this.#readControlPlane()),
        ...sessionOpsQueries(() => this.#readSessionOps(), () => this.#readMemberLifecycle()),
        ...announcementQueries(() => this.#readAnnouncements()),
        ...sessionEventQueries(() => this.#readSessionEvents()),
        ...groupRuleQueries(() => this.#readGroupRules()),
        // Read-only token usage charts from the turn trace archive (`control:read`).
        ...usageStatsQueries(() => this.#usageStats),
      },
      actions: {
        // ADR 0036 slice D: the only writer of the control switches (the model has no tool for them).
        ...controlActions(
          () => this.#readControlPlane(),
          () => this.#readControlAudit(),
        ),
        // ADR 0037 slice A: the only writer of the per-session ops config.
        ...sessionOpsActions(() => this.#readSessionOps(), () => this.#readSessionOpsAudit()),
        // ADR 0037 slice B: announcements are submitted / approved / resent only here (the model can only draft).
        ...announcementActions(() => this.#readAnnouncements(), () => this.#readAnnouncementDispatcher()),
        // ADR 0037 slice D: session events are updated / cancelled only here (the model can only create for its session).
        ...sessionEventActions(() => this.#readSessionEvents()),
        // ADR 0039 slice B: group rules are approved / rejected / disabled here or by the group's owner/admins in the group.
        ...groupRuleActions(() => this.#readGroupRules()),
      },
    });
  }

  /** The current generation's `ai.trigger.ambient`; the latest Agent ingress route wins. */
  bindAmbientConfig(read: AmbientConfigReader): void {
    this.#readAmbientConfig = read;
  }

  /** The current generation's control plane (ADR 0036 slice D); the latest Agent ingress route wins. */
  bindControlPlane(read: ControlPlaneSource, audit: ControlAuditSource = () => undefined): void {
    this.#readControlPlane = read;
    this.#readControlAudit = audit;
  }

  /** The current generation's session ops config and welcome engine (ADR 0037 slice A); the latest route wins. */
  bindSessionOps(read: SessionOpsSource, lifecycle: MemberLifecycleSource, audit: SessionOpsAuditSource = () => undefined): void {
    this.#readSessionOps = read;
    this.#readMemberLifecycle = lifecycle;
    this.#readSessionOpsAudit = audit;
  }

  /** The current generation's announcement store and send path (ADR 0037 slice B); the latest route wins. */
  bindAnnouncements(read: AnnouncementsSource, dispatcher: AnnouncementDispatcherSource): void {
    this.#readAnnouncements = read;
    this.#readAnnouncementDispatcher = dispatcher;
  }

  /** The current generation's session event store (ADR 0037 slice D); the latest route wins. */
  bindSessionEvents(read: SessionEventsSource): void {
    this.#readSessionEvents = read;
  }

  /** The current generation's group rule store (ADR 0039 slice B); the latest route wins. */
  bindGroupRules(read: GroupRulesSource): void {
    this.#readGroupRules = read;
  }

  /** The current generation's trace archive dir for `usage-stats`; binding (or unbinding) drops the result cache. */
  bindUsageTraces(read: UsageTraceDirSource): void {
    this.#usageStats.dispose();
    this.#readUsageTraceDir = read;
  }

  /** The current generation's decision audit log (`ai_decision_events`); the latest Agent ingress route wins. */
  bindDecisionEvents(read: DecisionEventsSource): void {
    this.#readDecisionEvents = read;
  }

  recordAmbient(group: string, decision: AmbientDecision): void {
    // A superseded burst is not a decision; the newer message is judged instead.
    if (decision.kind === 'skipped' && decision.reason === 'superseded') return;
    const at = this.#now();
    const entry: AmbientRecentItem = decision.kind === 'skipped'
      ? { at, group, outcome: 'skipped', skipReason: decision.reason as AmbientSkipReason }
      : {
          at,
          group,
          outcome: decision.kind === 'engage' ? 'spoke' : decision.kind === 'shadow' ? 'watched' : 'stayed_quiet',
          confidence: Math.round(clamp01(decision.judgment.confidence) * 100) / 100,
          judge: decision.judgment.source?.startsWith('decision:') ? 'decision' : 'chat-model',
        };
    push(this.#ambient, entry);
  }

  /** Shadow mode of `ai.decisions.ambient`: did the decision model agree with the chat-model judge? */
  recordAmbientShadow(decisionEngage: boolean | undefined, judgeEngage: boolean | undefined): void {
    if (decisionEngage === undefined || judgeEngage === undefined) return;
    push(this.#shadow, { at: this.#now(), agreed: decisionEngage === judgeEngage });
  }

  recordDecision(observation: DecisionObservation): void {
    push(this.#decisions, {
      at: this.#now(),
      task: observation.task,
      mode: observation.mode,
      outcome: observation.outcome,
      durationMs: Math.max(0, Math.round(observation.durationMs)),
      ...(observation.model ? { model: observation.model } : {}),
      ...(observation.reason ? { reason: observation.reason } : {}),
      inputTokens: finite(observation.usage?.inputTokens),
      outputTokens: finite(observation.usage?.outputTokens),
    });
  }

  ambient(): AmbientStatus {
    const since = this.#now() - WINDOW_MS;
    const config = this.#readAmbientConfig();
    const conversations = config?.conversations ?? [];
    const enabled = conversations.length > 0;
    const judges = typeof config?.judge === 'string' ? [config.judge] : config?.judge ?? [];
    const window = this.#ambient.filter((entry) => entry.at >= since);
    const last24h: Record<AmbientOutcome, number> = { spoke: 0, watched: 0, stayed_quiet: 0, skipped: 0 };
    for (const entry of window) last24h[entry.outcome] += 1;
    const shadow = this.#shadow.filter((entry) => entry.at >= since);
    return Object.freeze({
      enabled,
      mode: !enabled ? 'off' : config?.mode === 'shadow' ? 'shadow' : 'active',
      groups: conversations.includes('*') ? 'all' : conversations.length,
      judges: Object.freeze(judges.map((judge) => judge.trim()).filter(Boolean)),
      last24h: Object.freeze(last24h),
      decisionShadow: Object.freeze({
        agreed: shadow.filter((entry) => entry.agreed).length,
        disagreed: shadow.filter((entry) => !entry.agreed).length,
      }),
      recent: Object.freeze(window.slice(-RECENT_LIMIT).reverse().map((item) => Object.freeze({ ...item }))),
      updatedAt: window.at(-1)?.at ?? null,
    });
  }

  skills(): SkillsStatus {
    const since = this.#now() - WINDOW_MS;
    const window = this.#decisions.filter((entry) => entry.at >= since);
    const byTask = new Map<SkillsTask, typeof window>();
    for (const entry of window) byTask.set(entry.task, [...(byTask.get(entry.task) ?? []), entry]);
    const tasks = [...byTask.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([task, rows]) => {
      const last = rows.at(-1)!;
      const count = (outcome: DecisionObservation['outcome']) => rows.filter((row) => row.outcome === outcome).length;
      return Object.freeze({
        task,
        mode: last.mode,
        calls: rows.length,
        selected: count('selected'),
        abstained: count('abstained'),
        shadow: count('shadow'),
        failed: count('failed'),
        averageMs: Math.round(rows.reduce((sum, row) => sum + row.durationMs, 0) / rows.length),
        inputTokens: rows.reduce((sum, row) => sum + row.inputTokens, 0),
        outputTokens: rows.reduce((sum, row) => sum + row.outputTokens, 0),
        ...(lastModel(rows) ? { lastModel: lastModel(rows)! } : {}),
        lastAt: last.at,
      });
    });
    return Object.freeze({
      tasks: Object.freeze(tasks),
      totals: Object.freeze({
        calls: window.length,
        inputTokens: window.reduce((sum, row) => sum + row.inputTokens, 0),
        outputTokens: window.reduce((sum, row) => sum + row.outputTokens, 0),
      }),
      recent: Object.freeze(window.slice(-RECENT_LIMIT).reverse().map(({ inputTokens: _in, outputTokens: _out, ...item }) => Object.freeze(item))),
      updatedAt: window.at(-1)?.at ?? null,
    });
  }
}

function push<T>(list: T[], value: T): void {
  list.push(value);
  if (list.length > WINDOW_LIMIT) list.splice(0, list.length - WINDOW_LIMIT);
}

function lastModel(rows: readonly { readonly model?: string }[]): string | undefined {
  for (let index = rows.length - 1; index >= 0; index -= 1) if (rows[index]!.model) return rows[index]!.model;
  return undefined;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function finite(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}
