/**
 * Loads the project's `zhin.js` instance modules (ADR 0054 §0). `@zhin.js/cli` does not depend on
 * `zhin.js` or any IM layer: commands that need instance code resolve it from the project at run time.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { moduleResolve } from 'import-meta-resolve';

export const INSTANCE_ENTRY = 'zhin.js/instance';
export const INSTANCE_CLI_ENTRY = 'zhin.js/instance/cli';

/** Custom export conditions the current process was started with (`--conditions` / `-C`). */
export function activeExportConditions(
  execArgv: readonly string[] = process.execArgv,
  nodeOptions: string | undefined = process.env.NODE_OPTIONS,
): readonly string[] {
  const args = [...execArgv, ...(nodeOptions?.split(/\s+/u).filter(Boolean) ?? [])];
  const conditions: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    const inline = /^(?:--conditions|-C)=(.+)$/u.exec(arg);
    if (inline) conditions.push(inline[1]!);
    else if ((arg === '--conditions' || arg === '-C') && args[index + 1]) conditions.push(args[++index]!);
  }
  // Running the CLI from its TypeScript sources (tests, tsx): load the instance from sources too.
  if (import.meta.url.endsWith('.ts')) conditions.push('development');
  return conditions;
}

/**
 * Resolves `specifier` from the project root first, then from the CLI's own install location
 * (the CLI is normally installed inside the same project).
 */
export function resolveProjectModule(projectRoot: string, specifier: string): URL {
  const conditions = new Set(['node', 'import', ...activeExportConditions()]);
  const parents = [pathToFileURL(join(projectRoot, 'package.json')), new URL(import.meta.url)];
  let lastError: unknown;
  for (const parent of parents) {
    try {
      return moduleResolve(specifier, parent, conditions);
    } catch (error) {
      lastError = error;
    }
  }
  throw new ProjectInstanceNotFoundError(projectRoot, specifier, lastError);
}

export class ProjectInstanceNotFoundError extends Error {
  readonly code = 'ZHIN_INSTANCE_NOT_FOUND';
  constructor(readonly projectRoot: string, readonly specifier: string, cause?: unknown) {
    super(`无法从 ${projectRoot} 解析 ${specifier}：请在项目中安装 zhin.js（pnpm add zhin.js）`, { cause });
    this.name = 'ProjectInstanceNotFoundError';
  }
}

export async function importProjectModule<T>(projectRoot: string, specifier: string): Promise<T> {
  return await import(resolveProjectModule(projectRoot, specifier).href) as T;
}

// ---- narrow views of `zhin.js/instance` and `zhin.js/instance/cli` used by CLI commands

export interface InstanceStartOptions {
  readonly root: string;
  readonly args: readonly string[];
  writeOutput(value: string): void;
  writeError(value: string): void;
}

export interface InstanceModule {
  runStartCommand(options: InstanceStartOptions): Promise<unknown>;
}

export interface ProjectDatabaseHost {
  readonly dialect: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ComponentDefinitionView {
  readonly previewProps?: unknown;
  render(props: never, context: never): unknown;
}

export interface EngagementJournalView {
  listEngagements(limit: number): Promise<readonly string[]>;
  summarize(engagementId: string): Promise<unknown>;
  read(engagementId: string): Promise<readonly unknown[]>;
}

export interface AgentTraceStoreView {
  sessions(filter: { readonly since?: number; readonly until?: number }): Promise<readonly {
    readonly session_key: string;
    readonly turns: number;
    readonly last_started_at: number;
    readonly last_status: string;
    readonly total_tokens: number;
  }[]>;
  query(filter: Record<string, unknown>): Promise<readonly unknown[]>;
  latest(): Promise<unknown>;
  find(turn: string): Promise<unknown>;
}

export interface AgentTraceModuleView {
  defaultTurnTraceDir(root: string): string;
  defaultTurnTraceFile(root: string): string;
  createTurnTraceArchive(dir: string, options: { readonly legacyFile?: string; readonly secrets: readonly string[] }): AgentTraceStoreView;
  formatTurnTraceList(traces: readonly unknown[]): string;
  formatTurnTrace(trace: unknown, options: { readonly timeline: boolean }): string;
}

export interface AgentModuleView {
  buildAgentSurfaceInfoReport(root: string): Promise<unknown>;
  formatAgentSurfaceInfoReport(report: never): string;
}

export interface InstanceCliModule {
  resolveDatabaseConfig(projectRoot: string, config: never): Promise<unknown>;
  createDatabaseHost(config: never): ProjectDatabaseHost;
  parseComponentDefinition(value: unknown): ComponentDefinitionView;
  renderToSegments(node: never, options: Readonly<Record<string, unknown>>): Promise<readonly unknown[]>;
  openProjectEngagementJournal(root: string): Promise<{ readonly journal: EngagementJournalView; close(): Promise<void> } | null>;
  describeEngagement(engagementId: string, events: readonly unknown[]): { readonly summary: unknown; readonly board: unknown };
  formatEngagementCollaborationGraph(summary: never, events?: readonly never[]): string;
  formatEngagementList(summaries: readonly never[]): string;
  loadAgentModule(): Promise<AgentModuleView>;
  loadAgentTraceModule(): Promise<AgentTraceModuleView>;
  // `zhin migrate inference` drives these modules field by field; their shapes stay owned by the instance.
  loadInferenceMigrationSessionBindings(): Promise<any>;
  loadInferenceMigrationPreview(): Promise<any>;
  loadInferenceMigrationApply(): Promise<any>;
}

export function importProjectInstance(projectRoot: string): Promise<InstanceModule> {
  return importProjectModule<InstanceModule>(projectRoot, INSTANCE_ENTRY);
}

export function importProjectInstanceCli(projectRoot: string): Promise<InstanceCliModule> {
  return importProjectModule<InstanceCliModule>(projectRoot, INSTANCE_CLI_ENTRY);
}
