/**
 * 会话日程到点唤醒（ADR 0037 §2，第 1 期切片 D）。
 *
 * 计时：复用 job-scheduler 的 `ScheduleEngine`（`createSessionEventTimer`，`at` 任务），领域独立——
 * 不写 `schedule-jobs.json`、不进 `schedule-manager`。任何时刻只挂一个「下一次到点」的计时器；
 * 事件创建 / 修改 / 取消 / 接表时重新排期。
 *
 * 到点（scene event 风格的一次唤醒，按「同一会话同一分钟」合并）：
 *   1. `inbound_wake` / `schedule_wake_fired`（`payload.source=schedule`）；
 *   2. 控制面（`control_gate`）——与模板欢迎 / 公告同口径按 **addressed** 判定：`mention_only`（含冷场临时）不拦，
 *      `emergency_stop` / `muted` / `read_only`（含控制面不可用）拦；
 *   3. session-gate（会话画像：Bot 被禁言 / 受限时不发）；
 *   4. 放行则渲染模板直发（**不调模型**），写 `outbound`；
 *   5. 每个事件写一行 `kind=schedule` 结果：单条 `schedule_wake_fired`、合并 `schedule_wake_merged`、
 *      被拦沿用 `control_*` / `cannot_speak_*`（skip）、发送失败 `outbound_failed`（error）。
 *   该偏移一律记为已触发：被拦 / 失败都**不补发、不重试**。
 * 宕机补偿：启动（接表）后与每次到点都会扫描已错过的偏移；晚于 `graceMs`（默认 10 分钟）→ `skip` / `schedule_wake_missed`，
 * 宽限内照常发送。提醒按分钟精度：偏移到点时刻所在的那一分钟开始即可发送（最多提前 < 60 秒，不会推迟）。
 */
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_SESSION_EVENT_GRACE_MS,
  DEFAULT_SESSION_EVENT_TIMEZONE,
  createSessionEventTimer,
  pendingSessionEventReminders,
  renderSessionEventTemplate,
  speakBlock,
  speakBlockReasonCode,
  type AiControlPlane,
  type AiSessionEvents,
  type DecisionEventLog,
  type DecisionReasonCode,
  type DeliveryOutcome,
  type SessionEventReminder,
  type SessionEventTimer,
  type SessionProfileStore,
} from '@zhin.js/agent';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { checkControlAtIngress, logControlBlocked } from './control-gate.js';
import { auditOutbound, createDecisionAudit, type DecisionAudit } from './decision-audit.js';

const logger = getLogger('agent');

const MINUTE_MS = 60_000;
/** 下一次到点的计时器 id（同一时刻只挂一个）。 */
const NEXT_TIMER_ID = 'session-events:next';

export interface SessionEventSendTarget {
  readonly platform: string;
  /** 创建时记下的 Bot 账号；为空时由宿主按平台唯一在线账号解析。 */
  readonly endpoint: string | null;
  readonly scope: 'group' | 'channel';
  /** 平台原生会话号（不带 `group:` 前缀）。 */
  readonly id: string;
}

export interface SessionEventDispatcherDeps {
  readonly events: () => AiSessionEvents | undefined;
  readonly controlPlane?: () => AiControlPlane | undefined;
  readonly sessions?: () => SessionProfileStore | undefined;
  readonly decisionEvents?: () => DecisionEventLog | undefined;
  /** 发送渲染好的提醒文本；抛错视为失败。 */
  readonly send: (target: SessionEventSendTarget, text: string) => Promise<DeliveryOutcome>;
  /** Bot 在场景里发过言（提醒发出）：旁听窗口 / 冷场计数清零。`key` 为 `<platform>:<会话号>`。 */
  readonly onSpoke?: (key: string) => void;
  readonly now?: () => number;
  /** `schedule.graceMs`：错过多久以内仍补发；默认 10 分钟。 */
  readonly graceMs?: number;
  /** `{at}` 的展示时区；默认 `TZ` 或 `Asia/Shanghai`。 */
  readonly timezone?: string;
  /** 计时口；默认 `createSessionEventTimer()`（ScheduleEngine `at`）。 */
  readonly timer?: SessionEventTimer;
}

export type SessionEventWakeResult =
  | Readonly<{ kind: 'sent'; key: string; events: number }>
  | Readonly<{ kind: 'skipped'; key: string; events: number; reason: string }>
  | Readonly<{ kind: 'failed'; key: string; events: number; reason: string }>
  | Readonly<{ kind: 'missed'; key: string; events: number }>;

function parseSceneKey(sceneId: string): { scope: 'group' | 'channel'; id: string } | undefined {
  const index = sceneId.indexOf(':');
  if (index <= 0) return undefined;
  const scope = sceneId.slice(0, index);
  const id = sceneId.slice(index + 1);
  if ((scope !== 'group' && scope !== 'channel') || !id) return undefined;
  return { scope, id };
}

function minuteOf(ms: number): number {
  return Math.floor(ms / MINUTE_MS);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SessionEventDispatcher {
  readonly #now: () => number;
  readonly graceMs: number;
  readonly #timezone: string;
  #timer: SessionEventTimer | undefined;
  #cancelNext: (() => void) | undefined;
  #unsubscribe: (() => void) | undefined;
  #running: Promise<readonly SessionEventWakeResult[]> = Promise.resolve([]);
  #disposed = false;

  readonly deps: SessionEventDispatcherDeps;

  constructor(deps: SessionEventDispatcherDeps) {
    this.deps = deps;
    this.#now = deps.now ?? Date.now;
    const grace = deps.graceMs;
    this.graceMs = typeof grace === 'number' && Number.isFinite(grace) && grace >= 0 ? Math.trunc(grace) : DEFAULT_SESSION_EVENT_GRACE_MS;
    this.#timezone = deps.timezone || process.env.TZ || DEFAULT_SESSION_EVENT_TIMEZONE;
  }

  /** 当前的事件存储；宿主还没装好 Agent 时为 undefined（不抛错）。 */
  #store(): AiSessionEvents | undefined {
    try {
      return this.deps.events();
    } catch {
      return undefined;
    }
  }

  /** 订阅事件变化并立刻扫一遍（处理重启前错过的提醒）。返回停止函数。 */
  start(): () => void {
    const store = this.#store();
    if (store && !this.#unsubscribe) this.#unsubscribe = store.subscribe(() => { void this.tick(); });
    void this.tick();
    return () => this.dispose();
  }

  /** 处理所有已到点的提醒，然后为下一个提醒排期。串行执行；并发调用排队。 */
  tick(): Promise<readonly SessionEventWakeResult[]> {
    const run = this.#running.then(() => this.#tick(), () => this.#tick());
    this.#running = run.catch(() => []);
    return run;
  }

  async #tick(): Promise<readonly SessionEventWakeResult[]> {
    if (this.#disposed) return [];
    const store = this.#store();
    if (!store) return [];
    let scheduled;
    try {
      scheduled = await store.listScheduled();
    } catch (error) {
      // 读不出事件：不发、不记已触发；下次变化或到点再试。
      logger.warn(formatCompact({ op: 'session_events_read_failed', error: errorText(error) }));
      return [];
    }
    const now = this.#now();
    const due: SessionEventReminder[] = [];
    let next: number | undefined;
    for (const event of scheduled) {
      for (const reminder of pendingSessionEventReminders(event)) {
        const slot = minuteOf(reminder.fireAt) * MINUTE_MS;
        if (slot <= now) due.push(reminder);
        else if (next === undefined || slot < next) next = slot;
      }
    }
    const results: SessionEventWakeResult[] = [];
    const missed = due.filter((reminder) => now - reminder.fireAt > this.graceMs);
    const onTime = due.filter((reminder) => now - reminder.fireAt <= this.graceMs);
    for (const reminder of missed) results.push(await this.#missed(store, reminder, now));
    const groups = new Map<string, SessionEventReminder[]>();
    for (const reminder of onTime) {
      const key = `${reminder.event.platform}\u0000${reminder.event.sceneId}\u0000${minuteOf(reminder.fireAt)}`;
      const group = groups.get(key) ?? [];
      group.push(reminder);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      if (this.#disposed) break;
      results.push(await this.#wake(store, group, now));
    }
    if (!this.#disposed) this.#arm(next);
    return Object.freeze(results);
  }

  #arm(next: number | undefined): void {
    this.#cancelNext?.();
    this.#cancelNext = undefined;
    if (next === undefined) return;
    this.#timer ??= this.deps.timer ?? createSessionEventTimer({
      timezone: this.#timezone,
      onError: (error, id) => logger.warn(formatCompact({ op: 'session_event_timer_failed', id, error: error.message })),
    });
    this.#cancelNext = this.#timer.at(NEXT_TIMER_ID, next, () => { void this.tick(); });
  }

  #audit(reminder: SessionEventReminder, turnId: string): DecisionAudit {
    const event = reminder.event;
    return createDecisionAudit(this.deps.decisionEvents?.(), {
      turnId,
      instanceId: event.endpoint || event.platform,
      platform: event.platform,
      sceneId: event.sceneId,
      userId: null,
    });
  }

  /**
   * 先认领再发送：把这些偏移记入 `fired`，只返回本次认领到的提醒（另一代路由抢先记过的不再发）。
   * 落账失败时不发（fail closed）：该提醒保持未触发，下一次变化或到点再判（届时可能已超宽限 → missed）。
   */
  async #claim(store: AiSessionEvents, reminders: readonly SessionEventReminder[]): Promise<{ kept: SessionEventReminder[]; done: Map<string, boolean> }> {
    const byEvent = new Map<string, SessionEventReminder[]>();
    for (const reminder of reminders) byEvent.set(reminder.event.id, [...(byEvent.get(reminder.event.id) ?? []), reminder]);
    const kept: SessionEventReminder[] = [];
    const done = new Map<string, boolean>();
    for (const [id, list] of byEvent) {
      try {
        const { record, claimed } = await store.markFired({ id, offsets: list.map((reminder) => reminder.offset) });
        done.set(id, record?.status === 'done');
        for (const reminder of list) if (claimed.includes(reminder.offset)) kept.push(reminder);
      } catch (error) {
        logger.warn(formatCompact({ op: 'session_event_mark_fired_failed', id, error: errorText(error) }));
      }
    }
    return { kept, done };
  }

  async #missed(store: AiSessionEvents, reminder: SessionEventReminder, now: number): Promise<SessionEventWakeResult> {
    const event = reminder.event;
    const key = `${event.platform}:${event.sceneId}`;
    const turnId = randomUUID();
    const { kept, done } = await this.#claim(store, [reminder]);
    if (kept.length === 0) return { kind: 'skipped', key, events: 0, reason: 'not_claimed' };
    this.#audit(reminder, turnId)({
      kind: 'schedule',
      outcome: 'skip',
      reasonCode: 'schedule_wake_missed',
      reasonDetail: `late_ms:${now - reminder.fireAt}`,
      payload: { source: 'schedule', eventId: event.id, offset: reminder.offset, fireAt: reminder.fireAt, lateMs: now - reminder.fireAt, graceMs: this.graceMs, done: done.get(event.id) === true },
      actor: 'policy',
    });
    logger.info(formatCompact({ op: 'session_event_missed', conv: key, id: event.id, offset: reminder.offset, lateMs: now - reminder.fireAt }));
    return { kind: 'missed', key, events: 1 };
  }

  /** 一次合并后的唤醒：inbound_wake → 控制面 → session-gate → 模板直发。 */
  async #wake(store: AiSessionEvents, due: readonly SessionEventReminder[], now: number): Promise<SessionEventWakeResult> {
    const first = due[0]!;
    const { platform, sceneId } = first.event;
    const key = `${platform}:${sceneId}`;
    // 先认领（记为已触发）再判定 / 发送：被拦、失败都不补发，并发的另一代路由也不会重发。
    const { kept: group, done } = await this.#claim(store, due);
    if (group.length === 0) return { kind: 'skipped', key, events: 0, reason: 'not_claimed' };
    const turnId = randomUUID();
    const audit = this.#audit(first, turnId);
    const merged = group.length > 1;
    const items = group.map((reminder) => ({ eventId: reminder.event.id, offset: reminder.offset, fireAt: reminder.fireAt }));
    const payload = { source: 'schedule', events: group.length, items };
    const finish = (
      outcome: 'allow' | 'skip' | 'error',
      reasonCode: DecisionReasonCode,
      reasonDetail?: string,
    ): void => {
      for (const reminder of group) {
        audit({
          kind: 'schedule',
          outcome,
          reasonCode,
          ...(reasonDetail ? { reasonDetail } : {}),
          payload: {
            source: 'schedule',
            eventId: reminder.event.id,
            offset: reminder.offset,
            fireAt: reminder.fireAt,
            lateMs: Math.max(0, now - reminder.fireAt),
            merged: group.length,
            done: done.get(reminder.event.id) === true,
            retry: false,
          },
          ...(outcome === 'skip' ? { actor: 'policy' as const } : {}),
        });
      }
    };

    // 1. 生成一条唤醒。
    audit({ kind: 'inbound_wake', outcome: 'allow', reasonCode: 'schedule_wake_fired', payload });
    const scene = parseSceneKey(sceneId);
    if (!scene) {
      finish('error', 'outbound_failed', 'invalid_scene');
      return { kind: 'failed', key, events: group.length, reason: 'invalid_scene' };
    }

    // 2. 控制面（按 addressed：mention_only 不拦，止损类开关拦）。
    const verdict = checkControlAtIngress(this.deps.controlPlane?.(), { platform, scope: scene.scope, sceneId: scene.id }, true);
    if (verdict.blocked) {
      logControlBlocked('session_event_skipped_control', key, verdict);
      const detail = verdict.level === 'unavailable' ? 'control_state_unavailable' : `${verdict.level}:${verdict.switch}`;
      audit({ kind: 'control_gate', outcome: verdict.outcome, reasonCode: verdict.reasonCode, reasonDetail: detail, payload: { ...payload, stage: 'schedule', level: verdict.level, switch: verdict.switch }, actor: 'policy' });
      finish('skip', verdict.reasonCode, detail);
      return { kind: 'skipped', key, events: group.length, reason: `control:${verdict.switch}` };
    }

    // 3. session-gate：Bot 当前能否在该会话发言。
    const sessions = this.deps.sessions?.();
    if (sessions) {
      let blocked: ReturnType<typeof speakBlock> = null;
      try {
        blocked = speakBlock(await sessions.get(platform, scene.scope, scene.id), now);
      } catch (error) {
        logger.warn(formatCompact({ op: 'session_profile_read_failed', source: 'schedule', error: errorText(error) }));
      }
      if (blocked) {
        const { code, detail } = speakBlockReasonCode(blocked);
        logger.info(formatCompact({ op: 'session_event_skipped_cannot_speak', conv: key, reason: blocked }));
        audit({ kind: 'speak_gate', outcome: 'deny', reasonCode: code, reasonDetail: detail, payload: { ...payload, blocked }, actor: 'policy' });
        finish('skip', code, detail ?? undefined);
        return { kind: 'skipped', key, events: group.length, reason: `cannot_speak:${blocked}` };
      }
    }

    // 4. 渲染模板直发（不调模型）；合并时逐行拼接成一条。
    const text = group
      .map((reminder) => renderSessionEventTemplate(reminder.event.template, {
        title: reminder.event.title,
        at: reminder.event.at,
        // 名义提前量；晚发（宽限内）时扣掉迟到的部分。提前（同一分钟内）发送仍按名义值展示。
        offset: Math.max(0, reminder.offset - Math.max(0, now - reminder.fireAt)),
        timezone: this.#timezone,
      }).text)
      .join('\n');
    let delivered: DeliveryOutcome;
    try {
      delivered = await this.deps.send({ platform, endpoint: first.event.endpoint, scope: scene.scope, id: scene.id }, text);
    } catch (error) {
      delivered = { status: 'failed', code: errorText(error).slice(0, 120) || 'send_failed', retryable: false };
    }
    auditOutbound(audit, delivered, payload);
    if (delivered.status === 'sent') {
      finish('allow', merged ? 'schedule_wake_merged' : 'schedule_wake_fired');
      logger.info(formatCompact({ op: 'session_event_sent', conv: key, events: group.length }));
      try {
        this.deps.onSpoke?.(`${platform}:${scene.id}`);
      } catch { /* 观测回调不影响发送结果 */ }
      return { kind: 'sent', key, events: group.length };
    }
    if (delivered.status === 'suppressed') {
      finish('skip', 'outbound_suppressed');
      return { kind: 'skipped', key, events: group.length, reason: 'suppressed' };
    }
    const reason = `${delivered.status}:${delivered.code}`;
    logger.warn(formatCompact({ op: 'session_event_send_failed', conv: key, reason }));
    finish('error', 'outbound_failed', reason);
    return { kind: 'failed', key, events: group.length, reason };
  }

  dispose(): void {
    this.#disposed = true;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#cancelNext?.();
    this.#cancelNext = undefined;
    this.#timer?.dispose();
    this.#timer = undefined;
  }
}
