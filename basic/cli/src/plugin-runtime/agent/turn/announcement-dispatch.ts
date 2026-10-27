/**
 * 公告发送（ADR 0037 §1.2，第 1 期切片 B）：只发 `approved` 的公告。
 *
 * 顺序（§0.2「出站一律过闸」）：
 *   摘要复核 → 控制面（`control_gate`）→ 会话画像（`speak_gate`）→ 硬闸（以公告审批记录作批准，**不弹第二张卡**）→ 平台公告接口。
 * - 公告是运营者批准过的动作，控制面按 **addressed** 判定：`mention_only`（含冷场临时）不拦；
 *   `emergency_stop` / `muted` / `read_only`（含控制面不可用）拦。
 * - 任何一步被拦或失败：置 `failed`（写清原因），**不排队、不自动重试**；运营者在 Console「重发」后要再批一次。
 *   - 被控制面 / 会话画像拦：`kind=announcement`、`outcome=skip`，沿用 `control_*` / `cannot_speak_*` 码。
 *   - 摘要不符：`announcement_hash_mismatch`（`deny`），不发送。
 *   - 平台失败：`announcement_send_failed`（`error`），并写一行 `outbound`。
 * - 待审批超时（默认 24h → `expired`）由存储在读取时顺带处理，这里另有低频定时扫一遍。
 */
import { randomUUID } from 'node:crypto';
import {
  announcementContentHash,
  speakBlock,
  speakBlockReasonCode,
  type AiAnnouncements,
  type AiControlPlane,
  type AnnouncementRecord,
  type DecisionEventLog,
  type DecisionReasonCode,
  type DeliveryOutcome,
  type SessionProfileStore,
} from '@zhin.js/agent';
import { ToolHardGate, type ToolApprovalQueue, type ToolHardGateConfig } from '@zhin.js/agent/security';
import { formatCompact, getLogger } from '@zhin.js/logger';
import { checkControlAtIngress, logControlBlocked } from './control-gate.js';
import { auditOutbound, createDecisionAudit } from './decision-audit.js';

const logger = getLogger('agent');

/** 发送时交给硬闸评估的工具名：核心名单里的 `publish` 类（ADR 0036 §3）。 */
export const ANNOUNCEMENT_SEND_TOOL_NAME = 'send_group_notice';
/** 过期扫描间隔。 */
export const ANNOUNCEMENT_EXPIRE_SWEEP_MS = 10 * 60 * 1000;

export interface AnnouncementSendTarget {
  readonly platform: string;
  /** 起草时记下的 Bot 账号；为空时由宿主按平台唯一在线账号解析。 */
  readonly endpoint: string | null;
  readonly scope: 'group' | 'channel';
  /** 平台原生群号（不带 `group:` 前缀）。 */
  readonly id: string;
}

export interface AnnouncementDispatcherDeps {
  readonly announcements: () => AiAnnouncements | undefined;
  readonly controlPlane?: () => AiControlPlane | undefined;
  readonly sessions?: () => SessionProfileStore | undefined;
  readonly decisionEvents?: () => DecisionEventLog | undefined;
  readonly hardGate?: () => ToolHardGateConfig | undefined;
  /** 宿主的硬闸审批队列：传给硬闸只为与回合同构；以审批记录批准的路径**从不入队**（不弹第二张卡）。 */
  readonly approvals?: () => ToolApprovalQueue | undefined;
  /** 调平台公告接口；抛错视为失败。 */
  readonly sendNotice: (target: AnnouncementSendTarget, content: string) => Promise<DeliveryOutcome>;
  /** Bot 在场景里发过言（公告发出）：旁听窗口 / 冷场计数清零。`key` 为 `<platform>:<群号>`。 */
  readonly onSpoke?: (key: string) => void;
  readonly now?: () => number;
  readonly setInterval?: (run: () => void, ms: number) => unknown;
  readonly clearInterval?: (handle: unknown) => void;
}

export type AnnouncementDispatchResult =
  | Readonly<{ kind: 'sent'; record: AnnouncementRecord }>
  | Readonly<{ kind: 'failed'; record: AnnouncementRecord; reason: string }>
  | Readonly<{ kind: 'not_approved'; record: AnnouncementRecord | null }>;

function parseSceneKey(sceneId: string): { scope: 'group' | 'channel'; id: string } | undefined {
  const index = sceneId.indexOf(':');
  if (index <= 0) return undefined;
  const scope = sceneId.slice(0, index);
  const id = sceneId.slice(index + 1);
  if ((scope !== 'group' && scope !== 'channel') || !id) return undefined;
  return { scope, id };
}

export class AnnouncementDispatcher {
  readonly #now: () => number;
  /** 同一条公告同时只发一次。 */
  readonly #inflight = new Map<string, Promise<AnnouncementDispatchResult>>();
  #sweep: unknown;
  #disposed = false;

  readonly deps: AnnouncementDispatcherDeps;

  constructor(deps: AnnouncementDispatcherDeps) {
    this.deps = deps;
    this.#now = deps.now ?? Date.now;
  }

  /** 低频扫描过期的待审批公告（读取时也会顺带过期）。 */
  start(): () => void {
    const set = this.deps.setInterval ?? ((run, ms) => {
      const handle = setInterval(run, ms);
      (handle as { unref?: () => void }).unref?.();
      return handle;
    });
    this.#sweep = set(() => { void this.expireDue(); }, ANNOUNCEMENT_EXPIRE_SWEEP_MS);
    return () => this.dispose();
  }

  async expireDue(): Promise<number> {
    try {
      return (await this.deps.announcements()?.expireDue())?.length ?? 0;
    } catch (error) {
      logger.warn(formatCompact({ op: 'announcement_expire_failed', error: error instanceof Error ? error.message : String(error) }));
      return 0;
    }
  }

  /** 发送一条已批准的公告。并发调用同一条只执行一次。 */
  dispatch(id: string): Promise<AnnouncementDispatchResult> {
    const running = this.#inflight.get(id);
    if (running) return running;
    const run = this.#dispatch(id).finally(() => this.#inflight.delete(id));
    this.#inflight.set(id, run);
    return run;
  }

  async #dispatch(id: string): Promise<AnnouncementDispatchResult> {
    const store = this.deps.announcements();
    if (!store || this.#disposed) return { kind: 'not_approved', record: null };
    const record = await store.get(id);
    if (!record || record.status !== 'approved') return { kind: 'not_approved', record };
    const turnId = randomUUID();
    const scene = parseSceneKey(record.sceneId);
    const audit = createDecisionAudit(this.deps.decisionEvents?.(), {
      turnId,
      instanceId: record.endpoint || record.platform,
      platform: record.platform,
      sceneId: record.sceneId,
      userId: null,
    });
    const payload = { announcementId: record.id, source: 'announcement' };
    const fail = async (reason: string, reasonCode: DecisionReasonCode, outcome: 'error' | 'skip' | 'deny', extra: Record<string, unknown> = {}) => {
      const { record: failed } = await store.markFailed({
        id: record.id,
        expectedRevision: record.revision,
        turnId,
        error: reason,
        reasonCode,
        outcome,
        payload: { ...extra, retry: false },
      });
      logger.warn(formatCompact({ op: 'announcement_not_sent', id: record.id, conv: `${record.platform}:${record.sceneId}`, reason }));
      return { kind: 'failed' as const, record: failed, reason };
    };

    if (!scene) return fail('invalid_scene', 'announcement_send_failed', 'error');

    // 1. 摘要复核：正文（可能被直接改库）必须与审批时绑定的摘要一致。
    const contentHash = announcementContentHash(record.content);
    if (contentHash !== record.contentHash || !record.approvedHash || record.approvedHash !== contentHash) {
      return fail('content_hash_mismatch', 'announcement_hash_mismatch', 'deny', { contentHash, approvedHash: record.approvedHash });
    }

    // 2. 控制面（按 addressed：mention_only 不拦，止损类开关拦）。
    const verdict = checkControlAtIngress(this.deps.controlPlane?.(), { platform: record.platform, scope: scene.scope, sceneId: scene.id }, true);
    if (verdict.blocked) {
      logControlBlocked('announcement_skipped_control', `${record.platform}:${record.sceneId}`, verdict);
      const detail = verdict.level === 'unavailable' ? 'control_state_unavailable' : `${verdict.level}:${verdict.switch}`;
      audit({ kind: 'control_gate', outcome: verdict.outcome, reasonCode: verdict.reasonCode, reasonDetail: detail, payload: { ...payload, stage: 'announcement', level: verdict.level, switch: verdict.switch }, actor: 'policy' });
      return fail(`blocked:${detail}`, verdict.reasonCode, 'skip', { stage: 'control_gate' });
    }

    // 3. 会话画像：Bot 当前能否在该群发言（被禁言 / 受限时不发）。
    const sessions = this.deps.sessions?.();
    if (sessions) {
      let blocked: ReturnType<typeof speakBlock> = null;
      try {
        blocked = speakBlock(await sessions.get(record.platform, scene.scope, scene.id), this.#now());
      } catch (error) {
        logger.warn(formatCompact({ op: 'session_profile_read_failed', source: 'announcement', error: error instanceof Error ? error.message : String(error) }));
      }
      if (blocked) {
        const { code, detail } = speakBlockReasonCode(blocked);
        audit({ kind: 'speak_gate', outcome: 'deny', reasonCode: code, reasonDetail: detail, payload: { ...payload, blocked }, actor: 'policy' });
        return fail(`blocked:${blocked}`, code, 'skip', { stage: 'speak_gate' });
      }
    }

    // 4. 硬闸：以公告的审批记录作为本次发送的人工批准，不入审批队列、不弹第二张卡。
    const controller = new AbortController();
    const gate = new ToolHardGate(this.deps.hardGate?.(), {
      turnId,
      sessionKey: `announcement:${record.id}`,
      unattended: true,
      signal: controller.signal,
      location: { instanceId: record.endpoint || record.platform, platform: record.platform, sceneId: record.sceneId },
      ...(this.deps.decisionEvents?.() ? { audit: this.deps.decisionEvents!()! } : {}),
      ...(this.deps.approvals?.() ? { queue: this.deps.approvals!()! } : {}),
      ...(this.deps.controlPlane ? { controlPlane: () => this.deps.controlPlane!() } : {}),
    });
    const verdictGate = gate.checkPreApproved(
      { name: ANNOUNCEMENT_SEND_TOOL_NAME },
      { scene: record.sceneId, contentHash },
      `announcement:${record.id}`,
      { source: 'announcement', id: record.id, approvedBy: record.approvedBy, approvedHash: record.approvedHash, contentHash },
    );
    if (verdictGate.status === 'denied') {
      return fail(`hard_gate:${verdictGate.reasonCode}`, verdictGate.reasonCode, 'deny', { stage: 'tool_hard_gate' });
    }

    // 5. 平台公告接口；失败不重试。
    let delivered: DeliveryOutcome;
    try {
      delivered = await this.deps.sendNotice({ platform: record.platform, endpoint: record.endpoint, scope: scene.scope, id: scene.id }, record.content);
    } catch (error) {
      delivered = { status: 'failed', code: error instanceof Error ? error.message.slice(0, 120) : 'send_failed', retryable: false };
    }
    auditOutbound(audit, delivered, payload);
    if (delivered.status === 'sent') {
      const { record: sent } = await store.markSent({ id: record.id, expectedRevision: record.revision, turnId, payload: { ...(delivered.messageId ? { messageId: delivered.messageId } : {}) } });
      logger.info(formatCompact({ op: 'announcement_sent', id: record.id, conv: `${record.platform}:${record.sceneId}` }));
      try {
        this.deps.onSpoke?.(`${record.platform}:${scene.id}`);
      } catch { /* 观测回调不影响发送结果 */ }
      return { kind: 'sent', record: sent };
    }
    const reason = delivered.status === 'suppressed' ? 'suppressed' : `${delivered.status}:${delivered.code}`;
    return fail(reason, 'announcement_send_failed', 'error', { stage: 'outbound' });
  }

  dispose(): void {
    this.#disposed = true;
    if (this.#sweep !== undefined) {
      const clear = this.deps.clearInterval ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
      clear(this.#sweep);
      this.#sweep = undefined;
    }
  }
}
