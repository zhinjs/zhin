import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { commandFeatureId, isCommandIndex } from '@zhin.js/command';
import { componentFeatureId, isComponentIndex } from '@zhin.js/component';
import { isMiddlewareIndex, middlewareFeatureId } from '@zhin.js/middleware';
import { isPromptSectionIndex, promptSectionFeatureId } from '@zhin.js/prompt-section';
import type {
  ConsoleAgentRuntime,
  ConsoleWorkroomKnowledgeControlPort,
  ConsoleWorkroomProfileControlPort,
} from '@zhin.js/host-http';
import type {
  PortfolioSponsorProjection,
  WorkroomDefinition,
} from '@zhin.js/agent';
import type {
  AgentHostWorkroomRunControlPort,
  PortfolioSponsorCommand,
  WorkroomDataLifecycleConsoleControlPort,
  WorkroomEffectSponsorDecisionCommand,
  WorkroomEffectSponsorDecisionRecord,
  WorkroomRuntimeHandle,
} from '@zhin.js/agent/runtime';
import type { PluginId, RuntimeSnapshot, SnapshotReader, TokenId } from '@zhin.js/plugin-runtime';
import { displayConsolePath } from './projection.js';

/**
 * 新 Runtime 的 agent 门面。Session tree 仍由独立服务端口提供；Agent 本体只从
 * 当前 generation snapshot 的 agentHostToken 解析。模块按请求惰性加载，agent
 * 未安装/未 init 时降级（host-http 返回 503 / 空列表 + note）。
 */
let agentModule: {
  agentHostToken?: { readonly id: TokenId };
} | null | undefined;

void import('@zhin.js/agent/runtime')
  .then((runtime) => { agentModule = runtime as typeof agentModule; })
  .catch(() => { agentModule = null; });

function createAgentRuntimeResolver(
  projectRoot: string,
  getSnapshot?: () => RuntimeSnapshot | undefined,
): () => ConsoleAgentRuntime | undefined {
  const display = (value: string) => displayConsolePath(value, projectRoot);
  return () => ({
    sessionTree: resolveAgentConsole(getSnapshot)?.sessionTree,
    introspection: {
      commands: () => {
        const snap = getSnapshot?.();
        if (!snap) return [];
        const index = snap.projections.get(commandFeatureId);
        if (!isCommandIndex(index)) return [];
        return index.list().map((command) => ({
          pattern: command.name,
          desc: command.description ?? '',
          // source 常为绝对路径；控制台展示遵循 workspace→./…、HOME→~/…
          plugin: display(command.source),
          parameters: command.parameters.map((parameter) => ({
            name: parameter.name,
            type: parameter.type,
            required: parameter.required,
            optional: parameter.optional ?? !parameter.required,
            rest: parameter.rest ?? false,
            description: parameter.description ?? '',
            ...(parameter.defaultValue === undefined
              ? {}
              : typeof parameter.defaultValue === 'function'
                ? { default: '<dynamic>', defaultKind: 'dynamic' }
                : { default: parameter.defaultValue, defaultKind: 'literal' }),
          })),
          aliases: command.alias ?? [],
          permissions: command.permit ?? [],
          shortcuts: command.shortcut ?? [],
        }));
      },
      middlewares: () => {
        const snap = getSnapshot?.();
        const index = snap?.projections.get(middlewareFeatureId);
        if (!isMiddlewareIndex(index)) return [];
        return index.list().map((middleware) => ({
          name: middleware.name,
          owner: String(middleware.owner),
          phase: middleware.phase,
          target: middleware.target,
          order: middleware.order,
          source: display(middleware.source),
        }));
      },
      components: () => {
        const snap = getSnapshot?.();
        const index = snap?.projections.get(componentFeatureId);
        if (!isComponentIndex(index)) return [];
        return index.list().map((component) => ({
          name: component.name,
          owner: String(component.owner),
          source: display(component.source),
        }));
      },
      renderComponent: async ({ requester, name, props, signal }) => {
        const snap = getSnapshot?.();
        const index = snap?.projections.get(componentFeatureId);
        if (!isComponentIndex(index)) throw new Error('Component Runtime 未就绪');
        return index.render(requester as PluginId, name, props, { signal });
      },
      bindings: () => listIntrospectionBindings(projectRoot),
      tools: () => {
        // ToolIndex is the sole generation-owned Tool catalog.
        const seen = new Map<string, Record<string, unknown>>();
        const snap = getSnapshot?.();
        if (snap) {
          for (const [feature, projection] of snap.projections) {
            // 只取 Tool Feature（zhin.agent-tool / 同族），排除 AdapterIndex 等同样带 list() 的投影
            if (!String(feature).includes('tool')) continue;
            if (!isToolIndexLike(projection)) continue;
            for (const tool of projection.list()) {
              if (tool.hidden) continue;
              seen.set(tool.name, {
                name: tool.name,
                source: display(tool.source),
                description: tool.description ?? '',
              });
            }
          }
        }
        return [...seen.values()];
      },
      promptSections: () => listGenerationPromptSections(getSnapshot?.(), projectRoot),
      mcp: () => {
        const rows = new Map<string, Record<string, unknown>>();
        // 配置面（ai.mcpServers）始终可见；连接状态在 orchestrator 可用时补
        for (const entry of listConfigMcpServers(projectRoot)) {
          rows.set(entry.name, { name: entry.name, connected: false, toolCount: 0, transport: entry.transport });
        }
        const introspection = resolveAgentIntrospection(getSnapshot);
        if (introspection) {
          for (const entry of introspection.listMcpServers()) {
            rows.set(entry.name, {
              name: entry.name,
              connected: entry.connected,
              toolCount: entry.toolCount,
            });
          }
        }
        return { rows: [...rows.values()] };
      },
    },
  });
}

/**
 * Content-free Prompt Section catalog for Console. Prompt text can contain
 * product policy or secrets and therefore never crosses this introspection seam.
 */
export function listGenerationPromptSections(
  snapshot: RuntimeSnapshot | undefined,
  projectRoot: string,
): readonly Readonly<Record<string, unknown>>[] {
  const projection = snapshot?.projections.get(promptSectionFeatureId);
  if (!isPromptSectionIndex(projection)) return [];
  return Object.freeze(projection.list().map((section) => Object.freeze({
    name: section.name,
    qualifiedName: section.qualifiedName,
    title: section.title,
    owner: String(section.owner),
    layer: section.layer,
    order: section.order,
    retention: section.retention,
    ...(section.maxChars === undefined ? {} : { maxChars: section.maxChars }),
    profiles: [...section.profiles],
    ...(section.platforms ? { platforms: [...section.platforms] } : {}),
    source: displayConsolePath(section.source, projectRoot),
    generation: section.generation,
    contentChars: section.content.length,
  })));
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
    const value = createAgentRuntimeResolver(projectRoot, () => lease.value)();
    if (!value) {
      lease.release();
      return null;
    }
    return { value, release: () => lease.release() };
  };
}

/**
 * Console 返回给前端的路径字段：项目根内 → `./…`，HOME 内 → `~/…`。
 * 逻辑名（`agent` / `builtin`）与相对虚路径原样返回，避免 path.resolve 误伤。
 */

type AgentIntrospection = {
  listTools(): readonly { name: string; hidden?: boolean; description?: string }[];
  listMcpServers(): readonly { name: string; connected: boolean; toolCount: number }[];
};

export function resolveGenerationAgentIntrospection(
  snapshot: RuntimeSnapshot | undefined,
  token: { readonly id: TokenId } | undefined,
): AgentIntrospection | null {
  if (!snapshot || !token) return null;
  const host = snapshot.resources.get(snapshot.root)?.get(token.id) as {
    introspection?: AgentIntrospection;
  } | undefined;
  return host?.introspection ?? null;
}

export type AgentConsolePort = {
  readonly sessionTree: ConsoleAgentRuntime['sessionTree'];
  readonly workroom: WorkroomRuntimeHandle;
  readonly workroomControl?: AgentHostWorkroomRunControlPort;
  readonly assistant: AssistantRuntime | null;
  readonly workroomCatalog: {
    read(): Promise<Readonly<{
      definitions: Readonly<Record<string, WorkroomDefinition>>;
      revision: string;
    }>>;
    replace(
      definitions: Readonly<Record<string, WorkroomDefinition>>,
      expectedRevision: string,
    ): Promise<Readonly<{ revision: string }>>;
  };
  listBindings(): readonly {
    name: string;
    providerAlias: string;
    model: string;
    nickname?: string;
  }[];
  readonly trace: {
    list(
      sessionKey: string,
      options?: Readonly<{ afterSequence?: number; limit?: number }>,
    ): {
      readonly sessionKey: string;
      readonly events: readonly Record<string, unknown>[];
      readonly latestSequence: number;
      readonly activeTurnIds: readonly string[];
    };
  };
  readonly cancelSession?: (sessionKey: string) => boolean;
  readonly workroomProfiles?: ConsoleWorkroomProfileControlPort;
  readonly workroomKnowledge?: ConsoleWorkroomKnowledgeControlPort;
  readonly portfolioSponsor?: {
    read(
      portfolioId: string,
      authenticatedPrincipal: Readonly<{ principalId: string }>,
    ): Promise<Readonly<{ status: 'ready'; projection: PortfolioSponsorProjection }>
      | Readonly<{ status: 'forbidden' }>>;
    execute(
      portfolioId: string,
      command: PortfolioSponsorCommand,
      authenticatedPrincipal: Readonly<{ principalId: string }>,
    ): Promise<PortfolioSponsorProjection>;
  };
  readonly effectSponsor?: {
    decide(
      command: Omit<WorkroomEffectSponsorDecisionCommand, 'principalId'>,
      authenticatedPrincipal: Readonly<{ principalId: string }>,
    ): Promise<WorkroomEffectSponsorDecisionRecord>;
  };
  readonly dataLifecycle?: WorkroomDataLifecycleConsoleControlPort;
};

export function resolveGenerationAgentConsole(
  snapshot: RuntimeSnapshot | undefined,
  token: { readonly id: TokenId } | undefined,
): AgentConsolePort | null {
  if (!snapshot || !token) return null;
  const host = snapshot.resources.get(snapshot.root)?.get(token.id) as {
    console?: AgentConsolePort;
  } | undefined;
  return host?.console ?? null;
}

function resolveAgentIntrospection(getSnapshot?: () => RuntimeSnapshot | undefined): AgentIntrospection | null {
  return resolveGenerationAgentIntrospection(getSnapshot?.(), agentModule?.agentHostToken);
}

function resolveAgentConsole(getSnapshot?: () => RuntimeSnapshot | undefined): AgentConsolePort | null {
  return resolveGenerationAgentConsole(getSnapshot?.(), agentModule?.agentHostToken);
}

export function acquireGenerationAgentConsole(snapshots?: SnapshotReader): {
  readonly value: AgentConsolePort | null;
  release(): void;
} | null {
  if (!snapshots) return null;
  try {
    const lease = snapshots.acquire();
    return {
      value: resolveGenerationAgentConsole(lease.value, agentModule?.agentHostToken),
      release: () => lease.release(),
    };
  } catch {
    return null;
  }
}

export async function withGenerationAgentConsole(
  snapshots: SnapshotReader | undefined,
  operation: (value: AgentConsolePort) => Promise<void>,
): Promise<boolean> {
  const lease = acquireGenerationAgentConsole(snapshots);
  if (!lease?.value) {
    lease?.release();
    return false;
  }
  try {
    await operation(lease.value);
    return true;
  } finally {
    lease.release();
  }
}

function isToolIndexLike(value: unknown): value is {
  list(): { name: string; description?: string; source: string; hidden?: boolean }[];
} {
  return !!value && typeof value === 'object' && typeof (value as { list?: unknown }).list === 'function';
}

function listConfigMcpServers(projectRoot: string): { name: string; transport?: string }[] {
  const file = findConfigFileSync(projectRoot);
  if (!file) return [];
  try {
    const text = readFileSync(file, 'utf8');
    const doc = (file.endsWith('.json') ? JSON.parse(text) : parseYaml(text)) as Record<string, unknown>;
    const servers = (doc?.ai as { mcpServers?: { name?: string; transport?: string }[] } | undefined)?.mcpServers;
    if (!Array.isArray(servers)) return [];
    return servers
      .filter((entry) => entry && typeof entry.name === 'string')
      .map((entry) => ({ name: entry.name as string, transport: entry.transport }));
  } catch {
    return [];
  }
}

function listIntrospectionBindings(projectRoot: string): Record<string, unknown>[] {
  const file = findConfigFileSync(projectRoot);
  if (!file) return [];
  try {
    const text = readFileSync(file, 'utf8');
    const doc = (file.endsWith('.json') ? JSON.parse(text) : parseYaml(text)) as Record<string, unknown>;
    const agents = (doc?.ai as { agents?: Record<string, {
      provider?: string; model?: string; nickname?: string; mcpServers?: string[];
    }> } | undefined)?.agents;
    if (!agents || typeof agents !== 'object') return [];
    return Object.entries(agents).map(([name, binding]) => ({
      name,
      provider: binding?.provider ?? '-',
      model: binding?.model ?? '-',
      mcpServers: binding?.mcpServers ?? [],
      hasAgentFile: false,
    }));
  } catch {
    return [];
  }
}

function findConfigFileSync(projectRoot: string): string | undefined {
  for (const candidate of [
    'config.yml', 'config.yaml', 'config.json', 'zhin.config.yml', 'zhin.config.yaml',
  ]) {
    const file = join(projectRoot, candidate);
    if (existsSync(file)) return file;
  }
  return undefined;
}

type AssistantRuntime = {
  readonly events: {
    isEnabled(): boolean;
    handle(body: unknown): Promise<{ ok: boolean; deduped?: boolean; error?: string }>;
  };
  readonly jobs: {
    list(): Promise<Record<string, unknown>[]>;
    add(job: Record<string, unknown>): Promise<Record<string, unknown>>;
    remove(id: string): Promise<boolean>;
    pause(id: string): Promise<boolean>;
    resume(id: string): Promise<boolean>;
  };
};
