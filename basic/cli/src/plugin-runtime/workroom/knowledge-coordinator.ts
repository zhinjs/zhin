import { join } from 'node:path';
import { ProjectKnowledgeRegistry } from '@zhin.js/agent';
import {
  WorkroomAssignmentKnowledgeContextProjector,
  createCatalogProjectKnowledgeSourceAuthority,
  createGenerationWorkroomEphemeralAssignmentContext,
  createP12WorkroomKnowledgeContentReader,
  workroomAssignmentKnowledgeContextToken,
  workroomEphemeralAssignmentContextToken,
  type AgentHostWorkroomKnowledgeControlPort,
} from '@zhin.js/agent/runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import type { WorkroomDataGovernanceCoordinator } from './data-governance-coordinator.js';
import type { WorkroomPersistenceCoordinator } from './persistence-coordinator.js';
import type { WorkroomProfileCoordinator } from './profile-coordinator.js';
import type { WorkroomRuntimeFoundation } from './runtime-foundation.js';

type RootResourceContext = Parameters<RootResourceInstaller>[0];
type EphemeralAssignmentContext = ReturnType<typeof createGenerationWorkroomEphemeralAssignmentContext>;

export interface WorkroomKnowledgeCoordinatorOptions {
  readonly stateRoot: string;
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly resources: RootResourceContext['resources'];
  readonly lifecycle: RootResourceContext['lifecycle'];
  readonly runtime: WorkroomRuntimeFoundation;
  readonly profiles: WorkroomProfileCoordinator;
  readonly governance: WorkroomDataGovernanceCoordinator;
  readonly persistence: WorkroomPersistenceCoordinator;
}

/** Owns governed Project Knowledge, Assignment projection, and Sponsor control. */
export class WorkroomKnowledgeCoordinator {
  readonly ephemeralAssignmentContext: EphemeralAssignmentContext;
  readonly consoleControl: AgentHostWorkroomKnowledgeControlPort;

  constructor(options: WorkroomKnowledgeCoordinatorOptions) {
    const { generation, signal, resources, lifecycle } = options;
    signal.throwIfAborted();
    const workroomCatalog = options.runtime.catalog;
    const projectProfiles = options.profiles.profiles;
    const snapshots = options.profiles.snapshots;
    const projectKnowledgeJournal = options.persistence.projectKnowledgeJournal;
    const dataGovernanceRuntime = options.governance.runtime;
    const knowledgeSourceAuthority = createCatalogProjectKnowledgeSourceAuthority({
      catalog: workroomCatalog,
      directory: join(options.stateRoot, 'workroom-project-knowledge-authority'),
    });
    const projectKnowledge = new ProjectKnowledgeRegistry({
      journal: projectKnowledgeJournal,
      sourceAuthority: knowledgeSourceAuthority,
      generationView: Object.freeze({
        async withCurrent<TResult>(operation: Readonly<{
          generation: number; operationId: string; signal: AbortSignal;
        }>, use: () => TResult | Promise<TResult>): Promise<TResult> {
          operation.signal.throwIfAborted();
          if (operation.generation !== generation) {
            throw new Error('Project Knowledge operation targets another Root generation');
          }
          const lease = snapshots.acquire();
          try {
            if (!snapshots.owns(lease) || lease.value.generation !== generation) {
              throw new Error('Project Knowledge generation is no longer current');
            }
            return await use();
          } finally {
            lease.release();
          }
        },
      }),
    });
    this.ephemeralAssignmentContext = createGenerationWorkroomEphemeralAssignmentContext({
      generation,
      signal,
    });
    const assignmentKnowledge = new WorkroomAssignmentKnowledgeContextProjector({
      profiles: projectProfiles,
      knowledge: projectKnowledge,
      contentReader: createP12WorkroomKnowledgeContentReader({
        governance: dataGovernanceRuntime.disclosureManifest,
        signal,
      }),
      publisher: this.ephemeralAssignmentContext,
    });
    resources.provide(workroomEphemeralAssignmentContextToken, this.ephemeralAssignmentContext);
    resources.provide(workroomAssignmentKnowledgeContextToken, assignmentKnowledge);
    lifecycle.add(() => this.ephemeralAssignmentContext.dispose());
    this.consoleControl = Object.freeze({
      read: (projectId: string) => projectKnowledge.read(projectId),
      publish: async (
        command: Parameters<AgentHostWorkroomKnowledgeControlPort['publish']>[0],
        authenticatedPrincipal: Parameters<AgentHostWorkroomKnowledgeControlPort['publish']>[1],
      ) => {
        const source = await knowledgeSourceAuthority.issueSponsorDecision({
          operationId: command.operationId,
          projectId: command.projectId,
          principalId: authenticatedPrincipal.principalId,
        });
        return await projectKnowledge.publish({
          ...structuredClone(command),
          version: 1,
          generation,
          ownerPrincipalId: authenticatedPrincipal.principalId,
          source,
        }, signal);
      },
      rollback: async (
        command: Parameters<AgentHostWorkroomKnowledgeControlPort['rollback']>[0],
        authenticatedPrincipal: Parameters<AgentHostWorkroomKnowledgeControlPort['rollback']>[1],
      ) => {
        const source = await knowledgeSourceAuthority.issueSponsorDecision({
          operationId: command.operationId,
          projectId: command.projectId,
          principalId: authenticatedPrincipal.principalId,
        });
        return await projectKnowledge.rollback({
          ...structuredClone(command),
          version: 1,
          generation,
          ownerPrincipalId: authenticatedPrincipal.principalId,
          source,
        }, signal);
      },
    });
  }
}
