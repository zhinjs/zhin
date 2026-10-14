import {
  workroomHostToken,
  type AgentHostEffectSponsorControlPort,
  type AgentHostPortfolioSponsorControlPort,
  type AgentHostWorkroomKnowledgeControlPort,
  type AgentHostWorkroomProfileControlPort,
  type WorkroomDataLifecycleConsoleControlPort,
  type WorkroomRunControlCommand,
} from '@zhin.js/workroom';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import type { WorkroomRuntimeFoundation } from './runtime-foundation.js';

type RootResources = Parameters<RootResourceInstaller>[0]['resources'];

export interface WorkroomHostPublicationOptions {
  readonly signal: AbortSignal;
  readonly resources: RootResources;
  readonly foundation: WorkroomRuntimeFoundation;
}

/** Publishes the Workroom Host port and owns its late-bound Console controls. */
export class WorkroomHostPublication {
  #workroomProfiles?: AgentHostWorkroomProfileControlPort;
  #workroomKnowledge?: AgentHostWorkroomKnowledgeControlPort;
  #portfolioSponsor?: AgentHostPortfolioSponsorControlPort;
  #effectSponsor?: AgentHostEffectSponsorControlPort;
  #dataLifecycle?: WorkroomDataLifecycleConsoleControlPort;

  constructor(options: WorkroomHostPublicationOptions) {
    options.signal.throwIfAborted();
    const { resources, foundation } = options;
    const resolveWorkroomProfiles = () => this.#workroomProfiles;
    const resolveWorkroomKnowledge = () => this.#workroomKnowledge;
    const resolvePortfolioSponsor = () => this.#portfolioSponsor;
    const resolveEffectSponsor = () => this.#effectSponsor;
    const resolveDataLifecycle = () => this.#dataLifecycle;
    resources.provide(workroomHostToken, Object.freeze({
      console: Object.freeze({
        workroom: foundation.runtime,
        workroomControl: Object.freeze({
          execute: (
            command: WorkroomRunControlCommand,
            authenticatedPrincipal: Readonly<{ principalId: string }>,
          ) => foundation.kernel.controlRun(command, authenticatedPrincipal),
        }),
        workroomCatalog: foundation.catalog,
        get workroomProfiles() { return resolveWorkroomProfiles(); },
        get workroomKnowledge() { return resolveWorkroomKnowledge(); },
        get portfolioSponsor() { return resolvePortfolioSponsor(); },
        get effectSponsor() { return resolveEffectSponsor(); },
        get dataLifecycle() { return resolveDataLifecycle(); },
      }),
    }));
  }

  bindWorkroomProfiles(control: AgentHostWorkroomProfileControlPort): void {
    this.#workroomProfiles = bindOnce(this.#workroomProfiles, control, 'Workroom Profile control');
  }

  bindWorkroomKnowledge(control: AgentHostWorkroomKnowledgeControlPort): void {
    this.#workroomKnowledge = bindOnce(this.#workroomKnowledge, control, 'Workroom Knowledge control');
  }

  bindPortfolioSponsor(control: AgentHostPortfolioSponsorControlPort): void {
    this.#portfolioSponsor = bindOnce(this.#portfolioSponsor, control, 'Portfolio Sponsor control');
  }

  bindEffectSponsor(control: AgentHostEffectSponsorControlPort): void {
    this.#effectSponsor = bindOnce(this.#effectSponsor, control, 'Effect Sponsor control');
  }

  bindDataLifecycle(control: WorkroomDataLifecycleConsoleControlPort | undefined): void {
    if (control) this.#dataLifecycle = bindOnce(this.#dataLifecycle, control, 'Data Lifecycle control');
  }

  resolveDataLifecycle(): WorkroomDataLifecycleConsoleControlPort | undefined {
    return this.#dataLifecycle;
  }
}

function bindOnce<T>(current: T | undefined, value: T, name: string): T {
  if (current) throw new Error(`${name} is already bound`);
  return value;
}
