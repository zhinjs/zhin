/**
 * 状态感知入站（#996）：与旁听（ambient）并列的第二条「没人叫也会进回合」的入口。
 *
 * 事件落库 → ImRuntime.sceneEvents 广播 → 这里按优先级分流：
 * - 高优先（禁言/解禁、入群申请、成员进出、公告、戳 Bot）：按 `platform:sceneId` coalesce + 限频后
 *   合成**一次**轻量回合；不依赖下一条人话。
 * - 低优先：不唤醒；下一轮（人话回合或被高优先唤醒的回合）的 ephemeral `[Scene events]` 里可见。
 * - 发言门禁与 #995 一致：先折叠事件进会话画像，Bot 不能发言（禁言/全员禁言/宿主限制）时只记 skip，不调模型。
 *
 * 选的是更薄的一条：直接跑一次短 Agent 回合（标记 ambient + scene wake，模型可以返回空），
 * 不再额外走旁听判断模型。默认不改好感度。
 */
import { randomUUID } from 'node:crypto';
import { sceneEventPriority, type AITriggerConfig } from '@zhin.js/core';
import type { RuntimeSceneEventSignal } from '@zhin.js/core/runtime';
import type {
  ActorRef,
  ConversationContextBlock,
  ConversationEventReader,
  ConversationRef,
} from '@zhin.js/im-contract';
import type {
  AgentOutputElement,
  AiControlPlane,
  DecisionEventLog,
  DeliveryOutcome,
  SessionProfileStore,
  TurnOutcome,
  TurnRequest,
} from '@zhin.js/agent';
import { AMBIENT_ENGAGEMENT_METADATA_KEY, SCENE_WAKE_METADATA_KEY } from '@zhin.js/agent/context';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { SceneEventWake, type SceneWakeBatch } from './scene-event-wake.js';
import { readSceneEventLines } from './scene-event-lines.js';
import { observeSceneWakeAndCheckSpeak } from './session-gate.js';
import {
  auditControlGate,
  auditControlOutbound,
  checkControlAtIngress,
  checkControlAtOutbound,
  logControlBlocked,
} from './control-gate.js';
import { capabilityLocalName } from './request.js';
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
    const priority = sceneEventPriority(signal.event, new Set(signal.selfIds));
    if (!priority) return 'ignored';
    // 低优先：已在 conversation_events，下一轮 [Scene events] 带上。
    if (priority === 'low') return 'low';
    const platform = capabilityLocalName(String(conversation.endpoint.id));
    const key = `${platform}:${conversation.id}`;
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
    const sessionKey = `${platform}:${endpoint}:${scope}:${conversation.id}`;
    const lines = await this.linesFor({ sessionKey, conversation, platform, throughSequence: batch.throughSequence, selfIds });
    if (lines.length === 0) {
      logger.info(formatCompact({ op: 'scene_event_wake_skipped', conv: batch.key, reason: 'nothing_new', types }));
      audit({ kind: 'model_skip', outcome: 'skip', reasonCode: 'scene_event_nothing_new', payload: auditPayload });
      return { kind: 'skipped', reason: 'nothing_new' };
    }
    const consumer = `agent-session:${sessionKey}`;
    const readContext = this.deps.readConversationContext;
    const commitContext = this.deps.commitConversationContext;
    let spoke = false;
    audit({ kind: 'inbound_wake', outcome: 'allow', reasonCode: 'scene_event_high_priority', payload: { ...auditPayload, lines: lines.length } });
    const startedAt = Date.now();
    this.#turnIds.set(batch.key, turnId);
    const outcome = await withTimeout(async (signal) => {
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
              const outboundVerdict = checkControlAtOutbound(this.deps.controlPlane?.(), controlTarget);
              if (outboundVerdict.blocked) {
                logControlBlocked('scene_event_outbound_blocked_control', batch.key, outboundVerdict);
                auditControlOutbound(audit, outboundVerdict, { source: 'scene_event' });
                auditOutbound(audit, { status: 'suppressed' }, { source: 'scene_event', control: true });
                return { status: 'suppressed' as const };
              }
              const delivered = await this.deps.deliver(conversation, output);
              auditOutbound(audit, delivered, { source: 'scene_event' });
              if (delivered.status === 'sent') spoke = true;
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
    }, this.deps.timeoutMs()).catch((error: unknown) => {
      auditModelError(audit, error, { source: 'scene_event', durationMs: Date.now() - startedAt });
      throw error;
    });
    if (this.#turnIds.get(batch.key) === turnId) this.#turnIds.delete(batch.key);
    auditModelRun(audit, outcome, { source: 'scene_event', durationMs: Date.now() - startedAt, spoke });
    if (spoke) this.deps.onSpoke?.(batch.key);
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
