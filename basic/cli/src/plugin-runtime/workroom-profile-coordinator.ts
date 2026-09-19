import { join } from 'node:path';
import type {
  ActivatableWorkroomCatalog,
  ActivatableWorkroomJournal,
} from '@zhin.js/agent';
import {
  JournalWorkroomRunProfilePinAuthority,
  KernelPlanAdmissionRunProfilePinWriter,
  PinnedProfileWorkroomAcceptanceProjectionSource,
  createCatalogWorkroomProfilePublisherAuthority,
  createWorkroomGenerationAuthoritySnapshotFromRuntime,
  createWorkroomProfileGenerationView,
  installWorkroomProfileAuthorityResources,
  workroomAcceptanceProjectionSourceAuthorityToken,
} from '@zhin.js/agent/runtime';
import type { SnapshotReader } from '@zhin.js/plugin-runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';

type RootResources = Parameters<RootResourceInstaller>[0]['resources'];
type GenerationBindings = Parameters<
  typeof createWorkroomGenerationAuthoritySnapshotFromRuntime
>[1];

export interface WorkroomProfileCoordinatorOptions {
  readonly projectRoot: string;
  readonly stateRoot: string;
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly resources: RootResources;
  readonly snapshots?: SnapshotReader;
  readonly journal: ActivatableWorkroomJournal;
  readonly catalog: ActivatableWorkroomCatalog;
  readonly trustedPackPublishers?: readonly string[];
  readonly listBindings: () => GenerationBindings;
}

/** Owns Profile publication authority, generation views, run pins, and acceptance projection. */
export class WorkroomProfileCoordinator {
  readonly composition: ReturnType<typeof installWorkroomProfileAuthorityResources>;
  readonly profiles: ReturnType<typeof installWorkroomProfileAuthorityResources>['profiles'];
  readonly runPinWriter: KernelPlanAdmissionRunProfilePinWriter;
  readonly acceptanceSource: PinnedProfileWorkroomAcceptanceProjectionSource;

  constructor(options: WorkroomProfileCoordinatorOptions) {
    if (!options.snapshots) {
      throw new Error('Workroom Profile authority requires the process-owned SnapshotReader');
    }
    const runPinAuthority = new JournalWorkroomRunProfilePinAuthority({
      generation: options.generation,
      journal: options.journal,
    });
    const authority = createCatalogWorkroomProfilePublisherAuthority({
      catalog: options.catalog,
      trustedPackPublishers: options.trustedPackPublishers ?? [],
      decisionDirectory: join(options.stateRoot, 'workroom-profile-authority-decisions'),
    });
    this.composition = installWorkroomProfileAuthorityResources({
      projectRoot: options.projectRoot,
      generation: options.generation,
      signal: options.signal,
      snapshots: options.snapshots,
      resources: options.resources,
      authority,
      runPinAuthority,
      resolveGenerationView: snapshot => {
        const generationAuthority = createWorkroomGenerationAuthoritySnapshotFromRuntime(
          snapshot,
          options.listBindings(),
        );
        return createWorkroomProfileGenerationView({
          generation: generationAuthority.generation,
          tools: generationAuthority.tools.map(tool => ({ id: tool.name, digest: tool.digest })),
          skills: generationAuthority.skills.map(skill => ({ id: skill.name, digest: skill.digest })),
          agents: generationAuthority.agents.map(agent => ({ id: agent.id, digest: agent.digest })),
        });
      },
    });
    this.profiles = this.composition.profiles;
    this.runPinWriter = new KernelPlanAdmissionRunProfilePinWriter({
      authority: runPinAuthority,
      profiles: this.profiles,
      runPins: this.composition.runPins,
    });
    this.acceptanceSource = new PinnedProfileWorkroomAcceptanceProjectionSource({
      profiles: this.profiles,
      catalog: options.catalog,
    });
    if (!options.resources.has(workroomAcceptanceProjectionSourceAuthorityToken)) {
      options.resources.provide(
        workroomAcceptanceProjectionSourceAuthorityToken,
        this.acceptanceSource,
      );
    }
  }
}
