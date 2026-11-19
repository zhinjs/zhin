import type { ScheduleTurnExecutionRequest } from '../../schedule-domain/execution-domain.js';
import type { TurnExecutionProfile } from '../../turn/turn-ingress.js';

/**
 * Execution profile of a scheduled run. `preview` (#1250 b55): a `schedule_preview` run, which is
 * offered no `schedule_*` tool (see `createScheduleCapabilityPlan`).
 */
export function scheduleTurnExecutionProfile(
  input: Pick<ScheduleTurnExecutionRequest, 'executionPlan' | 'createdBy' | 'provenance' | 'preview' | 'security'>,
): Extract<TurnExecutionProfile, { kind: 'schedule' }> {
  return {
    kind: 'schedule',
    executionPlan: input.executionPlan,
    createdBy: input.createdBy,
    ...(input.provenance ? { provenance: input.provenance } : {}),
    ...(input.preview ? { preview: true } : {}),
    security: {
      execPreset: input.security.execPreset,
      allowedDomains: [...input.security.allowedDomains],
    },
  };
}
