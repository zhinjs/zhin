/**
 * 状态感知入站（#996）：与旁听（ambient）并列的第二条「没人叫也会进回合」的入口。
 *
 * 事件落库 → ImRuntime.sceneEvents 广播 → 这里按优先级分流：
 * - 高优先（禁言/解禁、入群申请、成员进出、公告、戳 Bot）：按完整 Host / Endpoint / Conversation 任务身份 coalesce + 限频后
 *   合成**一次**轻量回合；不依赖下一条人话。
 * - 低优先：不唤醒；下一轮（人话回合或被高优先唤醒的回合）的 ephemeral `[Scene events]` 里可见。
 * - 发言门禁与 #995 一致：先折叠事件进会话画像，Bot 不能发言（禁言/全员禁言/宿主限制）时只记 skip，不调模型。
 *
 * 选的是更薄的一条：直接跑一次短 Agent 回合（标记 ambient + scene wake，模型可以返回空），
 * 不再额外走旁听判断模型。默认不改好感度。
 */
import { randomUUID } from 'node:crypto';
import { isSceneEvent, sceneEventPriority, summarizeSceneEvent, type AITriggerConfig } from '@zhin.js/core';
import type { RuntimeSceneEventSignal } from '@zhin.js/core/runtime';
import type {
  ActorRef,
  ConversationContextBlock,
  ConversationEvent,
  ConversationEventReader,
  ConversationRef,
} from '@zhin.js/im-contract';
import type {
  AgentOutputElement,
  AiControlPlane,
  DecisionEventLog,
  DeliveryOutcome,
  SceneFactStore,
  SessionProfileStore,
  TurnOutcome,
  TurnRequest,
} from '../../index.js';
import { AMBIENT_ENGAGEMENT_METADATA_KEY, SCENE_WAKE_METADATA_KEY } from '../../context/index.js';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { EventMessage } from '@zhin.js/ai';
import type { HostMailbox } from '../../collaboration/host-mailbox.js';
import { runInMailTurn } from '../../collaboration/mail-turn-context.js';
import { sceneEventToStateMessage } from './scene-event-state.js';
import { applySceneEventToFacts } from './scene-fact-events.js';
import { observeSceneWakeAndCheckSpeak } from './session-gate.js';
import {
  auditControlGate,
  auditControlOutbound,
  checkControlAtIngress,
  checkControlAtOutbound,
  logControlBlocked,
} from './control-gate.js';
import { capabilityLocalName, runtimeSceneTaskSessionKey } from './request.js';
import {
  auditCannotSpeak,
  auditModelError,
  auditModelRun,
  auditOutbound,
  createDecisionAudit,
  decisionScopeOf,
  type DecisionAudit,
} from './decision-audit.js';

const logger = getLogger('agent');

/** 只看最近这段时间的场景事件（与会话上下文的时间窗一致）。 */
export const SCENE_EVENT_MAX_AGE_MS = 30 * 60 * 1000;
/** 每次最多回看的事件条数（含普通消息）。 */
export const SCENE_EVENT_LOOKBACK = 80;
/** 注入行数上限。 */
export const SCENE_EVENT_MAX_LINES = 5;

export interface SceneEventLinesInput {
  readonly reader: ConversationEventReader | undefined;
  readonly conversation: ConversationRef;
  readonly throughSequence: number;
  /** 已展示到的序号（不含）；之前的不再展示。 */
  readonly afterSequence?: number;
  readonly selfIds: readonly string[];
  /** 关系称呼（`ai_user_relations`），不注分数。 */
  readonly nicknames?: (actors: readonly ActorRef[]) => Promise<ReadonlyMap<string, string>>;
  readonly now?: number;
  /** 进出 / 资料变更已写进会话历史（ADR 0041 §7）时为真：这些事件不再进 [Scene events]。 */
  readonly omitStateChanges?: boolean;
}

export async function readSceneEventLines(input: SceneEventLinesInput): Promise<{ lines: string[]; through: number }> {
  const through = input.throughSequence;
  if (!input.reader || !Number.isSafeInteger(through) || through <= 0) return { lines: [], through: input.afterSequence ?? 0 };
  const after = Math.max(input.afterSequence ?? 0, through - SCENE_EVENT_LOOKBACK);
  if (after >= through) return { lines: [], through };
  const entries = await input.reader.listBetween(input.conversation, after, through, SCENE_EVENT_LOOKBACK);
  const notBefore = (input.now ?? Date.now()) - SCENE_EVENT_MAX_AGE_MS;
  const scene = entries.filter((entry) => isSceneEvent(entry.event) && (!input.omitStateChanges || !sceneEventToStateMessage(entry.event)) && entry.event.timestamp >= notBefore);
  if (scene.length === 0) return { lines: [], through };
  const selfIds = new Set(input.selfIds);
  const actors = new Map<string, ActorRef>();
  for (const { event } of scene) {
    for (const actor of [
      'actor' in event ? event.actor : undefined,
      'member' in event ? event.member : undefined,
      'target' in event ? event.target : undefined,
    ]) {
      if (actor && !selfIds.has(String(actor.id)) && actors.size < 8) actors.set(String(actor.id), actor);
    }
  }
  let names: ReadonlyMap<string, string> = new Map();
  if (input.nicknames && actors.size) {
    try {
      names = await input.nicknames([...actors.values()]);
    } catch {
      names = new Map();
    }
  }
  const counted: { text: string; count: number }[] = [];
  for (const { event } of [...scene].reverse()) {
    const text = summarizeSceneEvent(event, { selfIds, nameOf: (actor) => names.get(String(actor.id)) });
    if (!text) continue;
    const same = counted.find((item) => item.text === text);
    if (same) same.count += 1;
    else counted.push({ text, count: 1 });
  }
  const lines = counted.slice(0, SCENE_EVENT_MAX_LINES).map((item) => (item.count > 1 ? `${item.text} ×${item.count}` : item.text));
  return { lines, through };
}

export const SCENE_WAKE_DEFAULT_COALESCE_MS = 4_000;
export const SCENE_WAKE_MIN_COALESCE_MS = 3_000;
export const SCENE_WAKE_MAX_COALESCE_MS = 5_000;
export const SCENE_WAKE_DEFAULT_MIN_INTERVAL_MS = 15_000;

export interface SceneWakeItem {
  readonly sequence: number;
  readonly event: ConversationEvent;
  readonly selfIds: readonly string[];
  readonly endpointId?: string;
}

export interface SceneWakeBatch {
  readonly key: string;
  readonly conversation: ConversationRef;
  readonly items: readonly SceneWakeItem[];
  readonly throughSequence: number;
}

export interface SceneEventWakeOptions {
  readonly coalesceMs?: number;
  readonly minIntervalMs?: number;
  readonly now?: () => number;
  readonly setTimer?: (run: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly onWake: (batch: SceneWakeBatch) => Promise<void> | void;
  /** 批次被限频顺延时调用（日志与决策审计）。 */
  readonly onDeferred?: (key: string, waitMs: number, conversation: ConversationRef) => void;
  readonly onError?: (key: string, error: unknown, conversation: ConversationRef) => void;
}

interface PendingScene {
  conversation: ConversationRef;
  items: SceneWakeItem[];
  timer: unknown;
}

function clampCoalesce(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return SCENE_WAKE_DEFAULT_COALESCE_MS;
  return Math.min(SCENE_WAKE_MAX_COALESCE_MS, Math.max(SCENE_WAKE_MIN_COALESCE_MS, value));
}

export class SceneEventWake {
  readonly #coalesceMs: number;
  readonly #minIntervalMs: number;
  readonly #now: () => number;
  readonly #setTimer: (run: () => void, ms: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;
  readonly #pending = new Map<string, PendingScene>();
  readonly #lastWake = new Map<string, number>();
  readonly #running = new Set<string>();
  #disposed = false;

  constructor(private readonly options: SceneEventWakeOptions) {
    this.#coalesceMs = clampCoalesce(options.coalesceMs);
    this.#minIntervalMs = typeof options.minIntervalMs === 'number' && options.minIntervalMs >= 0
      ? options.minIntervalMs
      : SCENE_WAKE_DEFAULT_MIN_INTERVAL_MS;
    this.#now = options.now ?? Date.now;
    this.#setTimer = options.setTimer ?? ((run, ms) => {
      const handle = setTimeout(run, ms);
      (handle as { unref?: () => void }).unref?.();
      return handle;
    });
    this.#clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  get coalesceMs(): number { return this.#coalesceMs; }
  get minIntervalMs(): number { return this.#minIntervalMs; }

  /** 收一条高优先事件；返回 `scheduled`（开了新窗）或 `coalesced`（并入已开的窗）。 */
  offer(key: string, conversation: ConversationRef, item: SceneWakeItem): 'scheduled' | 'coalesced' | 'disposed' {
    if (this.#disposed) return 'disposed';
    const pending = this.#pending.get(key);
    if (pending) {
      if (!pending.items.some((existing) => existing.sequence === item.sequence)) pending.items.push(item);
      return 'coalesced';
    }
    const scene: PendingScene = { conversation, items: [item], timer: undefined };
    this.#pending.set(key, scene);
    scene.timer = this.#setTimer(() => { void this.#flush(key); }, this.#coalesceMs);
    return 'scheduled';
  }

  async #flush(key: string): Promise<void> {
    const scene = this.#pending.get(key);
    if (!scene || this.#disposed) return;
    const now = this.#now();
    const last = this.#lastWake.get(key);
    const wait = this.#running.has(key)
      ? this.#coalesceMs
      : last === undefined ? 0 : last + this.#minIntervalMs - now;
    if (wait > 0) {
      this.options.onDeferred?.(key, wait, scene.conversation);
      scene.timer = this.#setTimer(() => { void this.#flush(key); }, wait);
      return;
    }
    this.#pending.delete(key);
    this.#lastWake.set(key, now);
    this.#running.add(key);
    const items = [...scene.items].sort((left, right) => left.sequence - right.sequence);
    try {
      await this.options.onWake(Object.freeze({
        key,
        conversation: scene.conversation,
        items: Object.freeze(items),
        throughSequence: items[items.length - 1]!.sequence,
      }));
    } catch (error) {
      this.options.onError?.(key, error, scene.conversation);
    } finally {
      this.#running.delete(key);
    }
  }

  /** 测试/诊断：当前有待唤醒批次的场景。 */
  pendingKeys(): string[] {
    return [...this.#pending.keys()];
  }

  dispose(): void {
    this.#disposed = true;
    for (const scene of this.#pending.values()) this.#clearTimer(scene.timer);
    this.#pending.clear();
    this.#lastWake.clear();
  }
}

/** 唤醒回合写进会话历史的那一行（真正的事件只在 ephemeral `[Scene events]` 里）。 */
export const SCENE_WAKE_INPUT_TEXT = '(scene events)';
export const SCENE_WAKE_PRINCIPAL_ID = 'scene-events';

export interface SceneEventIngressDeps {
  readonly projectRoot: string;
  readonly triggerConfig: () => AITriggerConfig | undefined;
  readonly reader: () => ConversationEventReader | undefined;
  readonly sessions: () => SessionProfileStore | undefined;
  /** 决策审计（ADR 0036 切片 B）；缺省不写。 */
  readonly decisionEvents?: () => DecisionEventLog | undefined;
  /** 控制面四开关（ADR 0036 切片 D）；缺省不拦。 */
  readonly controlPlane?: () => AiControlPlane | undefined;
  /**
   * 事件已由模板运营接管（ADR 0037 切片 A：会话开启 `welcome.enabled` 时的入群事件），不再唤醒模型回合。
   * 事件仍在 `conversation_events`，下一轮 `[Scene events]` 可见。
   */
  readonly ownsWake?: (signal: RuntimeSceneEventSignal) => boolean;
  /**
   * ADR 0041 §6：成员进出 / 资料变更写进会话历史（`agent_messages`，追加）。`create` 为真时无活动会话也开一个
   * （仅在该会话开启了 scene event 唤醒时，随后有回合会读到它）；返回是否写入。缺省不写。
   */
  readonly recordState?: (sessionKey: string, event: EventMessage, options: Readonly<{ create: boolean }>) => Promise<boolean>;
  /**
   * ADR 0041 §6：成员 / 群的侧事件写穿到场景事实的 L2（`ai_scene_members` / `ai_session_profiles`），
   * 与 {@link recordState} 在同一处触发。缺省不写。
   */
  readonly sceneFacts?: () => SceneFactStore | undefined;
  /** 关系称呼（`ai_user_relations` 的 preferredAddress / displayName）。 */
  readonly nickname?: (platform: string, userId: string) => Promise<string | undefined>;
  readonly readConversationContext?: (
    conversation: ConversationRef,
    consumer: string,
    throughSequence: number,
  ) => Promise<Readonly<{ blocks: readonly ConversationContextBlock[]; cursor: number }>>;
  readonly commitConversationContext?: (conversation: ConversationRef, consumer: string, cursor: number) => Promise<void>;
  /** 把模型输出发到场景（发布出站元素 + 统一出站）。 */
  readonly deliver: (conversation: ConversationRef, output: readonly AgentOutputElement[]) => Promise<DeliveryOutcome>;
  /** 执行一次 Agent 回合（生产：AgentRuntime.execute + 主 binding）。 */
  readonly executeTurn: (request: TurnRequest) => Promise<TurnOutcome>;
  /**
   * ADR 0048 H3 (Q3): the route's host Mailbox. A coalesced wake is posted as
   * one event Mail on the scene lane and runs as its Mail turn, queued behind
   * (never merged into) the scene's human turns. Absent only in unit tests.
   */
  readonly mailbox?: () => HostMailbox | undefined;
  readonly timeoutMs: () => number;
  /** Bot 在场景里说过话（用于旁听的「对话进行中」窗口）。 */
  readonly onSpoke?: (key: string) => void;
  readonly now?: () => number;
  readonly setTimer?: (run: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export type SceneWakeResult =
  | Readonly<{ kind: 'skipped'; reason: string }>
  | Readonly<{ kind: 'woke'; status: TurnOutcome['status']; lines: number }>;

export class SceneEventIngress {
  #wake: SceneEventWake | undefined;
  readonly #shown = new Map<string, number>();
  /** 正在跑的唤醒回合的 turn_id（失败时让 `inbound_wake/error` 串进同一回合）。 */
  readonly #turnIds = new Map<string, string>();
  /** 进行中的状态变更落库；唤醒回合开始前等它们写完，回合才读得到。 */
  readonly #records = new Set<Promise<void>>();
  /** 测试/诊断：最近一次唤醒的结果。 */
  lastResult: SceneWakeResult | undefined;

  constructor(private readonly deps: SceneEventIngressDeps) {}

  #config() {
    const trigger = this.deps.triggerConfig();
    return {
      enabled: trigger?.enabled !== false,
      conversations: trigger?.sceneEvents?.conversations ?? trigger?.ambient?.conversations ?? [],
      coalesceMs: trigger?.sceneEvents?.coalesceMs,
      minIntervalMs: trigger?.sceneEvents?.minIntervalMs,
    };
  }

  enabledFor(platform: string, sceneId: string): boolean {
    const config = this.#config();
    if (!config.enabled) return false;
    return config.conversations.includes('*') || config.conversations.includes(`${platform}:${sceneId}`);
  }

  #sceneTaskKey(conversation: ConversationRef, endpointId: string | undefined): string {
    const platform = capabilityLocalName(String(conversation.endpoint.id));
    const scope = conversation.kind === 'channel' ? 'channel' : 'group';
    return runtimeSceneTaskSessionKey({ origin: { kind: 'im', platform, endpoint: endpointId ?? platform, scope, sceneId: conversation.id, conversation } }, this.deps.projectRoot);
  }

  #audit(conversation: ConversationRef, turnId: string, endpoint?: string): DecisionAudit {
    const platform = capabilityLocalName(String(conversation.endpoint.id));
    return createDecisionAudit(this.deps.decisionEvents?.(), decisionScopeOf({
      turnId,
      platform,
      scope: conversation.kind === 'channel' ? 'channel' : 'group',
      sceneId: conversation.id,
      ...(endpoint ? { endpoint } : {}),
    }));
  }

  #wakeEngine(): SceneEventWake {
    if (this.#wake) return this.#wake;
    const config = this.#config();
    this.#wake = new SceneEventWake({
      ...(config.coalesceMs !== undefined ? { coalesceMs: Number(config.coalesceMs) } : {}),
      ...(config.minIntervalMs !== undefined ? { minIntervalMs: Number(config.minIntervalMs) } : {}),
      ...(this.deps.now ? { now: this.deps.now } : {}),
      ...(this.deps.setTimer ? { setTimer: this.deps.setTimer } : {}),
      ...(this.deps.clearTimer ? { clearTimer: this.deps.clearTimer } : {}),
      onWake: async (batch) => { this.lastResult = await this.wakeScene(batch); },
      onDeferred: (key, waitMs, conversation) => {
        logger.debug(formatCompact({ op: 'scene_event_wake_deferred', conv: key, waitMs }));
        this.#audit(conversation, randomUUID())({
          kind: 'inbound_wake', outcome: 'defer', reasonCode: 'scene_event_rate_limited', payload: { source: 'scene_event', waitMs },
        });
      },
      onError: (key, error, conversation) => {
        const detail = error instanceof Error ? error.message : String(error);
        logger.warn(formatCompact({ op: 'scene_event_wake_failed', conv: key, error: detail }));
        const turnId = this.#turnIds.get(key) ?? randomUUID();
        this.#turnIds.delete(key);
        this.#audit(conversation, turnId)({
          kind: 'inbound_wake', outcome: 'error', reasonCode: 'scene_event_wake_failed', reasonDetail: detail, payload: { source: 'scene_event' },
        });
      },
    });
    return this.#wake;
  }

  /** ImRuntime.sceneEvents 的订阅入口；同步返回，不阻塞入站。 */
  handle(signal: RuntimeSceneEventSignal): 'ignored' | 'low' | 'disabled' | 'suppressed' | 'scheduled' | 'coalesced' | 'disposed' {
    const conversation = signal.event.conversation;
    if (conversation.kind !== 'group' && conversation.kind !== 'channel') return 'ignored';
    this.#recordState(signal);
    const priority = sceneEventPriority(signal.event, new Set(signal.selfIds));
    if (!priority) return 'ignored';
    // 低优先：已在 conversation_events，下一轮 [Scene events] 带上。
    if (priority === 'low') return 'low';
    const platform = capabilityLocalName(String(conversation.endpoint.id));
    const key = this.#sceneTaskKey(conversation, signal.endpointId);
    if (this.#owned(signal)) {
      logger.debug(formatCompact({ op: 'scene_event_wake_suppressed', conv: key, type: signal.event.type, reason: 'welcome_enabled' }));
      return 'suppressed';
    }
    if (!this.enabledFor(platform, conversation.id)) {
      logger.debug(formatCompact({ op: 'scene_event_wake_disabled', conv: key, type: signal.event.type }));
      return 'disabled';
    }
    return this.#wakeEngine().offer(key, conversation, {
      sequence: signal.sequence,
      event: signal.event,
      selfIds: signal.selfIds,
      ...(signal.endpointId ? { endpointId: signal.endpointId } : {}),
    });
  }

  #writeThroughFacts(signal: RuntimeSceneEventSignal): void {
    const store = this.deps.sceneFacts?.();
    if (!store) return;
    const task: Promise<void> = applySceneEventToFacts(store, signal, this.deps.now).then(() => undefined, (error: unknown) => {
      logger.warn(formatCompact({ op: 'scene_fact_write_through_failed', type: signal.event.type, error: error instanceof Error ? error.message : String(error) }));
    }).finally(() => { this.#records.delete(task); });
    this.#records.add(task);
  }

  #recordState(signal: RuntimeSceneEventSignal): void {
    this.#writeThroughFacts(signal);
    const record = this.deps.recordState;
    if (!record) return;
    const message = sceneEventToStateMessage(signal.event);
    if (!message) return;
    const conversation = signal.event.conversation;
    const platform = capabilityLocalName(String(conversation.endpoint.id));
    const sessionKey = this.#sceneTaskKey(conversation, signal.endpointId);
    const create = this.enabledFor(platform, conversation.id);
    const task: Promise<void> = record(sessionKey, message, { create }).then(() => undefined, (error: unknown) => {
      logger.warn(formatCompact({ op: 'scene_state_record_failed', conv: sessionKey, type: signal.event.type, error: error instanceof Error ? error.message : String(error) }));
    }).finally(() => { this.#records.delete(task); });
    this.#records.add(task);
  }

  #owned(signal: RuntimeSceneEventSignal): boolean {
    try {
      return this.deps.ownsWake?.(signal) === true;
    } catch {
      return false;
    }
  }

  /**
   * 本轮 `[Scene events]` 的摘要行（最新在前，最多 5 行）。每个 Agent 会话只展示一次。
   * 失败返回空数组，不影响回合。
   */
  async linesFor(input: Readonly<{
    sessionKey: string;
    conversation: ConversationRef;
    platform: string;
    /** Trusted live Endpoint instance, matching the state-history owner. */
    endpointId: string;
    throughSequence: number | undefined;
    selfIds: readonly string[];
  }>): Promise<string[]> {
    if (input.throughSequence === undefined) return [];
    try {
      const nickname = this.deps.nickname;
      const { lines, through } = await readSceneEventLines({
        reader: this.deps.reader(),
        conversation: input.conversation,
        throughSequence: input.throughSequence,
        afterSequence: this.#shown.get(input.sessionKey),
        // Only this exact system Session already carries these events in its history.
        omitStateChanges: this.deps.recordState !== undefined
          && input.sessionKey === this.#sceneTaskKey(input.conversation, input.endpointId),
        selfIds: input.selfIds,
        ...(nickname ? {
          nicknames: async (actors: readonly ActorRef[]) => {
            const names = new Map<string, string>();
            await Promise.all(actors.map(async (actor) => {
              const name = await nickname(input.platform, String(actor.id)).catch(() => undefined);
              if (name) names.set(String(actor.id), name);
            }));
            return names;
          },
        } : {}),
        ...(this.deps.now ? { now: this.deps.now() } : {}),
      });
      this.#shown.set(input.sessionKey, Math.max(through, this.#shown.get(input.sessionKey) ?? 0));
      if (this.#shown.size > 2_000) {
        const oldest = this.#shown.keys().next().value;
        if (oldest !== undefined) this.#shown.delete(oldest);
      }
      return lines;
    } catch (error) {
      logger.debug(formatCompact({ op: 'scene_events_read_failed', error: error instanceof Error ? error.message : String(error) }));
      return [];
    }
  }

  /** 一次合并后的唤醒：会话画像门禁 → 摘要 → 短回合。 */
  async wakeScene(batch: SceneWakeBatch): Promise<SceneWakeResult> {
    const { conversation } = batch;
    const scope = conversation.kind === 'channel' ? 'channel' : 'group';
    const platform = capabilityLocalName(String(conversation.endpoint.id));
    const last = batch.items[batch.items.length - 1]!;
    const selfIds = [...new Set(batch.items.flatMap((item) => item.selfIds))];
    const endpoint = last.endpointId ?? platform;
    const types = [...new Set(batch.items.map((item) => item.event.type))].join(',');
    const turnId = randomUUID();
    const audit = this.#audit(conversation, turnId, endpoint);
    const auditPayload = { source: 'scene_event', events: batch.items.length, types, throughSequence: batch.throughSequence };
    // 控制面在会话画像之前：scene event 唤醒不是被点名，mention_only 也直接 skip。
    const controlTarget = { platform, scope, sceneId: conversation.id } as const;
    const verdict = checkControlAtIngress(this.deps.controlPlane?.(), controlTarget, false);
    if (verdict.blocked) {
      logControlBlocked('scene_event_wake_skipped_control', batch.key, verdict);
      auditControlGate(audit, verdict, auditPayload);
      return { kind: 'skipped', reason: `control:${verdict.switch}` };
    }
    const blocked = await observeSceneWakeAndCheckSpeak({
      sessions: this.deps.sessions(),
      events: this.deps.reader(),
      conversation,
      platform,
      scope,
      sceneId: conversation.id,
      selfIds,
      throughSequence: batch.throughSequence,
    });
    if (blocked) {
      // 与 #995 session-gate 一致：画像已更新（例如记下 Bot 被禁言到何时），但不调模型。
      logger.info(formatCompact({ op: 'scene_event_wake_skipped_cannot_speak', conv: batch.key, reason: blocked, events: batch.items.length, types }));
      auditCannotSpeak(audit, blocked, auditPayload);
      return { kind: 'skipped', reason: `cannot_speak:${blocked}` };
    }
    const sessionKey = this.#sceneTaskKey(conversation, endpoint);
    await Promise.all([...this.#records]);
    const lines = await this.linesFor({ sessionKey, conversation, platform, endpointId: endpoint, throughSequence: batch.throughSequence, selfIds });
    // 进出 / 资料变更已写进会话历史（[state change]），不再出现在 [Scene events]，但仍足以唤醒回合。
    const stateChanges = this.deps.recordState ? batch.items.filter((item) => sceneEventToStateMessage(item.event)).length : 0;
    if (lines.length === 0 && stateChanges === 0) {
      logger.info(formatCompact({ op: 'scene_event_wake_skipped', conv: batch.key, reason: 'nothing_new', types }));
      audit({ kind: 'model_skip', outcome: 'skip', reasonCode: 'scene_event_nothing_new', payload: auditPayload });
      return { kind: 'skipped', reason: 'nothing_new' };
    }
    const consumer = `agent-session:${sessionKey}`;
    const readContext = this.deps.readConversationContext;
    const commitContext = this.deps.commitConversationContext;
    let spoke = false;
    audit({ kind: 'inbound_wake', outcome: 'allow', reasonCode: 'scene_event_high_priority', payload: { ...auditPayload, lines: lines.length, stateChanges } });
    const mailbox = this.deps.mailbox?.();
    const admitted = mailbox ? await mailbox.admit({
      sessionKey,
      senderId: SCENE_WAKE_PRINCIPAL_ID,
      kind: 'event',
      event: types || 'scene',
      text: lines.join('\n'),
      plainText: true,
    }) : undefined;
    if (admitted && admitted.kind !== 'run') {
      const reason = admitted.kind === 'rejected' ? admitted.reason : admitted.kind;
      logger.info(formatCompact({ op: 'scene_event_wake_skipped', conv: batch.key, reason: `mailbox_${reason}`, types }));
      return { kind: 'skipped', reason: `mailbox:${reason}` };
    }
    const admission = admitted;
    const startedAt = Date.now();
    this.#turnIds.set(batch.key, turnId);
    let released: 'completed' | 'failed' = 'failed';
    const run = () => withTimeout(async (timeoutSignal) => {
      const signal = admission ? AbortSignal.any([timeoutSignal, admission.signal]) : timeoutSignal;
      const request: TurnRequest = Object.freeze({
        identity: Object.freeze({ traceId: randomUUID(), turnId }),
        origin: Object.freeze({ kind: 'im' as const, conversation, platform, endpoint, scope, sceneId: conversation.id }),
        intent: Object.freeze({ kind: 'new' as const }),
        // 合成入口：没有真人发起者（principal.origin 缺省），只有普通用户权限。
        principal: Object.freeze({ subjectId: SCENE_WAKE_PRINCIPAL_ID, displayName: 'Scene events', roles: Object.freeze(['user']) }),
        input: Object.freeze({
          text: SCENE_WAKE_INPUT_TEXT,
          metadata: Object.freeze({ [AMBIENT_ENGAGEMENT_METADATA_KEY]: 'ambient', [SCENE_WAKE_METADATA_KEY]: true }),
          sceneEvents: Object.freeze(lines),
        }),
        session: Object.freeze({ key: sessionKey }),
        // 无 shell、无网络、只读工作区：这是一次社交反应，不是任务。
        policy: Object.freeze({
          permissions: Object.freeze(['user']),
          unattended: true,
          filesystem: Object.freeze({ workspaceRoot: this.deps.projectRoot, access: 'read-only' as const }),
        }),
        signal,
        ports: Object.freeze({
          reply: Object.freeze({
            send: async (output: readonly AgentOutputElement[]) => {
              // A wake whose turn was stopped never speaks (ADR 0048 H3).
              if (admission?.signal.aborted) return { status: 'suppressed' as const };
              const outboundVerdict = checkControlAtOutbound(this.deps.controlPlane?.(), controlTarget);
              if (outboundVerdict.blocked) {
                logControlBlocked('scene_event_outbound_blocked_control', batch.key, outboundVerdict);
                auditControlOutbound(audit, outboundVerdict, { source: 'scene_event' });
                auditOutbound(audit, { status: 'suppressed' }, { source: 'scene_event', control: true });
                return { status: 'suppressed' as const };
              }
              const delivered = await this.deps.deliver(conversation, output);
              auditOutbound(audit, delivered, { source: 'scene_event' });
              if (delivered.status === 'sent') {
                spoke = true;
                admission?.markDelivered();
              }
              return delivered;
            },
          }),
          ...(readContext && commitContext ? {
            conversationContext: Object.freeze({
              readPending: () => readContext(conversation, consumer, batch.throughSequence),
              commit: (cursor: number) => commitContext(conversation, consumer, cursor),
            }),
          } : {}),
        }),
      }) as TurnRequest;
      return this.deps.executeTurn(request);
    }, this.deps.timeoutMs());
    const outcome = await (admission && mailbox
      ? runInMailTurn({ mailbox, mail: admission.mail, batch: admission.batch }, run)
      : run()).then((result) => {
      released = 'completed';
      return result;
    }, (error: unknown) => {
      auditModelError(audit, error, { source: 'scene_event', durationMs: Date.now() - startedAt });
      throw error;
    }).finally(() => admission?.release(released));
    if (this.#turnIds.get(batch.key) === turnId) this.#turnIds.delete(batch.key);
    auditModelRun(audit, outcome, { source: 'scene_event', durationMs: Date.now() - startedAt, spoke });
    // Ambient engagement still tracks the existing public scene identity.
    if (spoke) this.deps.onSpoke?.(`${platform}:${conversation.id}`);
    logger.info(formatCompact({ op: 'scene_event_wake', conv: batch.key, events: batch.items.length, types, lines: lines.length, status: outcome.status, spoke }));
    return { kind: 'woke', status: outcome.status, lines: lines.length };
  }

  dispose(): void {
    this.#wake?.dispose();
    this.#wake = undefined;
    this.#shown.clear();
    this.#turnIds.clear();
  }
}

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`scene wake timed out after ${timeoutMs}ms`)), timeoutMs);
  return run(controller.signal).finally(() => clearTimeout(timer));
}
