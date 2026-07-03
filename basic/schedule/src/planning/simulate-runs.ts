import type { ResolvedJob, ScatterRunState } from '../types.js';
import { getNextRun } from '../dispatch.js';
import { advanceScatterState, EMPTY_SCATTER_STATE } from '../utils/scatter-state.js';

export interface SimulateNextRunsOptions {
  jobId?: string;
  scatterState?: ScatterRunState;
  from?: Date;
}

export function simulateNextRuns(
  job: ResolvedJob,
  count: number,
  options: SimulateNextRunsOptions = {},
): Date[] {
  const results: Date[] = [];
  let from = options.from ?? new Date();
  let scatterState = options.scatterState ?? { ...EMPTY_SCATTER_STATE };

  for (let i = 0; i < count; i++) {
    const next = getNextRun(job, from, {
      jobId: options.jobId,
      scatterState: job.kind === 'scatter' ? scatterState : undefined,
    });
    if (next == null) {
      break;
    }
    results.push(next);
    from = new Date(next.getTime() + 1000);
    if (job.kind === 'scatter' && options.jobId) {
      scatterState = advanceScatterState(next, job.timezone, scatterState);
    }
  }

  return results;
}
