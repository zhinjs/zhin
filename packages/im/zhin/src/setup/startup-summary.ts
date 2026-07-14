/**
 * 启动摘要 — 在 plugin.start() 完成后输出运行时快照。
 */
import * as os from 'node:os';
import * as path from 'node:path';
import type { Server } from 'node:http';
import chalk from 'chalk';
import { Adapter, Feature, type Plugin } from '@zhin.js/core';
import {
  buildLogTableTotalsRow,
  formatChipListLines,
  formatChipListLinesRaw,
  formatDisplayPath,
  formatLogKvTable,
  formatLogTable,
  wrapCommaSeparated,
  type LogKvRow,
  type LogTableColumn,
} from '@zhin.js/logger';
import type { AppConfig } from '../types.js';
import { getZhinProjectRoot } from './project-root.js';

export type BootstrapPhase = 'db' | 'ai';

let bootstrapStartedAt: number | undefined;
const phaseAt: Partial<Record<'start' | BootstrapPhase | 'ready', number>> = {};

export function markBootstrapStart(): void {
  const t = performance.now();
  bootstrapStartedAt = t;
  phaseAt.start = t;
}

export function markBootstrapPhase(phase: BootstrapPhase): void {
  phaseAt[phase] = performance.now();
}

export function markBootstrapReady(): void {
  phaseAt.ready = performance.now();
}

export interface BootstrapPhaseTimings {
  total: number;
  db?: number;
  ai?: number;
  im?: number;
}

export function getBootstrapPhaseTimings(): BootstrapPhaseTimings | undefined {
  const start = phaseAt.start ?? bootstrapStartedAt;
  if (start == null) return undefined;
  const ready = phaseAt.ready ?? performance.now();
  const total = Math.round(ready - start);
  const db = phaseAt.db != null ? Math.round(phaseAt.db - start) : undefined;
  const ai = phaseAt.db != null && phaseAt.ai != null ? Math.round(phaseAt.ai - phaseAt.db) : undefined;
  const im = phaseAt.ai != null ? Math.round(ready - phaseAt.ai) : undefined;
  return { total, db, ai, im };
}

export function formatBootstrapTitle(): string {
  const t = getBootstrapPhaseTimings();
  if (!t) return 'Zhin 已就绪';
  const segments: string[] = [];
  if (t.db != null) segments.push(`DB ${t.db}`);
  if (t.ai != null) segments.push(`AI ${t.ai}`);
  if (t.im != null) segments.push(`IM ${t.im}`);
  const detail = segments.length > 0 ? ` (${segments.join(' / ')})` : '';
  return `Zhin 已就绪 · ${t.total} ms${detail}`;
}

export function getBootstrapElapsedMs(): number | undefined {
  return getBootstrapPhaseTimings()?.total;
}

function shortPluginName(name: string): string {
  const slash = name.lastIndexOf('/');
  return slash >= 0 ? name.slice(slash + 1) : name;
}

function collectFeatureServices(root: Plugin): Feature[] {
  const features: Feature[] = [];
  for (const [, context] of root.contexts) {
    if (context.value instanceof Feature) {
      features.push(context.value);
    }
  }
  return features;
}

const FEATURE_COLUMN_DEFS: Array<{ name: string; header: string }> = [
  { name: 'command', header: '命令' },
  { name: 'component', header: '组件' },
  { name: 'tool', header: '工具' },
  { name: 'schedule', header: '定时' },
  { name: 'skill', header: '技能' },
  { name: 'schema', header: '配置' },
  { name: 'database', header: '模型' },
  { name: 'permission', header: '权限' },
  { name: 'agent-preset', header: '预设' },
];

export interface PluginFeatureRow {
  plugin: string;
  [key: string]: string | number;
}

function rowHasContribution(row: PluginFeatureRow, metricKeys: string[]): boolean {
  return metricKeys.some((key) => {
    const v = row[key];
    return typeof v === 'number' && v > 0;
  });
}

export function collectPluginFeatureRows(root: Plugin): {
  columns: LogTableColumn[];
  rows: PluginFeatureRow[];
} {
  const featureServices = collectFeatureServices(root);
  const plugins = root.children as Plugin[];

  const activeFeatureCols = FEATURE_COLUMN_DEFS.filter((col) =>
    plugins.some((plugin) =>
      featureServices.some((f) => f.name === col.name && f.countByPlugin(plugin.name) > 0),
    ),
  );

  const metricKeys = [...activeFeatureCols.map((c) => c.header), '中间件'];
  const columns: LogTableColumn[] = [
    { key: 'plugin', header: '插件' },
    ...activeFeatureCols.map((col) => ({ key: col.header, header: col.header, align: 'right' as const })),
    { key: '中间件', header: '中间件', align: 'right' },
  ];

  const allRows: PluginFeatureRow[] = plugins.map((plugin) => {
    const row: PluginFeatureRow = { plugin: shortPluginName(plugin.name) };
    for (const col of activeFeatureCols) {
      const feature = featureServices.find((f) => f.name === col.name);
      row[col.header] = feature?.countByPlugin(plugin.name) ?? 0;
    }
    row['中间件'] = plugin.getFeatures().find((f) => f.name === 'middleware')?.count ?? 0;
    return row;
  });

  const rows = allRows.filter((row) => rowHasContribution(row, metricKeys));
  const hasMiddleware = rows.some((r) => (r['中间件'] as number) > 0);
  if (!hasMiddleware) {
    return {
      columns: columns.filter((c) => c.key !== '中间件'),
      rows: rows.map(({ 中间件: _mw, ...rest }) => rest),
    };
  }
  return { columns, rows };
}

function formatBytesMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 概览表值列最大宽度（与插件矩阵视觉对齐） */
const OVERVIEW_VALUE_WIDTH = 54;
/** Tools 启动摘要最多展示条数，其余折叠为 (+N) */
const TOOL_PREVIEW_MAX = 10;
/** 启动时尝试连接 MCP 的超时（毫秒） */
const MCP_CONNECT_TIMEOUT_MS = 2500;

function chipListToKvRows(label: string, items: string[], perLine: number): LogKvRow[] {
  if (items.length === 0) return [];
  const lines = formatChipListLines(items, perLine).split('\n');
  return lines.map((line, index) => ({
    label: index === 0 ? label : '',
    value: line,
  }));
}

function toolsToKvRows(tools: string[]): LogKvRow[] {
  if (tools.length === 0) return [];
  const preview = tools.slice(0, TOOL_PREVIEW_MAX);
  const rest = tools.length - preview.length;
  const items = rest > 0 ? [...preview, `(+${rest})`] : preview;
  return chipListToKvRows(`Tools (${tools.length})`, items, 5);
}

function coloredChipListToKvRows(label: string, items: string[], perLine: number): LogKvRow[] {
  if (items.length === 0) return [];
  const lines = formatChipListLinesRaw(items, perLine).split('\n');
  return lines.map((line, index) => ({
    label: index === 0 ? label : '',
    value: line,
  }));
}

interface McpServerChip {
  name: string;
  connected: boolean;
  toolCount: number;
}

function formatMcpChip(server: McpServerChip, connectAttempted: boolean): string {
  if (server.connected) {
    const tools = server.toolCount === 1 ? '1 tool' : `${server.toolCount} tools`;
    return chalk.green(`${server.name} (${tools})`);
  }
  if (connectAttempted) {
    return chalk.red(`${server.name} (failed)`);
  }
  return chalk.dim(`${server.name} (pending)`);
}

function buildOverviewRows(
  runtime: ReturnType<typeof collectRuntimeFacts>,
  configFile: string,
  configDir: string,
  db: ReturnType<typeof collectDatabaseFacts>,
  ai: {
    providers: string[];
    agents: string[];
    tools: string[];
    skills: string[];
    mcpServers: McpServerChip[];
    mcpConnectAttempted: boolean;
  } | null,
): { rows: LogKvRow[]; sectionBreaks: number[] } {
  const endpointOffline = runtime.endpointTotal > 0 && runtime.endpointOnline < runtime.endpointTotal;
  const endpointValue = endpointOffline
    ? `${chalk.yellow('⚠')} Endpoint ${runtime.endpoints}`
    : `Endpoint ${runtime.endpoints}`;

  const rows: LogKvRow[] = [
    { label: '配置', value: configFile },
    { label: '路径', value: configDir },
    {
      label: '运行时',
      value: `PID ${runtime.pid} · 端口 ${runtime.ports} · ${endpointValue}`,
    },
    { label: '内存', value: `Heap ${runtime.heap} · RSS ${runtime.rss}` },
    { label: '系统', value: `${runtime.osFree} / ${runtime.osTotal}` },
  ];
  const sectionBreaks: number[] = [];

  const hasMore = Boolean(db || ai);
  if (hasMore) sectionBreaks.push(rows.length - 1);

  if (db) {
    const dbSummary = db.file
      ? `${db.dialect} · ${db.file} · ${db.modelCount} 张表`
      : `${db.dialect} · ${db.modelCount} 张表`;
    rows.push({ label: '数据库', value: dbSummary });
    const tableLines = wrapCommaSeparated(db.tablePreview, OVERVIEW_VALUE_WIDTH);
    for (const [index, line] of tableLines.entries()) {
      rows.push({ label: index === 0 ? '表' : '', value: line });
    }
    if (ai) sectionBreaks.push(rows.length - 1);
  }

  if (ai) {
    if (ai.providers.length > 0) {
      rows.push(...chipListToKvRows(`Providers (${ai.providers.length})`, ai.providers, 4));
    }
    if (ai.agents.length > 0) {
      rows.push(...chipListToKvRows(`Agents (${ai.agents.length})`, ai.agents, 4));
    }
    if (ai.tools.length > 0) {
      rows.push(...toolsToKvRows(ai.tools));
    }
    if (ai.skills.length > 0) {
      rows.push(...chipListToKvRows(`Skills (${ai.skills.length})`, ai.skills, 4));
    }
    if (ai.mcpServers.length > 0) {
      const chips = ai.mcpServers.map((s) => formatMcpChip(s, ai.mcpConnectAttempted));
      rows.push(...coloredChipListToKvRows(`MCP (${ai.mcpServers.length})`, chips, 3));
    }
  }

  return { rows, sectionBreaks };
}

function collectRuntimeFacts(root: Plugin, appConfig: AppConfig) {
  const mem = process.memoryUsage();

  const ports = new Set<string>();
  const server = root.inject('server' as keyof Plugin.Contexts) as Server | undefined;
  const addr = server?.address?.();
  if (addr && typeof addr === 'object' && 'port' in addr && addr.port) {
    ports.add(String(addr.port));
  }
  const httpPort = appConfig.http?.port;
  if (httpPort) ports.add(String(httpPort));

  let endpointTotal = 0;
  let endpointOnline = 0;
  for (const adapterName of root.adapters) {
    const adapter = root.inject(adapterName);
    if (!(adapter instanceof Adapter)) continue;
    endpointTotal += adapter.endpoints.size;
    for (const endpoint of adapter.endpoints.values()) {
      if ((endpoint as { $connected?: boolean }).$connected) endpointOnline++;
    }
  }

  return {
    elapsed: getBootstrapElapsedMs(),
    pid: process.pid,
    heap: formatBytesMb(mem.heapUsed),
    rss: formatBytesMb(mem.rss),
    osFree: formatBytesMb(os.freemem()),
    osTotal: formatBytesMb(os.totalmem()),
    ports: [...ports].join(', ') || '-',
    endpoints: `${endpointOnline}/${endpointTotal}`,
    endpointOnline,
    endpointTotal,
  };
}

function collectDatabaseFacts(root: Plugin, appConfig: AppConfig): {
  dialect: string;
  file?: string;
  host?: string;
  modelCount: number;
  tablePreview: string;
} | null {
  if (!appConfig.database) return null;
  const dbFeature = root.inject('database' as keyof Plugin.Contexts) as
    | { byName?: Map<string, unknown>; models?: Map<string, unknown> }
    | undefined;
  const models = dbFeature?.byName
    ? [...dbFeature.byName.keys()]
    : dbFeature?.models
      ? [...dbFeature.models.keys()]
      : [];
  const cfg = appConfig.database as { dialect?: string; filename?: string; host?: string };
  const previewCount = 8;
  const shown = models.slice(0, previewCount);
  const rest = models.length - shown.length;
  let tablePreview = shown.join(', ');
  if (rest > 0) tablePreview += `  (+${rest})`;

  return {
    dialect: cfg.dialect ?? 'unknown',
    file: cfg.dialect === 'sqlite' && cfg.filename ? path.basename(String(cfg.filename)) : undefined,
    host: cfg.host ? String(cfg.host) : undefined,
    modelCount: models.length,
    tablePreview,
  };
}

async function collectAiFacts(root: Plugin): Promise<{
  providers: string[];
  agents: string[];
  tools: string[];
  skills: string[];
  mcpServers: McpServerChip[];
  mcpConnectAttempted: boolean;
} | null> {
  try {
    const {
      collectIntrospectionBindings,
      collectIntrospectionAgentTools,
      collectIntrospectionSkills,
      collectIntrospectionMcpWithConfigFallback,
      ensureMcpConnections,
      waitForAgentBootstrap,
    } = await import('@zhin.js/agent');
    await waitForAgentBootstrap(3000);

    let mcpConnectAttempted = false;
    const orchestrator = root.inject('agent' as keyof Plugin.Contexts) as {
      mcps?: { getAll: () => unknown[] };
    } | undefined;
    if (orchestrator?.mcps?.getAll().length) {
      mcpConnectAttempted = true;
      await Promise.race([
        ensureMcpConnections(orchestrator.mcps as Parameters<typeof ensureMcpConnections>[0]),
        new Promise<void>((resolve) => setTimeout(resolve, MCP_CONNECT_TIMEOUT_MS)),
      ]);
    }

    const ai = root.inject('ai' as keyof Plugin.Contexts) as { listProviders?: () => string[] } | undefined;
    const providers = ai?.listProviders?.() ?? [];
    const bindings = collectIntrospectionBindings(root);
    const agents = Array.isArray(bindings) ? bindings.map((b) => b.name) : [];
    const tools = collectIntrospectionAgentTools(root);
    const skills = collectIntrospectionSkills(root);
    const mcpServers = collectIntrospectionMcpWithConfigFallback(root).rows;
    if (
      providers.length === 0
      && agents.length === 0
      && tools.length === 0
      && skills.length === 0
      && mcpServers.length === 0
    ) {
      return null;
    }
    return { providers, agents, tools, skills, mcpServers, mcpConnectAttempted };
  } catch {
    return null;
  }
}

export interface EmitStartupSummaryOptions {
  configPath: string;
  appConfig: AppConfig;
}

export async function emitStartupSummary(
  plugin: Plugin,
  options: EmitStartupSummaryOptions,
): Promise<void> {
  const { logger } = plugin;
  const { configPath, appConfig } = options;
  const configFile = path.basename(configPath);
  const configDir = formatDisplayPath(path.dirname(configPath), {
    projectRoot: getZhinProjectRoot(),
    preferHome: true,
  });
  const db = collectDatabaseFacts(plugin, appConfig);
  const ai = await collectAiFacts(plugin);
  markBootstrapReady();
  const runtime = collectRuntimeFacts(plugin, appConfig);
  const { columns, rows } = collectPluginFeatureRows(plugin);

  const blocks: string[] = [];

  const { rows: overviewRows, sectionBreaks } = buildOverviewRows(
    runtime, configFile, configDir, db, ai,
  );
  blocks.push(formatLogKvTable(overviewRows, {
    title: formatBootstrapTitle(),
    sectionBreaks,
    maxValueWidth: OVERVIEW_VALUE_WIDTH,
  }));

  if (rows.length > 0) {
    blocks.push('');
    const totals = buildLogTableTotalsRow(columns, rows, '合计');
    blocks.push(formatLogTable(columns, rows, {
      title: `插件能力矩阵 (${rows.length} 个有贡献 / ${plugin.children.length} 已加载)`,
      totalsRow: totals,
    }));
  }

  logger.info(blocks.join('\n'));
}
