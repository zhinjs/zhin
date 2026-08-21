import type { WorkroomRunState } from './kernel-contracts.js';
import type { WorkroomKernel } from './workroom-kernel.js';

/** Read-only generation projection for Console and Host inspection. */
export interface WorkroomRuntimeHandle {
  listRuns(projectId: string): Promise<readonly WorkroomRunState[]>;
  getRun(projectId: string, runId: string): Promise<WorkroomRunState | null>;
}

export function createWorkroomRuntime(kernel: WorkroomKernel): WorkroomRuntimeHandle {
  return Object.freeze({
    listRuns: (projectId: string) => kernel.list(projectId),
    getRun: async (projectId: string, runId: string) => {
      try {
        return await kernel.read(projectId, runId);
      } catch (error) {
        if (error instanceof Error && error.message === `Workroom run ${runId} not found`) return null;
        throw error;
      }
    },
  });
}
