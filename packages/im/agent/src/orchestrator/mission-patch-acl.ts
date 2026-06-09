/**
 * Mission State patch ACL — phase-scoped writes (missions-v2).
 */
import type { MissionPhase, MissionState } from './mission-state.js';

const PHASE_ALLOWED_KEYS: Record<MissionPhase, ReadonlySet<keyof MissionState>> = {
  plan: new Set(['phase', 'plan_summary', 'decision_log', 'remote_validator_id']),
  spec: new Set([
    'phase', 'plan_summary', 'validation_spec_paths', 'assertion_count',
    'spec_dry_run_passed', 'decision_log',
  ]),
  develop: new Set(['phase', 'writer_task_id', 'decision_log']),
  validate: new Set(['phase', 'last_validation', 'decision_log']),
  negotiate: new Set(['phase', 'decision_log', 'retry_budget']),
  done: new Set(['phase', 'decision_log']),
};

export function validateMissionStatePatch(
  currentPhase: MissionPhase,
  patch: Partial<MissionState>,
): { ok: boolean; reason?: string } {
  const allowed = PHASE_ALLOWED_KEYS[currentPhase] ?? PHASE_ALLOWED_KEYS.plan;
  for (const key of Object.keys(patch) as (keyof MissionState)[]) {
    if (!allowed.has(key)) {
      return { ok: false, reason: `phase=${currentPhase} 不允许写入字段 ${key}` };
    }
  }
  if (patch.phase && patch.phase !== currentPhase) {
    const order: MissionPhase[] = ['plan', 'spec', 'develop', 'validate', 'negotiate', 'done'];
    const cur = order.indexOf(currentPhase);
    const next = order.indexOf(patch.phase);
    if (next > cur + 1) {
      return { ok: false, reason: `不允许从 phase=${currentPhase} 跳到 ${patch.phase}` };
    }
  }
  return { ok: true };
}
