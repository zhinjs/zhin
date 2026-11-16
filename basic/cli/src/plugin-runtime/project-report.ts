/**
 * Readable plans for `zhin runtime build|publish|inspect` (#1250 `runtime-publish-silent-noop`,
 * `runtime-inspect-raw-json-only`): what will run, what is skipped and why, and an explicit line
 * when there is nothing to do. Pure functions over the project graph so they are tested directly.
 */
import { relative } from 'node:path';
import type { ProjectGraph, PluginGraphNode, ResolvedPackage } from '@zhin.js/runtime';
import type { ProjectPlan } from './project-commands.js';

export interface PlannedPackage {
  readonly name: string;
  readonly version: string | null;
  /** Workspace-relative directory (`.` for the project root). */
  readonly path: string;
}

export interface SkippedPackage extends PlannedPackage {
  readonly reason: string;
}

export interface PublishPlanReport {
  readonly kind: 'publish';
  readonly mode: 'dry-run' | 'execute';
  readonly targetTag: string;
  readonly stagingTag: string | null;
  readonly packages: readonly PlannedPackage[];
  readonly skipped: readonly SkippedPackage[];
  readonly empty: boolean;
  readonly steps: readonly { readonly id: string; readonly phase: string; readonly command: string }[];
}

export interface BuildPlanReport {
  readonly kind: 'build';
  readonly packages: readonly PlannedPackage[];
  readonly skipped: readonly SkippedPackage[];
  readonly empty: boolean;
}

export const PRIVATE_PACKAGE_REASON = 'package.json 中 private: true（不会发布到 npm）';
export const NO_BUILD_SCRIPT_REASON = 'package.json 没有 build 脚本';

function packageVersion(pkg: ResolvedPackage): string | null {
  const version = pkg.packageJson.version;
  return typeof version === 'string' && version.trim() ? version : null;
}

function planned(root: string, pkg: ResolvedPackage): PlannedPackage {
  return { name: pkg.name, version: packageVersion(pkg), path: relative(root, pkg.root).split('\\').join('/') || '.' };
}

function workspacePackages(graph: ProjectGraph): readonly ResolvedPackage[] {
  return graph.buildOrder.filter((pkg) => pkg.source === 'workspace');
}

export function describePublishPlan(root: string, graph: ProjectGraph, plan: ProjectPlan): PublishPlanReport {
  const publishing = new Set(plan.steps.filter((step) => step.phase === 'publish').map((step) => step.packageName));
  const packages: PlannedPackage[] = [];
  const skipped: SkippedPackage[] = [];
  for (const pkg of workspacePackages(graph)) {
    if (publishing.has(pkg.name)) packages.push(planned(root, pkg));
    else if (pkg.packageJson.private) skipped.push({ ...planned(root, pkg), reason: PRIVATE_PACKAGE_REASON });
  }
  return {
    kind: 'publish',
    mode: plan.mode ?? 'dry-run',
    targetTag: plan.targetTag ?? 'latest',
    stagingTag: plan.mode === 'execute' ? plan.stagingTag ?? null : null,
    packages,
    skipped,
    empty: packages.length === 0,
    steps: plan.steps.map((step) => ({ id: step.id, phase: step.phase, command: [step.command, ...step.args].join(' ') })),
  };
}

export function describeBuildPlan(root: string, graph: ProjectGraph, plan: ProjectPlan): BuildPlanReport {
  const building = new Set(plan.steps.map((step) => step.packageName));
  const packages: PlannedPackage[] = [];
  const skipped: SkippedPackage[] = [];
  for (const pkg of workspacePackages(graph)) {
    if (building.has(pkg.name)) packages.push(planned(root, pkg));
    else skipped.push({ ...planned(root, pkg), reason: NO_BUILD_SCRIPT_REASON });
  }
  return { kind: 'build', packages, skipped, empty: packages.length === 0 };
}

function packageLine(pkg: PlannedPackage): string {
  return `  - ${pkg.name}@${pkg.version ?? '（未声明版本）'}  ${pkg.path}`;
}

function skippedLines(skipped: readonly SkippedPackage[]): string[] {
  if (skipped.length === 0) return [];
  return ['', `跳过 ${skipped.length} 个 workspace 包:`, ...skipped.map((pkg) => `${packageLine(pkg)} — ${pkg.reason}`)];
}

export function formatPublishPlan(report: PublishPlanReport): string[] {
  if (report.empty) {
    const total = report.skipped.length;
    return [
      total > 1
        ? `没有可发布的包：${total} 个 workspace 包都是 private（package.json 中 private: true）。`
        : total === 1
          ? `没有可发布的包：唯一的 workspace 包 ${report.skipped[0]!.name} 是 private（package.json 中 private: true）。`
          : '没有可发布的包：没有找到 workspace 包。',
      ...skippedLines(report.skipped),
      '',
      '要发布某个包，先去掉它 package.json 中的 private: true 并写好 version；发布单个插件也可以在插件目录里用 zhin pub。',
    ];
  }
  const head = report.mode === 'execute'
    ? `发布计划（执行）：${report.packages.length} 个包先以临时 dist-tag ${report.stagingTag} 发布，全部成功后改为 ${report.targetTag}，再移除临时 tag`
    : `发布计划（dry-run，不会上传）：${report.packages.length} 个包，目标 dist-tag ${report.targetTag}`;
  return [
    head,
    ...report.packages.map(packageLine),
    ...skippedLines(report.skipped),
    ...(report.mode === 'dry-run'
      ? ['', '下面逐个运行 pnpm publish --dry-run 检查打包内容；确认后加 --execute 真正发布（需要 npm 登录）。']
      : []),
  ];
}

export function formatBuildPlan(report: BuildPlanReport): string[] {
  if (report.empty) {
    return [
      report.skipped.length > 1
        ? `没有需要构建的包：${report.skipped.length} 个 workspace 包都没有 build 脚本。`
        : report.skipped.length === 1
          ? `没有需要构建的包：唯一的 workspace 包 ${report.skipped[0]!.name} 没有 build 脚本。`
        : '没有需要构建的包：没有找到 workspace 包。',
      ...skippedLines(report.skipped),
    ];
  }
  return [
    `构建计划：按依赖顺序构建 ${report.packages.length} 个 workspace 包`,
    ...report.packages.map(packageLine),
    ...skippedLines(report.skipped),
  ];
}

/** One application Plugin instance of `zhin.config.yml` (`plugins` + `disable_plugins`). */
export interface DeclaredInstance {
  readonly instanceKey: string;
  readonly package: string;
  readonly enabled: boolean;
}

export interface InspectRow {
  readonly instanceKey: string;
  readonly package: string;
  readonly source: 'workspace' | 'node_modules' | 'local' | null;
  readonly enabled: boolean;
  readonly features: number | null;
  readonly children: number | null;
}

export interface InspectSummary {
  readonly root: { readonly package: string; readonly features: number };
  readonly instances: readonly InspectRow[];
  readonly enabled: number;
  readonly disabled: number;
  readonly buildOrder: readonly string[];
}

/**
 * Rows for every declared instance, in declaration order: enabled ones from the graph, disabled ones
 * (`disable_plugins`, absent from the graph) marked 已停用 instead of silently left out.
 */
export function summarizeProjectGraph(graph: ProjectGraph, declared: readonly DeclaredInstance[]): InspectSummary {
  const children = new Map<string, PluginGraphNode>(graph.root.children.map((node) => [node.instanceKey, node]));
  const rows: InspectRow[] = [];
  const seen = new Set<string>();
  const row = (node: PluginGraphNode): InspectRow => ({
    instanceKey: node.instanceKey,
    package: node.package.name,
    source: node.package.source,
    enabled: true,
    features: node.features.length,
    children: node.children.length,
  });
  for (const instance of declared) {
    seen.add(instance.instanceKey);
    const node = children.get(instance.instanceKey);
    if (node) rows.push(row(node));
    else {
      const pkg = graph.packages.get(instance.package);
      rows.push({
        instanceKey: instance.instanceKey,
        package: pkg?.name ?? instance.package,
        source: pkg?.source ?? null,
        enabled: instance.enabled,
        features: null,
        children: null,
      });
    }
  }
  for (const node of graph.root.children) if (!seen.has(node.instanceKey)) rows.push(row(node));
  const enabled = rows.filter((item) => item.enabled).length;
  return {
    root: { package: graph.root.package.name, features: graph.root.features.length },
    instances: rows,
    enabled,
    disabled: rows.length - enabled,
    buildOrder: graph.buildOrder.map((pkg) => pkg.name),
  };
}

const SOURCE_LABELS: Readonly<Record<string, string>> = { workspace: 'workspace', node_modules: 'node_modules', local: '本地路径' };

function width(text: string): number {
  let total = 0;
  for (const char of text) total += /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u.test(char) ? 2 : 1;
  return total;
}

function pad(text: string, size: number): string {
  return text + ' '.repeat(Math.max(0, size - width(text)));
}

export function formatInspectSummary(summary: InspectSummary): string[] {
  const header = ['实例', '包', '来源', '状态', 'features'];
  const body = summary.instances.map((item) => [
    item.instanceKey,
    item.package,
    item.source ? SOURCE_LABELS[item.source] ?? item.source : '—',
    item.enabled ? '启用' : '已停用',
    item.features === null ? '—' : String(item.features),
  ]);
  const widths = header.map((cell, index) => Math.max(width(cell), ...body.map((cells) => width(cells[index]!))));
  const line = (cells: readonly string[]) => cells.map((cell, index) => index === cells.length - 1 ? cell : pad(cell, widths[index]!)).join('  ').trimEnd();
  return [
    `根插件: ${summary.root.package}（features ${summary.root.features}）`,
    `插件实例: ${summary.instances.length} 个（启用 ${summary.enabled}，已停用 ${summary.disabled}）`,
    '',
    ...(summary.instances.length > 0 ? [line(header), ...body.map(line)] : ['（zhin.config.yml 的 plugins 中没有声明实例）']),
    '',
    `构建顺序: ${summary.buildOrder.length} 个包；完整结构（含每个实例的 features 与子插件）用 --json 查看`,
  ];
}
