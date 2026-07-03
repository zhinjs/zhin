/**
 * Pipeline 六边形端口（ADR 0024 架构师建议 #2）——便于单测 mock。
 */
import type { CollaborationScene, PipelineArtifact, PipelineState } from '../../collaboration/types.js';
import type {
  CollaborationArtifactRepository,
  SubmitArtifactInput,
} from '../../collaboration/collaboration-artifact-repository.js';

/** Cell 状态读写端口。 */
export interface CellStatePort {
  getScene(collaborationSceneId: string): CollaborationScene | undefined;
  getSceneFresh?(collaborationSceneId: string): Promise<CollaborationScene | undefined>;
  setPipelineState(collaborationSceneId: string, state: PipelineState): Promise<void>;
  setMissionRunId?(collaborationSceneId: string, runId: string): Promise<void>;
}

/** Artifact 存储端口（= CollaborationArtifactRepository 子集）。 */
export type ArtifactStorePort = Pick<
  CollaborationArtifactRepository,
  'submit' | 'listByRun' | 'latest'
>;

export type { PipelineArtifact, SubmitArtifactInput };
