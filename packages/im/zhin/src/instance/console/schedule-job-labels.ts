import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import { withGenerationAgentConsole } from './agent-console.js';

/**
 * Schedule job id → label of the request generation's assistant jobs (#1250 b63), so `schedule:<id>`
 * sessions show the job's name in the trace-archive session list and the usage stats. Jobs without a
 * label are left out; `undefined` when no assistant runs or its jobs cannot be read.
 */
export async function readScheduleJobLabels(snapshots: SnapshotReader | undefined): Promise<ReadonlyMap<string, string> | undefined> {
  if (!snapshots) return undefined;
  try {
    return await withGenerationAgentConsole(snapshots, async ({ assistant }) => {
      if (!assistant) return undefined;
      const labels = new Map<string, string>();
      for (const job of await assistant.jobs.list()) {
        const id = typeof job.id === 'string' ? job.id : undefined;
        const label = typeof job.label === 'string' ? job.label.trim() : '';
        if (id && label) labels.set(id, label);
      }
      return labels;
    });
  } catch {
    return undefined;
  }
}
