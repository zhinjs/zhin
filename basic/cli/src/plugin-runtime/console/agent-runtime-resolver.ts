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
    });
  }
  const introspection = resolveCurrentAgentIntrospection(snapshot);
  for (const entry of introspection?.listMcpServers() ?? []) {
    rows.set(entry.name, {
      name: entry.name,
      connected: entry.connected,
      toolCount: entry.toolCount,
    });
  }
  return { rows: [...rows.values()] };
}
