/**
 * Wire collaboration_cells + collaboration_cell_members after database is ready.
 */
import {
  createCollaborationCellRepository,
  setCollaborationCellRepository,
} from './collaboration-cell-repository.js';
import {
  createCollaborationArtifactRepository,
  setCollaborationArtifactRepository,
} from './collaboration-artifact-repository.js';
import { getCollaborationCellService, initCollaborationCellService } from './cell-service.js';
import { rebootstrapEndpointRuntimes } from './bootstrap-agent-runtimes.js';
import { upgradeCollaborationDbSchema, asAgentDbQueryable, registerCollaborationRoundStateMigrationHook } from '../init/upgrade-collaboration-db-schema.js';
import type { AgentDbQueryable } from '../init/upgrade-agent-db-schema.js';
import {
  createSceneIdentityService,
  setSceneIdentityService,
} from './scene-identity-service.js';

export async function wireCollaborationStorage(
  db: { models?: Map<string, unknown> } | undefined,
  collaborationRaw?: unknown,
): Promise<void> {
  if (db) {
    const added = await upgradeCollaborationDbSchema(asAgentDbQueryable(db));
    if (added.length > 0) {
      // eslint-disable-next-line no-console
      console.info(`Collaboration: migrated columns: ${added.join(', ')}`);
    }
  }
  const cellModel = db?.models?.get('collaboration_cells') as
    | Parameters<typeof createCollaborationCellRepository>[0]
    | undefined;
  const memberModel = db?.models?.get('collaboration_cell_members') as
    | Parameters<typeof createCollaborationCellRepository>[1]
    | undefined;
  const artifactModel = db?.models?.get('collaboration_cell_artifacts') as
    | Parameters<typeof createCollaborationArtifactRepository>[0]
    | undefined;
  const repo = createCollaborationCellRepository(cellModel, memberModel);
  setCollaborationCellRepository(repo);
  setCollaborationArtifactRepository(createCollaborationArtifactRepository(artifactModel));
  getCollaborationCellService().setRepository(repo);

  const sceneModel = db?.models?.get('collaboration_cell_scenes') as
    | Parameters<typeof createSceneIdentityService>[0]
    | undefined;
  const sessionModel = db?.models?.get('collaboration_init_sessions') as
    | Parameters<typeof createSceneIdentityService>[1]
    | undefined;
  const observationModel = db?.models?.get('collaboration_init_observations') as
    | Parameters<typeof createSceneIdentityService>[2]
    | undefined;
  const channelModel = db?.models?.get('collaboration_cell_member_channels') as
    | Parameters<typeof createSceneIdentityService>[3]
    | undefined;
  const sceneSvc = createSceneIdentityService(sceneModel, sessionModel, observationModel, channelModel);
  setSceneIdentityService(sceneSvc);
  await sceneSvc.loadSceneIndex();

  await initCollaborationCellService();
  await rebootstrapEndpointRuntimes();
}
