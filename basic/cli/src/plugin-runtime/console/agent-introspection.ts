import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { commandFeatureId, isCommandIndex } from '@zhin.js/command';
import { componentFeatureId, isComponentIndex } from '@zhin.js/component';
import { isMiddlewareIndex, middlewareFeatureId } from '@zhin.js/middleware';
import { isPromptSectionIndex, promptSectionFeatureId } from '@zhin.js/prompt-section';
import type { ConsoleAgentRuntime } from '@zhin.js/host-http';
import type { PluginId, RuntimeSnapshot, SnapshotReader } from '@zhin.js/plugin-runtime';
import {
  resolveCurrentAgentConsole,
  resolveCurrentAgentIntrospection,
} from './agent-console.js';
import { displayConsolePath } from './display-path.js';

function createAgentRuntimeResolver(
  projectRoot: string,
  getSnapshot?: () => RuntimeSnapshot | undefined,
): () => ConsoleAgentRuntime | undefined {
  const display = (value: string) => displayConsolePath(value, projectRoot);
  return () => ({
    sessionTree: resolveCurrentAgentConsole(getSnapshot?.())?.sessionTree,
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
        const introspection = resolveCurrentAgentIntrospection(getSnapshot?.());
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
