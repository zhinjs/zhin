import type { ConsoleAgentRuntime } from '@zhin.js/host-http';
import type { RuntimeSnapshot, SnapshotReader } from '@zhin.js/plugin-runtime';
import {
  resolveCurrentAgentConsole,
  resolveCurrentAgentIntrospection,
} from './agent-console.js';
import { AgentConfigProjection } from './agent-config-projection.js';
import {
  listGenerationCommands,
  listGenerationComponents,
  listGenerationMiddlewares,
  listGenerationPromptSections,
  listGenerationTools,
  renderGenerationComponent,
  previewGenerationComponentDelivery,
} from './agent-feature-projection.js';

function createAgentRuntime(
  projectRoot: string,
  getSnapshot: () => RuntimeSnapshot,
): ConsoleAgentRuntime {
  const configuration = new AgentConfigProjection(projectRoot);
  return {
    sessionTree: resolveCurrentAgentConsole(getSnapshot())?.sessionTree,
    introspection: {
      commands: () => listGenerationCommands(getSnapshot(), projectRoot),
      middlewares: () => listGenerationMiddlewares(getSnapshot(), projectRoot),
      components: () => listGenerationComponents(getSnapshot(), projectRoot),
      renderComponent: input => renderGenerationComponent(getSnapshot(), input),
      previewComponentDelivery: input => previewGenerationComponentDelivery(getSnapshot(), input),
      bindings: () => configuration.listBindings(),
      tools: () => listGenerationTools(getSnapshot(), projectRoot),
      promptSections: () => listGenerationPromptSections(getSnapshot(), projectRoot),
      mcp: () => mergeMcpServers(configuration, getSnapshot()),
    },
  };
}

export function createAgentRuntimeLeaseResolver(
  projectRoot: string,
  snapshots?: SnapshotReader,
): (() => { value: ConsoleAgentRuntime; release(): void } | null) | undefined {
  if (!snapshots) return undefined;
  return () => {
    let lease: ReturnType<SnapshotReader['acquire']>;
    try {
      lease = snapshots.acquire();
    } catch {
      return null;
    }
    return {
      value: createAgentRuntime(projectRoot, () => lease.value),
      release: () => lease.release(),
    };
  };
}

/** Configured MCP servers (not connected until the Agent reports them) merged with the Agent's live view. */
export function listMcpServerStatus(projectRoot: string, snapshot: RuntimeSnapshot): readonly Record<string, unknown>[] {
  return mergeMcpServers(new AgentConfigProjection(projectRoot), snapshot).rows;
}

/**
 * Row `status` (#1250), so a "not connected" row always says why:
 * - `connected`: the Agent holds a live connection;
 * - `failed`: the last connect failed — `lastError` carries `{ category, message, exitCode?, at }`;
 * - `idle`: loaded by the Agent but not connected yet (MCP connects lazily, on the first turn that uses it);
 * - `not_loaded`: in the configuration but not loaded by the running Agent (Agent off, or not reloaded yet).
 */
export type McpServerRowStatus = 'connected' | 'failed' | 'idle' | 'not_loaded';

function mergeMcpServers(
  configuration: AgentConfigProjection,
  snapshot: RuntimeSnapshot,
): { rows: readonly Record<string, unknown>[] } {
  const rows = new Map<string, Record<string, unknown>>();
  for (const entry of configuration.listMcpServers()) {
    rows.set(entry.name, {
      name: entry.name,
      connected: false,
      toolCount: 0,
      transport: entry.transport,
      status: 'not_loaded' satisfies McpServerRowStatus,
    });
  }
  const introspection = resolveCurrentAgentIntrospection(snapshot);
  for (const entry of introspection?.listMcpServers() ?? []) {
    const configured = rows.get(entry.name);
    const status: McpServerRowStatus = entry.connected ? 'connected' : entry.lastError ? 'failed' : 'idle';
    rows.set(entry.name, {
      name: entry.name,
      connected: entry.connected,
      toolCount: entry.toolCount,
      ...(configured?.transport === undefined ? {} : { transport: configured.transport }),
      status,
      ...(!entry.connected && entry.lastError ? { lastError: entry.lastError } : {}),
    });
  }
  return { rows: [...rows.values()] };
}
