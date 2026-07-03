/**
 * Pipeline 六边形端口（ADR 0024 架构师建议 #2）——便于单测 mock。
 */
import type { CollaborationCell, PipelineArtifact, PipelineState } from '../../collaboration/types.js';
import type {
  CollaborationArtifactRepository,
  SubmitArtifactInput,
} from '../../collaboration/collaboration-artifact-repository.js';

/** Cell 状态读写端口。 */
export interface CellStatePort {
  getCell(cellId: string): CollaborationCell | undefined;
  getCellFresh?(cellId: string): Promise<CollaborationCell | undefined>;
  setPipelineState(cellId: string, state: PipelineState): Promise<void>;
  setMissionRunId?(cellId: string, runId: string): Promise<void>;
}

/** Artifact 存储端口（= CollaborationArtifactRepository 子集）。 */
export type ArtifactStorePort = Pick<
  CollaborationArtifactRepository,
  'submit' | 'listByRun' | 'latest'
>;

export type { PipelineArtifact, SubmitArtifactInput };
