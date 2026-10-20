import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PluginNodeSnapshot, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { NodePackageResolver, PackageResolutionError } from '@zhin.js/runtime';
import { readDeclaredPlugins, readProjectPluginLifecycleState } from '../plugin-lifecycle-store.js';
import { displayConsolePath } from './display-path.js';

export type ConsolePluginFeature = {
  readonly name: string;
  readonly icon: string;
  readonly desc: string;
  readonly count: number;
  readonly items: readonly { readonly name: string; readonly desc?: string }[];
};

export type ConsoleEndpointHint = {
  readonly name: string;
  readonly adapter: string;
  readonly owner?: string;
  readonly connected: boolean;
};

export type ConsolePluginListItem = {
  readonly name: string;
  readonly status: 'active' | 'inactive';
  readonly description: string;
  readonly features: readonly ConsolePluginFeature[];
  readonly packageName: string;
  readonly instanceKey: string;
  readonly manageable: boolean;
  readonly metadata?: NonNullable<PluginNodeSnapshot['metadata']>;
  readonly displayName?: string;
  readonly icon?: string;
};

export function buildPluginListItem(
  node: PluginNodeSnapshot,
  snapshot?: RuntimeSnapshot,
  endpoints?: readonly ConsoleEndpointHint[],
): ConsolePluginListItem {
  return {
    name: node.instanceKey,
    status: 'active',
    description: node.metadata?.displayName ?? node.packageName,
    features: buildPluginFeatures(node, snapshot, endpoints),
    packageName: node.packageName,
    instanceKey: node.instanceKey,
    manageable: false,
    ...projectMetadata(node.metadata),
  };
}

/** Combines loaded plugins with declared root plugins that are not active. */
export async function buildManagedPluginList(
  projectRoot: string,
  lifecycleFile: string,
  snapshot?: RuntimeSnapshot,
  endpoints: readonly ConsoleEndpointHint[] = [],
): Promise<readonly ConsolePluginListItem[]> {
  const loaded = listSnapshotPlugins(snapshot)
    .map((node) => buildPluginListItem(node, snapshot, endpoints));
  const loadedByKey = new Map(loaded.map((item) => [item.instanceKey, item]));
  const declared = await readDeclaredPlugins(projectRoot);
  const lifecycle = await readProjectPluginLifecycleState(projectRoot, lifecycleFile);
  const disabled = new Set(lifecycle.disabled);
  let packages: Promise<{ resolver: NodePackageResolver; root: Awaited<ReturnType<NodePackageResolver['root']>> }> | undefined;
  const readMetadata = async (request: string) => {
    try {
      packages ??= NodePackageResolver.create(projectRoot).then(async resolver => ({ resolver, root: await resolver.root(projectRoot) }));
      const { resolver, root } = await packages;
      const pkg = await resolver.resolve(request, root);
      return pkg.packageJson.zhin.type === 'plugin' ? pkg.packageJson.zhin.metadata : undefined;
    } catch (error) {
      if (error instanceof PackageResolutionError || (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  };
  const managed = await Promise.all(declared.map(async (reference): Promise<ConsolePluginListItem> => {
    const active = loadedByKey.get(reference.instanceKey);
    if (active) {
      loadedByKey.delete(reference.instanceKey);
      return Object.freeze({ ...active, manageable: true });
    }
    const metadata = await readMetadata(reference.packageName);
    const description = metadata?.displayName ?? reference.packageName;
    return Object.freeze({
      name: reference.instanceKey,
      status: 'inactive',
      description: disabled.has(reference.instanceKey)
        ? `${description} · 已停用`
        : `${description} · 等待 Host 加载`,
      features: Object.freeze([]),
      packageName: reference.packageName,
      instanceKey: reference.instanceKey,
      manageable: true,
      ...projectMetadata(metadata),
    });
  }));
  return Object.freeze([...managed, ...loadedByKey.values()]);
}

function projectMetadata(metadata: PluginNodeSnapshot['metadata']): Pick<ConsolePluginListItem, 'metadata' | 'displayName' | 'icon'> {
  if (!metadata || Object.keys(metadata).length === 0) return {};
  return {
    metadata: Object.freeze({ ...metadata }),
    ...(metadata.displayName === undefined ? {} : { displayName: metadata.displayName }),
    ...(metadata.icon === undefined ? {} : { icon: metadata.icon }),
  };
}

const FEATURE_GROUPS: Record<string, { name: string; icon: string; desc: string }> = {
  'zhin.adapter': { name: 'adapter', icon: 'Cable', desc: '适配器' },
  'zhin.command': { name: 'command', icon: 'Terminal', desc: '命令' },
  'zhin.component': { name: 'component', icon: 'Box', desc: '组件' },
  'zhin.middleware': { name: 'middleware', icon: 'Layers', desc: '中间件' },
  'zhin.handler': { name: 'handler', icon: 'Radio', desc: '事件处理器' },
  'zhin.agent-tool': { name: 'tool', icon: 'Wrench', desc: '工具' },
  'zhin.skill': { name: 'skill', icon: 'Brain', desc: '技能' },
  'zhin.agent': { name: 'agent', icon: 'Bot', desc: 'Agent' },
  'zhin.mcp': { name: 'mcp', icon: 'Plug', desc: 'MCP' },
  'zhin.page': { name: 'page', icon: 'Layout', desc: '页面' },
  'zhin.layout': { name: 'layout', icon: 'PanelTop', desc: '布局' },
};

/** Groups the capability slots owned by one plugin for Console presentation. */
export function buildPluginFeatures(
  node: PluginNodeSnapshot,
  snapshot?: RuntimeSnapshot,
  endpoints?: readonly ConsoleEndpointHint[],
): readonly ConsolePluginFeature[] {
  if (!snapshot) return Object.freeze([]);
  const groups = new Map<string, {
    name: string;
    icon: string;
    desc: string;
    items: { name: string; desc?: string }[];
  }>();
  for (const slot of snapshot.capabilities.values()) {
    if (slot.owner !== node.id) continue;
    const group = FEATURE_GROUPS[String(slot.feature)];
    if (!group) continue;
    const entry = groups.get(group.name) ?? { ...group, items: [] };
    entry.items.push({ name: slot.localName });
    groups.set(group.name, entry);
  }
  const adapterGroup = groups.get('adapter');
  if (adapterGroup && endpoints) {
    const owned = endpoints.filter((endpoint) => endpoint.owner === node.id);
    if (owned.length > 0) {
      adapterGroup.items = owned.map((endpoint) => ({
        name: endpoint.name,
        desc: endpoint.connected ? 'online' : 'offline',
      }));
    }
  }
  return Object.freeze([...groups.values()].map((group) => Object.freeze({
    name: group.name,
    icon: group.icon,
    desc: group.desc,
    count: group.items.length,
    items: Object.freeze(group.items),
  })));
}

export type ConsolePluginDetail = ConsolePluginListItem & {
  readonly packageRoot: string;
  readonly version?: string;
};

export function buildPluginDetail(
  node: PluginNodeSnapshot,
  version?: string,
  snapshot?: RuntimeSnapshot,
  endpoints?: readonly ConsoleEndpointHint[],
  projectRoot?: string,
): ConsolePluginDetail {
  return {
    ...buildPluginListItem(node, snapshot, endpoints),
    packageRoot: projectRoot
      ? displayConsolePath(node.packageRoot, projectRoot)
      : node.packageRoot,
    ...(version ? { version } : {}),
  };
}

export function listSnapshotPlugins(snapshot: RuntimeSnapshot | undefined): PluginNodeSnapshot[] {
  if (!snapshot) return [];
  return [...snapshot.tree.values()].filter((node) => node.parent !== undefined);
}

export async function readPackageVersion(packageRoot: string): Promise<string | undefined> {
  try {
    const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
      readonly version?: unknown;
    };
    return typeof pkg.version === 'string' ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}
