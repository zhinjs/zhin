import { demoteScheduleCreator } from './security-harness.js';
import type { HostScheduleTurnContext } from '../internal/host-types.js';
import type { TurnContextView } from '../context/turn-envelope.js';

/** Native Schedule Turn identity. It never fabricates an IM platform or endpoint. */
export function scheduleTurnContextView(context: HostScheduleTurnContext): TurnContextView {
  const jobId = context.jobId?.trim();
  if (!jobId) throw new TypeError('Schedule Turn requires a jobId');
  const creator = context.createdBy ? demoteScheduleCreator(context.createdBy) : undefined;
  return Object.freeze({
    origin: Object.freeze({ kind: 'schedule', jobId }),
    principal: Object.freeze({
      subjectId: creator?.userId ?? 'schedule',
      ...(creator?.name ? { displayName: creator.name } : {}),
      roles: Object.freeze([...(creator?.roles ?? [])]),
    }),
    session: Object.freeze({ key: `schedule:${jobId}` }),
  });
}
