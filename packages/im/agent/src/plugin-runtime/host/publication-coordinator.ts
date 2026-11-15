import { join } from 'node:path';
import { rootPluginId, type RootResourceInstaller } from '@zhin.js/plugin-runtime';
import {
  reconstructBoardFromEvents,
  summarizeEngagementEvents,
  type BoardEntry,
  type EngagementEvent,
  type EngagementSummary,
} from '@zhin.js/harness';
import { FileJournalStore, type ContextFile, type TurnRequest } from '../../index.js';
import {
  agentHostToken,
  agentTurnEngineToken,
  createFullAgentTurnEngine,
  turnJournalStoreToken,
  type AgentRuntime,
} from '../index.js';
import { observeAgentTurnTrace } from '../ingress/ports.js';
import type { AgentRuntimeFoundation } from './runtime-foundation.js';
import type { AgentHostMcpSummary } from '../agent-host-port.js';
import type { HostMcpStatusBoard } from '../host-mcp-status.js';
import type { McpServerEntry } from '../../resource-hub/types.js';

type RootResources = Parameters<RootResourceInstaller>[0]['resources'];

export interface AgentHostPublicationCoordinatorOptions {
  readonly projectRoot: string;
  readonly signal: AbortSignal;
  readonly resources: RootResources;
  readonly processRuntime: AgentRuntime;
  readonly agent: AgentRuntimeFoundation;
  readonly bootstrapText: string;
  readonly contextFiles?: readonly ContextFile[];
  /**
   * Configured MCP servers (`ai.mcpServers`) and their connect outcomes (#1250). They run as
   * generation-owned MCP features, not in `resourceHub.mcps`, so introspection reads them here.
   */
  readonly mcp?: Readonly<{ entries: readonly McpServerEntry[]; status: HostMcpStatusBoard }>;
  /** Live bootstrap the host re-reads when its files change (#1250); overrides the two above. */
  readonly bootstrap?: () => Readonly<{ bootstrapContext: string; contextFiles?: readonly ContextFile[] }>;
}

/** Publishes the Agent Host ports for protocol, introspection, and Console. */
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
        listConfiguredBindingNames: () => Object.freeze(service.getBindingRegistry().listConfiguredBindingNames()),
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
        listMcpServers: () => {
          const rows = new Map<string, AgentHostMcpSummary>();
          for (const entry of options.mcp?.entries ?? []) rows.set(entry.name, options.mcp!.status.summary(entry.name));
          // Servers added to the Agent's own registry at run time (not from `ai.mcpServers`).
          for (const entry of resourceHub.mcps.getAll()) {
            if (rows.has(entry.name)) continue;
            const connected = resourceHub.mcps.isConnected(entry.name);
            const lastError = connected ? undefined : resourceHub.mcps.getLastFailure(entry.name);
            rows.set(entry.name, Object.freeze({
              name: entry.name,
              connected,
              toolCount: resourceHub.mcps.getToolsFromServer(entry.name).length,
              ...(lastError ? { lastError } : {}),
            }));
          }
          return Object.freeze([...rows.values()]);
        },
        testMcpServer: async (name: string) => {
          const entry = options.mcp?.entries.find(candidate => candidate.name === name);
          return entry ? await options.mcp!.status.probe(entry) : undefined;
        },
      }),
      console: Object.freeze({
        sessionTree: sessionTreeRuntime,
        listBindings: () => agent.listBindings(),
        assistant: schedule.assistantRuntime,
        scheduleExecutions: schedule.history,
        trace: traceRuntime,
        cancelSession: (sessionKey: string) => agent.agent.cancelSession(sessionKey),
        engagements: Object.freeze({
          list: async (limit = 50): Promise<readonly EngagementSummary[]> => {
            const journal = agent.engagementJournal;
            if (!journal) return Object.freeze([]);
            const ids = await journal.listEngagements(limit);
            const summaries: EngagementSummary[] = [];
            for (const id of ids) {
              const summary = journal.summarize
                ? await journal.summarize(id)
                : summarizeEngagementEvents(id, await journal.read(id));
              if (summary) summaries.push(summary);
            }
            return Object.freeze(summaries);
          },
          get: async (id: string): Promise<Readonly<{
            summary: EngagementSummary;
            events: readonly EngagementEvent[];
            board: readonly BoardEntry[];
          }> | null> => {
            const journal = agent.engagementJournal;
            if (!journal) return null;
            const events = await journal.read(id);
            if (events.length === 0) return null;
            const summary = (journal.summarize ? await journal.summarize(id) : undefined)
              ?? summarizeEngagementEvents(id, events);
            const board = reconstructBoardFromEvents(events);
            return Object.freeze({ summary, events, board });
          },
        }),
        venues: Object.freeze({
          list: () => agent.venues ?? Object.freeze([]),
        }),
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
      contextFiles: options.contextFiles,
      ...(options.bootstrap ? { bootstrap: options.bootstrap } : {}),
      ...(agent.knowledgeIndex ? { knowledgeIndex: agent.knowledgeIndex } : {}),
    }));
  }
}
