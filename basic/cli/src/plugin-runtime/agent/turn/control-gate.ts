/**
 * 控制面闸（ADR 0036 切片 D）：入站判定与出站兜底。
 *
 * - 入站：位于 #995 session-gate **之前**。拦下时不跑会话画像发言判定、不跑旁听判定、不调模型；
 *   写 `control_gate`（`deny` / `skip`）+ `model_skip`，`reason_code` 为对应 `control_*`。未拦下时照常走 session-gate。
 * - 出站：回合进行中开关变化时，发送前再判一次止损类开关（`emergency_stop` / `muted` / `read_only`），命中即不发。
 * - 判定只读内存，不依赖审计写成功；状态读不出时控制面自身 fail closed（见 `AiControlPlane`）。
 * - 判定本身出错（不应发生）同样 fail closed：按 `emergency_stop` 处理。
 */
import { sceneKeyOf, type AiControlPlane, type ControlVerdict, type SessionScope } from '@zhin.js/agent';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { DecisionAudit } from './decision-audit.js';

const logger = getLogger('agent');

const FAIL_CLOSED: ControlVerdict = Object.freeze({
  blocked: true, switch: 'emergency_stop', level: 'unavailable', reasonCode: 'control_emergency_stop', outcome: 'deny',
});

export type ControlPlaneSource = () => AiControlPlane | undefined;

export interface ControlGateTarget {
  readonly platform: string;
  readonly scope: SessionScope;
  readonly sceneId: string;
}

function judge(run: () => ControlVerdict): ControlVerdict {
  try {
    return run();
  } catch (error) {
    logger.warn(formatCompact({ op: 'control_gate_failed', error: error instanceof Error ? error.message : String(error) }));
    return FAIL_CLOSED;
  }
}

/** 入站判定；`addressed` 只影响 `mention_only`。未接控制面时放行。 */
export function checkControlAtIngress(
  control: AiControlPlane | undefined,
  target: ControlGateTarget,
  addressed: boolean,
): ControlVerdict {
  if (!control || !target.platform || !target.sceneId) return { blocked: false };
  return judge(() => control.gate({ platform: target.platform, sceneId: sceneKeyOf(target.scope, target.sceneId), addressed }));
}

/** 出站兜底：只看止损类开关。 */
export function checkControlAtOutbound(control: AiControlPlane | undefined, target: ControlGateTarget): ControlVerdict {
  if (!control || !target.platform || !target.sceneId) return { blocked: false };
  return judge(() => control.outboundGate(target.platform, sceneKeyOf(target.scope, target.sceneId)));
}

/** 入站被拦：`control_gate` + `model_skip`，同码。 */
export function auditControlGate(
  audit: DecisionAudit,
  verdict: Extract<ControlVerdict, { blocked: true }>,
  payload: Record<string, unknown> = {},
): void {
  const detail = verdict.level === 'unavailable' ? 'control_state_unavailable' : `${verdict.level}:${verdict.switch}`;
  audit({ kind: 'control_gate', outcome: verdict.outcome, reasonCode: verdict.reasonCode, reasonDetail: detail, payload: { ...payload, stage: 'ingress', level: verdict.level, switch: verdict.switch }, actor: 'policy' });
  audit({ kind: 'model_skip', outcome: 'skip', reasonCode: verdict.reasonCode, reasonDetail: detail, payload });
}

/** 出站被拦：只写 `control_gate`（`deny`）；调用方随后按「抑制」写 `outbound`。 */
export function auditControlOutbound(
  audit: DecisionAudit,
  verdict: Extract<ControlVerdict, { blocked: true }>,
  payload: Record<string, unknown> = {},
): void {
  const detail = verdict.level === 'unavailable' ? 'control_state_unavailable' : `${verdict.level}:${verdict.switch}`;
  audit({ kind: 'control_gate', outcome: 'deny', reasonCode: verdict.reasonCode, reasonDetail: detail, payload: { ...payload, stage: 'outbound', level: verdict.level, switch: verdict.switch }, actor: 'policy' });
}

export function logControlBlocked(op: string, conv: string, verdict: Extract<ControlVerdict, { blocked: true }>): void {
  logger.info(formatCompact({ op, conv, switch: verdict.switch, level: verdict.level, reason: verdict.reasonCode }));
}
