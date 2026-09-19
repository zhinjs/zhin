import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';
import type { ImRuntime } from '@zhin.js/core/runtime';
import { formatDisplayPath, looksLikeAbsolutePath } from '@zhin.js/logger';
import type { ConsoleRuntime } from '@zhin.js/pagemanager/plugin-runtime';
import type { PluginNodeSnapshot, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { RuntimeConsolePage } from '@zhin.js/host-http';
import { readDeclaredPlugins, readPluginLifecycleState } from '../plugin-lifecycle-store.js';

const publicAccess = Object.freeze({ permissions: [] as string[], roles: [] as string[] });

export function displayConsolePath(value: string, projectRoot: string): string {
  if (!value || !looksLikeAbsolutePath(value)) return value;
  return formatDisplayPath(value, { projectRoot });
}
export async function listPages(consoleRuntime: ConsoleRuntime): Promise<readonly RuntimeConsolePage[]> {
  const pages = await consoleRuntime.runView(publicAccess, (catalog) => catalog.pages());
  return Object.freeze(pages.map((page) => Object.freeze({
    id: page.id,
    localName: page.localName,
    title: page.title,
    route: page.route,
    module: page.module,
    order: page.order,
    hash: page.hash,
  })));
}

/** Console shell entry shape (`@zhin.js/contract` ConsoleClientEntry 兼容）。 */
export type ConsoleEntryBody = {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly module: string;
  readonly resolvedModule: string;
  readonly order: number;
  readonly enabled: boolean;
  readonly meta: { readonly name: string };
  readonly route: string;
  readonly hash: string;
};

export type ConsoleEntriesBody = {
  readonly entries: readonly ConsoleEntryBody[];
  readonly runtimeEnvHint: 'development' | 'production';
};

/**
 * 映射 Console catalog pages → `GET /entries` 响应（legacy host-api 对齐）。
 * SDK `loadConsoleEntries` 消费 `{ entries, runtimeEnvHint }`，动态 import
 * 每项的 `resolvedModule`（`/assets/client/*` 由 Console Host 静态服务）。
 */
export function buildConsoleEntriesBody(
  pages: readonly RuntimeConsolePage[],
  runtimeEnvHint: 'development' | 'production' = defaultRuntimeEnvHint(),
): ConsoleEntriesBody {
  const entries = [...pages]
    .sort((a, b) => a.order - b.order)
    .map((page) => Object.freeze({
      id: page.localName,
      name: page.localName,
      title: page.title,
      module: page.module,
      resolvedModule: page.module,
      order: page.order,
      enabled: true,
      meta: Object.freeze({ name: page.title }),
      route: page.route,
      hash: page.hash,
    }));
  return Object.freeze({ entries: Object.freeze(entries), runtimeEnvHint });
}

function defaultRuntimeEnvHint(): 'development' | 'production' {
  return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production'
    ? 'production'
    : 'development';
}

export type SystemOsMemory = {
  readonly freeMem: number;
  readonly totalMem: number;
};

/** `GET /api/system/status` 的 data（legacy host-api system-routes 对齐）。 */
export type SystemStatusData = {
  readonly uptime: number;
  readonly memory: NodeJS.MemoryUsage | Record<string, number>;
  readonly osMemory?: SystemOsMemory;
  readonly cpu?: { readonly user: number; readonly system: number };
  readonly platform: string;
  readonly nodeVersion?: string;
  readonly runtime: 'node' | 'unknown';
  readonly pid?: number;
  readonly timestamp: string;
};

/** Host (Node) 系统状态快照 — 移植自 legacy rest/system-routes.ts。 */
export function getSystemStatusData(): SystemStatusData {
  if (typeof process !== 'undefined' && process.versions?.node) {
    return {
      uptime: process.uptime(),
      memory: safeProcessMemory(),
      osMemory: safeOsMemory(),
      cpu: safeProcessCpu(),
      platform: process.platform,
      nodeVersion: process.version,
      runtime: 'node',
      pid: process.pid,
      timestamp: new Date().toISOString(),
    };
  }
  return {
    uptime: 0,
    memory: {},
    platform: 'unknown',
    runtime: 'unknown',
    timestamp: new Date().toISOString(),
  };
}

function safeProcessMemory(): NodeJS.MemoryUsage | Record<string, number> {
  try {
    return process.memoryUsage();
  } catch {
    return {};
  }
}

function safeProcessCpu(): { user: number; system: number } | undefined {
  try {
    return typeof process.cpuUsage === 'function' ? process.cpuUsage() : undefined;
  } catch {
    return undefined;
  }
}

function safeOsMemory(): SystemOsMemory | undefined {
  try {
    return { freeMem: os.freemem(), totalMem: os.totalmem() };
  } catch {
    return undefined;
  }
}

/** `GET /api/stats` 的 data（legacy host-rest-api 对齐；commands/components 暂无新 Runtime 数据源，省略）。 */
export type ConsoleStatsData = {
  readonly plugins: { readonly total: number; readonly active: number };
  readonly endpoints: { readonly total: number; readonly online: number };
  readonly uptime: number;
  /** heapUsed，单位 MB（legacy 契约，dashboard 直接 toFixed 展示）。 */
  readonly memory: number;
  readonly runtime: 'node' | 'unknown';
};

type EndpointStatusView = Pick<ReturnType<ImRuntime['listEndpoints']>[number], 'status'>;

export function buildConsoleStats(
  pluginCount: number,
  endpoints: readonly EndpointStatusView[],
): ConsoleStatsData {
  const status = getSystemStatusData();
  const heapUsed = typeof status.memory.heapUsed === 'number' ? status.memory.heapUsed : 0;
  return {
    plugins: { total: pluginCount, active: pluginCount },
    endpoints: {
      total: endpoints.length,
      online: endpoints.filter((endpoint) => endpoint.status === 'online').length,
    },
    uptime: status.uptime,
    memory: heapUsed / 1024 / 1024,
    runtime: status.runtime,
  };
}

/** Console 卡片单条 Feature 分组（对齐 legacy FeatureJSON）。 */
export type ConsolePluginFeature = {
  readonly name: string;
  readonly icon: string;
  readonly desc: string;
  readonly count: number;
  readonly items: readonly { readonly name: string; readonly desc?: string }[];
};

/**
 * listEndpoints 返回形态：无 owner，用 adapter 平台类型（`@scope/adapter-icqq` → `icqq`）归属插件。
 * 与 ImRuntime.listEndpoints 的当前输出对齐。
 */
export type ConsoleEndpointHint = {
  readonly name: string;
  readonly adapter: string;
  readonly connected: boolean;
};

/** `GET /api/plugins` 列表项（legacy buildPluginListItem 对齐）。 */
export type ConsolePluginListItem = {
  readonly name: string;
  readonly status: 'active' | 'inactive';
  readonly description: string;
  readonly features: readonly ConsolePluginFeature[];
  readonly packageName: string;
  readonly instanceKey: string;
  readonly manageable: boolean;
};

export function buildPluginListItem(
  node: PluginNodeSnapshot,
  snapshot?: RuntimeSnapshot,
  endpoints?: readonly ConsoleEndpointHint[],
): ConsolePluginListItem {
  return {
    name: node.instanceKey,
    // Snapshot 中的节点均为当前 generation 已加载插件。
    status: 'active',
    description: node.metadata?.displayName ?? node.packageName,
    features: buildPluginFeatures(node, snapshot, endpoints),
    packageName: node.packageName,
    instanceKey: node.instanceKey,
    manageable: false,
  };
}

/** Loaded snapshot plus declared-but-disabled root children for product management UI. */
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
  const lifecycle = await readPluginLifecycleState(lifecycleFile);
  const disabled = new Set(lifecycle.disabled);
  const managed = declared.map((reference): ConsolePluginListItem => {
    const active = loadedByKey.get(reference.instanceKey);
    if (active) {
      loadedByKey.delete(reference.instanceKey);
      return Object.freeze({...active, manageable: true});
    }
    return Object.freeze({
      name: reference.instanceKey,
      status: 'inactive',
      description: disabled.has(reference.instanceKey)
        ? `${reference.packageName} · 已停用`
        : `${reference.packageName} · 等待 Host 加载`,
      features: Object.freeze([]),
      packageName: reference.packageName,
      instanceKey: reference.instanceKey,
      manageable: true,
    });
  });
  return Object.freeze([...managed, ...loadedByKey.values()]);
}

/**
 * Console 卡片 Feature 分组（icon 与 legacy Feature 类 / 前端 iconMap 对齐）。
 * key = FeatureId 字符串（capability.feature）。
 */
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

/** 从 snapshot.capabilities 按 owner 聚合插件 Feature（对齐 legacy Feature.toJSON）。 */
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
  // adapter Feature 的 items 用真实 endpoint 名（uin / bot 名）；listEndpoints 无 owner，
  // adapter Feature 的 items 用真实 endpoint 名（uin / bot 名）。
  // 按 endpoint 的 owner PluginId 精确归属实例——不能按平台类型匹配，
  // 否则多实例适配器（icqq×N）的每个实例都会分到全部 endpoint。
  const adapterGroup = groups.get('adapter');
  if (adapterGroup && endpoints) {
    const owned = endpoints.filter((endpoint) =>
      (endpoint as { owner?: string }).owner === node.id);
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

/** `GET /api/plugins/:name` 详情（legacy host-rest-api 对齐）。 */
export type ConsolePluginDetail = ConsolePluginListItem & {
  readonly filename: string;
  readonly filePath: string;
  readonly version?: string;
  readonly contextCount: number;
  readonly contexts: readonly unknown[];
};

export function buildPluginDetail(
  node: PluginNodeSnapshot,
  version?: string,
  snapshot?: RuntimeSnapshot,
  endpoints?: readonly ConsoleEndpointHint[],
  projectRoot?: string,
): ConsolePluginDetail {
  const packageRoot = projectRoot
    ? displayConsolePath(node.packageRoot, projectRoot)
    : node.packageRoot;
  return {
    ...buildPluginListItem(node, snapshot, endpoints),
    filename: packageRoot,
    filePath: packageRoot,
    ...(version ? { version } : {}),
    contextCount: 0,
    contexts: Object.freeze([]),
  };
}

/** Snapshot 中非 root 的插件节点（root 无 parent，对应 legacy root.children）。 */
export function listSnapshotPlugins(snapshot: RuntimeSnapshot | undefined): PluginNodeSnapshot[] {
  if (!snapshot) return [];
  return [...snapshot.tree.values()].filter((node) => node.parent !== undefined);
}

export function readSnapshot(accessor?: () => RuntimeSnapshot | undefined): RuntimeSnapshot | undefined {
  try {
    return accessor?.();
  } catch {
    return undefined;
  }
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
