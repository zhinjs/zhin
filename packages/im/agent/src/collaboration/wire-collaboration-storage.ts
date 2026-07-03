/**
 * Wire collaboration_scenes + collaboration_scene_members after database is ready.
 */
import {
  createCollaborationSceneRepository,
  setCollaborationSceneRepository,
} from './collaboration-scene-repository.js';
import {
  createCollaborationArtifactRepository,
  setCollaborationArtifactRepository,
} from './collaboration-artifact-repository.js';
import { getCollaborationSceneService, initCollaborationSceneService } from './scene-service.js';
import { rebootstrapEndpointRuntimes } from './bootstrap-agent-runtimes.js';
import {
  createSceneIdentityService,
  setSceneIdentityService,
} from './scene-identity-service.js';

export async function wireCollaborationStorage(
  db: { models?: Map<string, unknown> } | undefined,
  collaborationRaw?: unknown,
): Promise<void> {
  void collaborationRaw;
  const sceneModel = db?.models?.get('collaboration_scenes') as
    | Parameters<typeof createCollaborationSceneRepository>[0]
    | undefined;
  const memberModel = db?.models?.get('collaboration_scene_members') as
    | Parameters<typeof createCollaborationSceneRepository>[1]
    | undefined;
  const artifactModel = db?.models?.get('collaboration_scene_artifacts') as
    | Parameters<typeof createCollaborationArtifactRepository>[0]
    | undefined;
  const repo = createCollaborationSceneRepository(sceneModel, memberModel);
  setCollaborationSceneRepository(repo);
  setCollaborationArtifactRepository(createCollaborationArtifactRepository(artifactModel));
  getCollaborationSceneService().setRepository(repo);

  const aliasModel = db?.models?.get('collaboration_scene_aliases') as
    | Parameters<typeof createSceneIdentityService>[0]
    | undefined;
  const sessionModel = db?.models?.get('collaboration_init_sessions') as
    | Parameters<typeof createSceneIdentityService>[1]
    | undefined;
  const observationModel = db?.models?.get('collaboration_init_observations') as
    | Parameters<typeof createSceneIdentityService>[2]
    | undefined;
  const channelModel = db?.models?.get('collaboration_scene_member_channels') as
    | Parameters<typeof createSceneIdentityService>[3]
    | undefined;
  const sceneSvc = createSceneIdentityService(aliasModel, sessionModel, observationModel, channelModel);
  setSceneIdentityService(sceneSvc);
  await sceneSvc.loadSceneIndex();

  await initCollaborationSceneService();
  await rebootstrapEndpointRuntimes();
}
