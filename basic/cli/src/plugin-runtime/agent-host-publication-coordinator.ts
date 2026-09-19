import { join } from 'node:path';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import { FileJournalStore, type TurnRequest } from '@zhin.js/agent';
import {
  agentHostToken,
  agentTurnEngineToken,
  createFullAgentTurnEngine,
  turnJournalStoreToken,
  type AgentHostEffectSponsorControlPort,
  type AgentHostPortfolioSponsorControlPort,
  type AgentHostWorkroomKnowledgeControlPort,
  type AgentHostWorkroomProfileControlPort,
  type AgentRuntime,
  type WorkroomDataLifecycleConsoleControlPort,
  type WorkroomRunControlCommand,
} from '@zhin.js/agent/runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import { observeAgentTurnTrace } from './agent-runtime-factory.js';
import type { AgentRuntimeFoundation } from './agent-runtime-foundation.js';
import type { WorkroomRuntimeFoundation } from './workroom-runtime-foundation.js';

type RootResources = Parameters<RootResourceInstaller>[0]['resources'];

export interface AgentHostPublicationCoordinatorOptions {
  readonly projectRoot: string;
  readonly signal: AbortSignal;
  readonly resources: RootResources;
  readonly processRuntime: AgentRuntime;
  readonly agent: AgentRuntimeFoundation;
  readonly workroom: WorkroomRuntimeFoundation;
  readonly bootstrapText: string;
}

/** Publishes the Agent Host ports and owns their late-bound Console controls. */
export class AgentHostPublicationCoordinator {
  #workroomProfiles?: AgentHostWorkroomProfileControlPort;
  #workroomKnowledge?: AgentHostWorkroomKnowledgeControlPort;
  #portfolioSponsor?: AgentHostPortfolioSponsorControlPort;
  #effectSponsor?: AgentHostEffectSponsorControlPort;
  #dataLifecycle?: WorkroomDataLifecycleConsoleControlPort;

  constructor(options: AgentHostPublicationCoordinatorOptions) {
    options.signal.throwIfAborted();
    const { resources, agent, workroom } = options;
    const { service, composition, traceRuntime, schedule, sessionTreeRuntime } = agent;
    const resourceHub = agent.agent.resourceHub;
    if (!resourceHub) {
      throw new Error('Agent Host requires a ready AgentResourceHub before generation publication');
    }
    const resolveWorkroomProfiles = () => this.#workroomProfiles;
    const resolveWorkroomKnowledge = () => this.#workroomKnowledge;
    const resolvePortfolioSponsor = () => this.#portfolioSponsor;
    const resolveEffectSponsor = () => this.#effectSponsor;
    const resolveDataLifecycle = () => this.#dataLifecycle;
    resources.provide(agentHostToken, Object.freeze({
      protocol: Object.freeze({
        listBindings: () => agent.listBindings(),
        execute: (bindingName: string, request: TurnRequest) => {
          const selected = service.getBindingRegistry().getBinding(bindingName);
          if (!selected) throw new Error(`Agent binding not found: ${bindingName}`);
          return options.processRuntime.execute(rootPluginId(), request, {
            binding: selected,
            mcpServers: selected.mcpServers,
            ...(selected.name === 'zhin' ? {} : { agent: selected.name }),
          }, observeAgentTurnTrace(traceRuntime, request));
        },
      }),
      introspection: Object.freeze({
        listMcpServers: () => resourceHub.mcps.getAll().map((entry) => Object.freeze({
          name: entry.name,
          connected: resourceHub.mcps.isConnected(entry.name),
          toolCount: resourceHub.mcps.getToolsFromServer(entry.name).length,
        })),
      }),
      console: Object.freeze({
        sessionTree: sessionTreeRuntime,
        workroom: workroom.runtime,
        workroomControl: Object.freeze({
          execute: (
            command: WorkroomRunControlCommand,
            authenticatedPrincipal: Readonly<{ principalId: string }>,
          ) => workroom.kernel.controlRun(command, authenticatedPrincipal),
        }),
        workroomCatalog: workroom.catalog,
        listBindings: () => agent.listBindings(),
        assistant: schedule.assistantRuntime,
        trace: traceRuntime,
        cancelSession: (sessionKey: string) => agent.agent.cancelSession(sessionKey),
        get workroomProfiles() { return resolveWorkroomProfiles(); },
        get workroomKnowledge() { return resolveWorkroomKnowledge(); },
        get portfolioSponsor() { return resolvePortfolioSponsor(); },
        get effectSponsor() { return resolveEffectSponsor(); },
        get dataLifecycle() { return resolveDataLifecycle(); },
      }),
    }));
    resources.provide(
      turnJournalStoreToken,
      new FileJournalStore(join(options.projectRoot, '.zhin', 'agent-journal')),
    );
    resources.provide(agentTurnEngineToken, createFullAgentTurnEngine({
      host: composition.host,
      core: composition.agentCore,
      sessionSystem: composition.sessionSystem,
      contextSystem: composition.contextSystem,
      loopHooks: service.loopHooks,
      bootstrapContext: options.bootstrapText,
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
