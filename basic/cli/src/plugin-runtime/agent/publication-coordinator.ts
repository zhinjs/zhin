import { join } from 'node:path';
import { rootPluginId } from '@zhin.js/plugin-runtime';
import { FileJournalStore, type TurnRequest } from '@zhin.js/agent';
import {
  agentHostToken,
  agentTurnEngineToken,
  createFullAgentTurnEngine,
  turnJournalStoreToken,
  type AgentRuntime,
} from '@zhin.js/agent/runtime';
import type { RootResourceInstaller } from '@zhin.js/runtime';
import { observeAgentTurnTrace } from './runtime-factory.js';
import type { AgentRuntimeFoundation } from './runtime-foundation.js';

type RootResources = Parameters<RootResourceInstaller>[0]['resources'];

export interface AgentHostPublicationCoordinatorOptions {
  readonly projectRoot: string;
  readonly signal: AbortSignal;
  readonly resources: RootResources;
  readonly processRuntime: AgentRuntime;
  readonly agent: AgentRuntimeFoundation;
  readonly bootstrapText: string;
}

/** Publishes the Agent Host ports. Workroom ports are published separately and only when installed. */
export class AgentHostPublicationCoordinator {
  constructor(options: AgentHostPublicationCoordinatorOptions) {
    options.signal.throwIfAborted();
    const { resources, agent } = options;
    const { service, composition, traceRuntime, schedule, sessionTreeRuntime } = agent;
    const resourceHub = agent.agent.resourceHub;
    if (!resourceHub) {
      throw new Error('Agent Host requires a ready AgentResourceHub before generation publication');
    }
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
        listBindings: () => agent.listBindings(),
        assistant: schedule.assistantRuntime,
        trace: traceRuntime,
        cancelSession: (sessionKey: string) => agent.agent.cancelSession(sessionKey),
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
}
