import {
  ActivatableWorkroomCatalog,
  ActivatableWorkroomJournal,
  WorkroomKernel,
  createCatalogWorkroomRunControlAuthority,
  type WorkroomPlanGateAuthorityPort,
} from '@zhin.js/agent';
import {
  CatalogWorkroomPriorityAuthority,
  GenerationWorkroomPriorityAuthority,
  createCatalogGovernedWorkroomProjectionAuthority,
  createCatalogWorkroomPlanGateAuthority,
  createGenerationOwnedWorkroomJournalPayloadPort,
  createGenerationWorkroomAcceptanceAuthority,
  createGenerationWorkroomAcceptancePolicyPort,
  createGenerationWorkroomLocalAssignmentAuthority,
  createGenerationWorkroomPlanGateAuthority,
  createGenerationWorkroomRemoteAssignmentAuthority,
  createWorkroomRuntime,
  installWorkroomDataGovernanceResources,
  workroomAcceptanceAuthorityToken,
  workroomAcceptancePolicyDecisionToken,
  workroomDynamicPlanningPolicyToken,
  workroomLocalAssignmentAuthorityToken,
  workroomPlanGateAuthorityToken,
  workroomPlanningDisclosureToken,
  workroomPriorityAuthorityToken,
  workroomRemoteAssignmentAuthorityToken,
  type WorkroomDynamicPlanningPolicyPort,
  type WorkroomPlanningDisclosurePort,
} from '@zhin.js/agent/runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import type { Token } from '@zhin.js/plugin-runtime';

type RootResources = Parameters<RootResourceInstaller>[0]['resources'];
type DataGovernanceRuntime = ReturnType<typeof installWorkroomDataGovernanceResources>;
type GovernanceProject = Awaited<ReturnType<
  DataGovernanceRuntime['options']['repository']['readProject']
>>;

export interface WorkroomRuntimeFoundationOptions {
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly resources: RootResources;
  readonly planGateAuthority?: WorkroomPlanGateAuthorityPort;
  readonly planningDisclosure?: WorkroomPlanningDisclosurePort;
  readonly dynamicPlanningPolicy?: WorkroomDynamicPlanningPolicyPort;
}

/**
 * Owns the generation-scoped Workroom journal, catalog, Kernel, and their
 * authority projections. Data governance is attached exactly once after its
 * storage composition has been constructed.
 */
export class WorkroomRuntimeFoundation {
  readonly journal = new ActivatableWorkroomJournal();
  readonly catalog = new ActivatableWorkroomCatalog();
  readonly journalPayloads;
  readonly kernel: WorkroomKernel;
  readonly governance: Readonly<{
    readProject(projectId: string): Promise<GovernanceProject | undefined>;
  }>;
  readonly consoleProjectionAuthority;
  readonly runtime;

  #dataGovernance?: DataGovernanceRuntime;

  constructor(private readonly options: WorkroomRuntimeFoundationOptions) {
    this.journalPayloads = createGenerationOwnedWorkroomJournalPayloadPort({
      generation: options.generation,
      signal: options.signal,
    });
    this.#publishAuthorities();
    this.kernel = new WorkroomKernel({
      journal: this.journal,
      acceptancePolicy: createGenerationWorkroomAcceptancePolicyPort(() =>
        this.#use(workroomAcceptancePolicyDecisionToken)),
      acceptanceAuthority: createGenerationWorkroomAcceptanceAuthority(() =>
        this.#use(workroomAcceptanceAuthorityToken)),
      remoteAssignmentAuthority: createGenerationWorkroomRemoteAssignmentAuthority(() =>
        this.#use(workroomRemoteAssignmentAuthorityToken)),
      localAssignmentAuthority: createGenerationWorkroomLocalAssignmentAuthority(() =>
        this.#use(workroomLocalAssignmentAuthorityToken)),
      planGateAuthority: createGenerationWorkroomPlanGateAuthority(() =>
        this.#use(workroomPlanGateAuthorityToken)),
      priorityAuthority: new GenerationWorkroomPriorityAuthority(() =>
        this.#use(workroomPriorityAuthorityToken)),
      runControlAuthority: createCatalogWorkroomRunControlAuthority(this.catalog),
    });
    this.governance = Object.freeze({
      readProject: async (projectId: string) =>
        await this.#dataGovernance?.options.repository.readProject(projectId),
    });
    this.consoleProjectionAuthority = createCatalogGovernedWorkroomProjectionAuthority({
      catalog: this.catalog,
      governance: this.governance,
    });
    this.runtime = createWorkroomRuntime(this.journal, this.consoleProjectionAuthority);
  }

  bindDataGovernance(runtime: DataGovernanceRuntime): void {
    if (this.#dataGovernance) {
      throw new Error('Workroom data governance runtime is already bound');
    }
    this.journalPayloads.activate(runtime.journalPayloads);
    this.#dataGovernance = runtime;
  }

  #publishAuthorities(): void {
    const { resources } = this.options;
    if (!resources.has(workroomPlanGateAuthorityToken)) {
      resources.provide(
        workroomPlanGateAuthorityToken,
        this.options.planGateAuthority ?? createCatalogWorkroomPlanGateAuthority(this.catalog),
      );
    }
    if (!resources.has(workroomPriorityAuthorityToken)) {
      resources.provide(
        workroomPriorityAuthorityToken,
        new CatalogWorkroomPriorityAuthority(this.catalog),
      );
    }
    if (this.options.planningDisclosure
      && !resources.has(workroomPlanningDisclosureToken)) {
      resources.provide(workroomPlanningDisclosureToken, this.options.planningDisclosure);
    }
    if (this.options.dynamicPlanningPolicy
      && !resources.has(workroomDynamicPlanningPolicyToken)) {
      resources.provide(workroomDynamicPlanningPolicyToken, this.options.dynamicPlanningPolicy);
    }
  }

  #use<TValue>(token: Token<TValue>): TValue | undefined {
    return this.options.resources.has(token)
      ? this.options.resources.use(token)
      : undefined;
  }
}
