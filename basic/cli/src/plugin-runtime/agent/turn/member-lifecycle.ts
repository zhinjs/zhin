/**
 * 入群欢迎 / 退群记录（ADR 0037 §1.1，第 1 期切片 A）。
 *
 * 入群（side-event `member_increase` → `member.joined`）：
 *   合并窗口（`welcome.mergeWindowMs`，窗口内多人入群合并为一条）→ 小时上限（`welcome.maxPerHour`）
 *   → 渲染模板 → 控制面（`control_gate`，不算被点名）→ session-gate（Bot 能否发言）→ 出站。
 *   任何一步被拦都写 `skip` 并结束，**不排队补发**；发送失败写 `error`，**不自动重试**。
 * 退群（`member_decrease` → `member.left`）：`leave.record` 时只写 `member_lifecycle` / `member_leave_recorded`；
 *   `leave.notify` 本切片只存配置，不发消息。
 *
 * 会话开启 `welcome.enabled` 后，scene event 唤醒对入群事件不再触发模型回合（见 {@link MemberLifecycle.ownsWake}），
 * 避免模型临场欢迎与模板欢迎双发；未开启的会话行为不变。
 * 默认模板直发，不调模型。
 */
import { randomUUID } from 'node:crypto';
import {
  renderWelcomeTemplate,
  sceneKeyOf,
  speakBlockReasonCode,
  type AiControlPlane,
  type AiSessionOps,
  type DecisionEventLog,
  type DeliveryOutcome,
  type SessionProfileStore,
  type WelcomeMember,
  type WelcomePart,
  type WelcomeRender,
} from '@zhin.js/agent';
import type { RuntimeSceneEventSignal } from '@zhin.js/core/runtime';
import type { ConversationEventReader, ConversationRef } from '@zhin.js/im-contract';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { checkControlAtIngress, logControlBlocked } from './control-gate.js';
import { observeSceneWakeAndCheckSpeak } from './session-gate.js';
import { capabilityLocalName } from './request.js';
import { auditOutbound, createDecisionAudit, decisionScopeOf, type DecisionAudit } from './decision-audit.js';

const logger = getLogger('agent');

const HOUR_MS = 60 * 60 * 1000;
/** 单次合并最多 @ 的人数；超出的人仍计入审计，不再追加 @。 */
export const MAX_WELCOME_MEMBERS_PER_MESSAGE = 20;
/** 预览没有真实入群事件时用的示例成员。 */
export const WELCOME_PREVIEW_SAMPLE: readonly WelcomeMember[] = Object.freeze([Object.freeze({ id: '10001', name: '新同学' })]);
/** 进程内最多记住多少个会话的最近入群（预览用）。 */
const MAX_REMEMBERED_SCENES = 2_000;

export interface MemberLifecycleDeps {
  readonly sessionOps: () => AiSessionOps | undefined;
  readonly controlPlane?: () => AiControlPlane | undefined;
  readonly sessions: () => SessionProfileStore | undefined;
  readonly reader: () => ConversationEventReader | undefined;
  readonly decisionEvents?: () => DecisionEventLog | undefined;
  /** 发送渲染好的欢迎段（`text` / `mention`）。 */
  readonly send: (conversation: ConversationRef, parts: readonly WelcomePart[]) => Promise<DeliveryOutcome>;
  /** Bot 在场景里说过话（与旁听的「对话进行中」窗口对齐）。 */
  readonly onSpoke?: (key: string) => void;
  readonly now?: () => number;
  readonly setTimer?: (run: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export type MemberLifecycleSignalResult =
  | 'ignored'
  | 'welcome_disabled'
  | 'welcome_scheduled'
  | 'welcome_merged'
  | 'leave_recorded'
  | 'leave_ignored';

export type WelcomeFlushResult =
  | Readonly<{ kind: 'sent'; members: number }>
  | Readonly<{ kind: 'skipped'; reason: string }>
  | Readonly<{ kind: 'failed'; reason: string }>;

interface Scene {
  readonly conversation: ConversationRef;
  readonly platform: string;
  readonly scope: 'group' | 'channel';
  readonly sceneKey: string;
  readonly endpoint: string;
}

interface PendingWelcome extends Scene {
  readonly turnId: string;
  readonly members: WelcomeMember[];
  readonly selfIds: Set<string>;
  throughSequence: number;
  timer: unknown;
}

function sceneOfConversation(conversation: ConversationRef, endpointId?: string): Scene | undefined {
  if (conversation.kind !== 'group' && conversation.kind !== 'channel') return undefined;
  const platform = capabilityLocalName(String(conversation.endpoint.id));
  if (!platform || !conversation.id) return undefined;
  const scope = conversation.kind;
  return { conversation, platform, scope, sceneKey: sceneKeyOf(scope, conversation.id), endpoint: endpointId ?? platform };
}

function sceneOf(signal: RuntimeSceneEventSignal): Scene | undefined {
  return sceneOfConversation(signal.event.conversation, signal.endpointId);
}

function memberOf(actor: { readonly id: string; readonly displayName?: string }): WelcomeMember {
  const name = actor.displayName?.trim();
  return Object.freeze({ id: String(actor.id), ...(name ? { name } : {}) });
}

export class MemberLifecycle {
  readonly #pending = new Map<string, PendingWelcome>();
  /** 每会话最近一小时已尝试发送的欢迎时间戳。 */
  readonly #sent = new Map<string, number[]>();
  /** 每会话最近一次真实入群（预览用，不落库）。 */
  readonly #lastJoin = new Map<string, readonly WelcomeMember[]>();
  readonly #now: () => number;
  readonly #setTimer: (run: () => void, ms: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;
  #disposed = false;
  /** 测试 / 诊断：最近一次 flush 的结果。 */
  lastResult: WelcomeFlushResult | undefined;

  constructor(private readonly deps: MemberLifecycleDeps) {
    this.#now = deps.now ?? Date.now;
    this.#setTimer = deps.setTimer ?? ((run, ms) => {
      const handle = setTimeout(run, ms);
      (handle as { unref?: () => void }).unref?.();
      return handle;
    });
    this.#clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  #audit(scene: Scene, turnId: string, userId?: string): DecisionAudit {
    return createDecisionAudit(this.deps.decisionEvents?.(), decisionScopeOf({
      turnId,
      platform: scene.platform,
      scope: scene.scope,
      sceneId: scene.conversation.id,
      endpoint: scene.endpoint,
      ...(userId ? { userId } : {}),
    }));
  }

  #config(scene: Scene) {
    const ops = this.deps.sessionOps();
    if (!ops) return undefined;
    try {
      return ops.resolve(scene.platform, scene.sceneKey);
    } catch (error) {
      logger.warn(formatCompact({ op: 'session_ops_resolve_failed', error: error instanceof Error ? error.message : String(error) }));
      return undefined;
    }
  }

  /**
   * 该事件是否由模板欢迎接管：会话开启 `welcome.enabled` 时，入群事件不再触发 scene event 模型唤醒。
   * 其余事件（含退群）不受影响。
   */
  ownsWake(signal: RuntimeSceneEventSignal): boolean {
    if (signal.event.type !== 'member.joined') return false;
    return this.ownsWelcome(signal.event.conversation);
  }

  /**
   * 该会话的入群欢迎是否由本模板欢迎接管（#1012 A9 方案②）：插件旧欢迎（group-suite `welcomeMessage`）
   * 经 `memberWelcomeOwnerToken` 询问，接管时不再自行发送，避免同一次入群双发。只读配置，不发送、不写审计。
   */
  ownsWelcome(conversation: ConversationRef): boolean {
    const scene = sceneOfConversation(conversation);
    return !!scene && this.#config(scene)?.welcome.enabled === true;
  }

  /** ImRuntime.sceneEvents 的订阅入口；同步返回，不阻塞入站。 */
  handle(signal: RuntimeSceneEventSignal): MemberLifecycleSignalResult {
    if (this.#disposed) return 'ignored';
    const event = signal.event;
    if (event.type !== 'member.joined' && event.type !== 'member.left') return 'ignored';
    const scene = sceneOf(signal);
    if (!scene) return 'ignored';
    const selfIds = new Set(signal.selfIds.map(String));
    const member = memberOf(event.member);
    // Bot 自己进 / 出群不是成员生命周期事件。
    if (selfIds.has(member.id)) return 'ignored';
    const config = this.#config(scene);
    if (event.type === 'member.left') {
      if (!config?.leave.record) return 'leave_ignored';
      this.#audit(scene, randomUUID(), member.id)({
        kind: 'member_lifecycle',
        outcome: 'allow',
        reasonCode: 'member_leave_recorded',
        reasonDetail: event.reason,
        payload: {
          event: 'member_decrease',
          memberId: member.id,
          reason: event.reason,
          ...(event.actor ? { actorId: String(event.actor.id) } : {}),
          sequence: signal.sequence,
          notify: config.leave.notify,
        },
      });
      if (config.leave.notify) {
        logger.debug(formatCompact({ op: 'member_leave_notify_not_implemented', conv: `${scene.platform}:${scene.sceneKey}` }));
      }
      return 'leave_recorded';
    }

    const key = `${scene.platform}:${scene.sceneKey}`;
    this.#rememberJoin(key, member);
    if (!config?.welcome.enabled) {
      this.#audit(scene, randomUUID(), member.id)({
        kind: 'member_lifecycle',
        outcome: 'skip',
        reasonCode: 'welcome_disabled',
        payload: { event: 'member_increase', memberId: member.id, sequence: signal.sequence },
      });
      return 'welcome_disabled';
    }
    const pending = this.#pending.get(key);
    if (pending) {
      if (!pending.members.some((item) => item.id === member.id)) pending.members.push(member);
      for (const id of selfIds) pending.selfIds.add(id);
      pending.throughSequence = Math.max(pending.throughSequence, signal.sequence);
      this.#audit(pending, pending.turnId, member.id)({
        kind: 'member_lifecycle',
        outcome: 'defer',
        reasonCode: 'welcome_merged',
        payload: { event: 'member_increase', memberId: member.id, members: pending.members.length, sequence: signal.sequence },
      });
      return 'welcome_merged';
    }
    const next: PendingWelcome = {
      ...scene,
      turnId: randomUUID(),
      members: [member],
      selfIds,
      throughSequence: signal.sequence,
      timer: undefined,
    };
    this.#pending.set(key, next);
    const windowMs = config.welcome.mergeWindowMs;
    if (windowMs <= 0) {
      void this.#flushSafely(key);
    } else {
      next.timer = this.#setTimer(() => { void this.#flushSafely(key); }, windowMs);
    }
    return 'welcome_scheduled';
  }

  #rememberJoin(key: string, member: WelcomeMember): void {
    this.#lastJoin.delete(key);
    this.#lastJoin.set(key, Object.freeze([member]));
    if (this.#lastJoin.size > MAX_REMEMBERED_SCENES) {
      const oldest = this.#lastJoin.keys().next().value;
      if (oldest !== undefined) this.#lastJoin.delete(oldest);
    }
  }

  async #flushSafely(key: string): Promise<void> {
    try {
      this.lastResult = await this.flush(key);
    } catch (error) {
      // 不应发生：flush 内部已处理发送失败。保守地只记日志，不重试。
      logger.warn(formatCompact({ op: 'welcome_flush_failed', conv: key, error: error instanceof Error ? error.message : String(error) }));
    }
  }

  /** 合并窗口到期：限频 → 控制面 → session-gate → 渲染 → 出站。 */
  async flush(key: string): Promise<WelcomeFlushResult> {
    const batch = this.#pending.get(key);
    if (!batch) return { kind: 'skipped', reason: 'nothing_pending' };
    this.#pending.delete(key);
    if (batch.timer !== undefined) this.#clearTimer(batch.timer);
    const audit = this.#audit(batch, batch.turnId);
    const memberIds = batch.members.map((member) => member.id);
    const payload = { event: 'member_increase', members: memberIds.length, memberIds: memberIds.slice(0, MAX_WELCOME_MEMBERS_PER_MESSAGE), throughSequence: batch.throughSequence };
    const config = this.#config(batch);
    if (!config?.welcome.enabled) {
      audit({ kind: 'member_lifecycle', outcome: 'skip', reasonCode: 'welcome_disabled', payload });
      return { kind: 'skipped', reason: 'welcome_disabled' };
    }

    const now = this.#now();
    const recent = (this.#sent.get(key) ?? []).filter((at) => now - at < HOUR_MS);
    this.#sent.set(key, recent);
    if (recent.length >= config.welcome.maxPerHour) {
      logger.info(formatCompact({ op: 'welcome_rate_limited', conv: key, maxPerHour: config.welcome.maxPerHour }));
      audit({ kind: 'member_lifecycle', outcome: 'skip', reasonCode: 'welcome_rate_limited', payload: { ...payload, maxPerHour: config.welcome.maxPerHour, sentLastHour: recent.length } });
      return { kind: 'skipped', reason: 'welcome_rate_limited' };
    }

    // 控制面在 session-gate 之前。欢迎按 addressed 判定：mention_only（含冷场临时）不拦模板欢迎；
    // emergency_stop / muted / read_only 仍拦（与 outboundGate 同口径，Fin 拍板）。
    const verdict = checkControlAtIngress(this.deps.controlPlane?.(), { platform: batch.platform, scope: batch.scope, sceneId: batch.conversation.id }, true);
    if (verdict.blocked) {
      logControlBlocked('welcome_skipped_control', key, verdict);
      const detail = verdict.level === 'unavailable' ? 'control_state_unavailable' : `${verdict.level}:${verdict.switch}`;
      audit({ kind: 'control_gate', outcome: verdict.outcome, reasonCode: verdict.reasonCode, reasonDetail: detail, payload: { ...payload, stage: 'welcome', level: verdict.level, switch: verdict.switch }, actor: 'policy' });
      audit({ kind: 'member_lifecycle', outcome: 'skip', reasonCode: verdict.reasonCode, reasonDetail: detail, payload });
      return { kind: 'skipped', reason: `control:${verdict.switch}` };
    }

    const blocked = await observeSceneWakeAndCheckSpeak({
      sessions: this.deps.sessions(),
      events: this.deps.reader(),
      conversation: batch.conversation,
      platform: batch.platform,
      scope: batch.scope,
      sceneId: batch.conversation.id,
      selfIds: [...batch.selfIds],
      throughSequence: batch.throughSequence,
    });
    if (blocked) {
      logger.info(formatCompact({ op: 'welcome_skipped_cannot_speak', conv: key, reason: blocked }));
      const { code, detail } = speakBlockReasonCode(blocked);
      audit({ kind: 'speak_gate', outcome: 'deny', reasonCode: code, reasonDetail: detail, payload: { ...payload, blocked }, actor: 'policy' });
      audit({ kind: 'member_lifecycle', outcome: 'skip', reasonCode: code, reasonDetail: detail, payload });
      return { kind: 'skipped', reason: `cannot_speak:${blocked}` };
    }

    const rendered = await this.#render(batch, config.welcome.template, config.welcome.rulesUrl, batch.members.slice(0, MAX_WELCOME_MEMBERS_PER_MESSAGE));
    // 发送一旦尝试就计入小时上限（包括失败），避免平台抖动时反复尝试。
    recent.push(now);
    let delivered: DeliveryOutcome;
    try {
      delivered = await this.deps.send(batch.conversation, rendered.parts);
    } catch (error) {
      delivered = { status: 'failed', code: error instanceof Error ? error.message.slice(0, 80) : 'send_failed', retryable: false };
    }
    auditOutbound(audit, delivered, { source: 'welcome' });
    if (delivered.status === 'sent') {
      this.deps.onSpoke?.(`${batch.platform}:${batch.conversation.id}`);
      audit({ kind: 'member_lifecycle', outcome: 'allow', reasonCode: 'welcome_sent', payload: { ...payload, unknownVars: [...rendered.unknownVars] } });
      logger.info(formatCompact({ op: 'welcome_sent', conv: key, members: memberIds.length }));
      return { kind: 'sent', members: memberIds.length };
    }
    if (delivered.status === 'suppressed') {
      audit({ kind: 'member_lifecycle', outcome: 'skip', reasonCode: 'outbound_suppressed', payload });
      return { kind: 'skipped', reason: 'suppressed' };
    }
    const reason = `${delivered.status}:${delivered.code}`;
    logger.warn(formatCompact({ op: 'welcome_send_failed', conv: key, reason }));
    audit({ kind: 'member_lifecycle', outcome: 'error', reasonCode: 'outbound_failed', reasonDetail: reason, payload });
    return { kind: 'failed', reason };
  }

  async #groupName(scene: Scene): Promise<string> {
    try {
      const profile = await this.deps.sessions()?.get(scene.platform, scene.scope, scene.conversation.id);
      return profile?.title?.trim() || scene.conversation.id;
    } catch {
      return scene.conversation.id;
    }
  }

  async #render(scene: Scene, template: string, rulesUrl: string, members: readonly WelcomeMember[]): Promise<WelcomeRender> {
    return renderWelcomeTemplate(template, { members, group: await this.#groupName(scene), rulesUrl });
  }

  /**
   * 预览（Console）：只渲染，不发送，不写审计。用该会话最近一次真实入群（进程内），没有则用示例成员。
   * `template` 缺省用会话生效模板。
   */
  async preview(input: Readonly<{ platform: string; sceneId: string; template?: string }>): Promise<Readonly<{
    text: string;
    parts: readonly WelcomePart[];
    unknownVars: readonly string[];
    sample: boolean;
    members: readonly WelcomeMember[];
    enabled: boolean;
  }>> {
    const [scope, ...rest] = input.sceneId.split(':');
    const id = rest.join(':');
    const sceneScope = scope === 'channel' ? 'channel' : 'group';
    const scene: Scene = {
      conversation: { endpoint: { id: input.platform }, kind: sceneScope, id } as unknown as ConversationRef,
      platform: input.platform,
      scope: sceneScope,
      sceneKey: input.sceneId,
      endpoint: input.platform,
    };
    const config = this.deps.sessionOps()?.resolve(input.platform, input.sceneId);
    const remembered = this.#lastJoin.get(`${input.platform}:${input.sceneId}`);
    const members = remembered ?? WELCOME_PREVIEW_SAMPLE;
    const rendered = await this.#render(
      scene,
      input.template ?? config?.welcome.template ?? '',
      config?.welcome.rulesUrl ?? '',
      members,
    );
    return Object.freeze({
      text: rendered.text,
      parts: rendered.parts,
      unknownVars: rendered.unknownVars,
      sample: !remembered,
      members,
      enabled: config?.welcome.enabled === true,
    });
  }

  dispose(): void {
    this.#disposed = true;
    for (const pending of this.#pending.values()) if (pending.timer !== undefined) this.#clearTimer(pending.timer);
    this.#pending.clear();
    this.#sent.clear();
    this.#lastJoin.clear();
  }
}
