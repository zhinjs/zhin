/**
 * 受控自我进化：变更预览（ADR 0040 §2，切片 B）。
 *
 * 预览由宿主生成，随审批卡展示，并以 `plan` 写进 `change.json`：
 * - 每个文件的 diff 摘要（新建 / 修改 / 删除，增删行数）；
 * - 影响面：文件交给 `InvalidationPlanner.plan()`（经 {@link SelfChangeImpactPort} 注入，agent 层不依赖 runtime），
 *   `configPatch` 按配置段的重载级别并入——宿主段（`HOST_CONFIG_KEYS`）需重启，插件段热重载该插件，
 *   与 Console `config:patch` 的 `restartRequired` 同一口径。
 *
 * 只读：不写生产目录，读现有文件有大小上限，不跟随符号链接。
 */
import { lstat, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { MAX_CHANGE_BYTES, canonicalJson, type SelfChangeConfigPatch, type SelfChangeFileEntry } from './policy.js';

/** 预览（`plan`）序列化上限，防止异常大的影响面挤占暂存区。 */
export const MAX_CHANGE_PREVIEW_BYTES = 64 * 1024;
/** 影响面里每类列表最多保留的条目数。 */
const MAX_IMPACT_ITEMS = 50;
const MAX_REASON_CHARS = 200;
const MAX_SUMMARY_CHARS = 200;

export type SelfChangeImpactKind = 'none' | 'generation' | 'process';

/** `InvalidationPlanner.plan()` 结果中预览需要的部分（结构类型，避免 agent → runtime 依赖）。 */
export type SelfChangeFilePlan =
  | Readonly<{ kind: 'none'; reasons: readonly string[] }>
  | Readonly<{
      kind: 'generation';
      reasons: readonly string[];
      subtrees: readonly string[];
      slots: readonly string[];
      fallbacks?: readonly Readonly<{ source: string; owners: readonly string[] }>[];
      manifestSources?: readonly string[];
    }>
  | Readonly<{ kind: 'process'; reasons: readonly string[] }>;

/** 宿主注入的影响面判定（CLI 用当前代的源码归属索引构造 `InvalidationPlanner`）。 */
export interface SelfChangeImpactPort {
  /** 目标文件的绝对路径 → 失效计划。 */
  planFiles(absolutePaths: readonly string[]): SelfChangeFilePlan;
  /** 宿主配置段（改了需重启进程）。 */
  readonly hostConfigKeys: readonly string[];
}

export interface SelfChangeFileDiff {
  readonly path: string;
  readonly kind: 'create' | 'modify' | 'delete';
  /** 新增行数（按行多重集比较的近似值）。 */
  readonly added: number;
  /** 删除行数。 */
  readonly removed: number;
  readonly bytesBefore: number | null;
  readonly bytesAfter: number;
  /** 原文件超过大小上限或不可读，行数未比较。 */
  readonly truncated?: true;
}

export interface SelfChangeConfigImpact {
  readonly kind: Exclude<SelfChangeImpactKind, 'none'>;
  /** 补丁触及的顶层配置段。 */
  readonly sections: readonly string[];
  /** 其中需重启的宿主段。 */
  readonly hostSections: readonly string[];
  readonly reasons: readonly string[];
  /** 不知道宿主段名单，按重启保守估计。 */
  readonly estimated: boolean;
}

export interface SelfChangeImpact {
  readonly kind: SelfChangeImpactKind;
  /** 将热重载的插件子树。 */
  readonly subtrees: readonly string[];
  /** 将热替换的能力槽。 */
  readonly slots: readonly string[];
  readonly reasons: readonly string[];
  /** 未接入源码归属索引或配置段级别未知时为 true：影响面是保守估计。 */
  readonly estimated: boolean;
  readonly config: SelfChangeConfigImpact | null;
}

export interface SelfChangePreview {
  readonly version: 1;
  /** 生成预览时的 `content_hash`；内容变了预览即作废。 */
  readonly contentHash: string;
  readonly summary: string | null;
  readonly files: readonly SelfChangeFileDiff[];
  readonly impact: SelfChangeImpact;
}

export interface BuildSelfChangePreviewInput {
  readonly projectRoot: string;
  readonly contentHash: string;
  readonly files: readonly SelfChangeFileEntry[];
  readonly configPatch: SelfChangeConfigPatch | null;
  /** 读暂存内容；`delete` 条目不会调用。 */
  readonly readStaged: (target: string) => Promise<string | null>;
  readonly impact?: SelfChangeImpactPort;
  readonly summary?: string | null;
}

export async function buildSelfChangePreview(input: BuildSelfChangePreviewInput): Promise<SelfChangePreview> {
  const projectRoot = path.resolve(input.projectRoot);
  const files: SelfChangeFileDiff[] = [];
  for (const entry of input.files) {
    const before = await readCurrentFile(projectRoot, entry.path);
    const after = entry.op === 'write' ? await input.readStaged(entry.path) : null;
    files.push(diffFile(entry, before, after));
  }
  const fileImpact = planFileImpact(projectRoot, input.files, input.impact);
  const config = input.configPatch ? configPatchImpact(input.configPatch, input.impact?.hostConfigKeys) : null;
  const preview: SelfChangePreview = Object.freeze({
    version: 1,
    contentHash: input.contentHash,
    summary: clip(input.summary, MAX_SUMMARY_CHARS),
    files: Object.freeze(files),
    impact: mergeImpact(fileImpact, config),
  });
  if (Buffer.byteLength(canonicalJson(preview), 'utf8') > MAX_CHANGE_PREVIEW_BYTES) {
    throw new RangeError(`change preview exceeds ${MAX_CHANGE_PREVIEW_BYTES} bytes`);
  }
  return preview;
}

/**
 * 配置补丁的重载级别：触及宿主段 → `process`；只触及插件段 → `generation`（热重载这些插件）。
 * 不知道宿主段名单时保守按 `process` 估计。
 */
export function configPatchImpact(patch: SelfChangeConfigPatch, hostConfigKeys?: readonly string[]): SelfChangeConfigImpact {
  const sections = [...new Set(patch.patches.map(operation => operation.path[0]!))].sort();
  if (!hostConfigKeys) {
    return Object.freeze({
      kind: 'process',
      sections: Object.freeze(sections),
      hostSections: Object.freeze([]),
      reasons: Object.freeze(['config reload level unknown; assuming a restart']),
      estimated: true,
    });
  }
  const host = new Set(hostConfigKeys);
  const hostSections = sections.filter(section => host.has(section));
  return Object.freeze({
    kind: hostSections.length > 0 ? 'process' : 'generation',
    sections: Object.freeze(sections),
    hostSections: Object.freeze(hostSections),
    reasons: Object.freeze(hostSections.length > 0
      ? [`host config changed: ${hostSections.join(', ')}`]
      : sections.map(section => `plugin config changed: ${section}`)),
    estimated: false,
  });
}

interface FileImpact {
  readonly kind: SelfChangeImpactKind;
  readonly subtrees: readonly string[];
  readonly slots: readonly string[];
  readonly reasons: readonly string[];
  readonly estimated: boolean;
}

function planFileImpact(projectRoot: string, files: readonly SelfChangeFileEntry[], port?: SelfChangeImpactPort): FileImpact {
  if (files.length === 0) return { kind: 'none', subtrees: [], slots: [], reasons: [], estimated: false };
  if (!port) {
    // 没有源码归属索引（例如未接入 RootRuntime 的测试宿主）：约定目录文件都由插件装配，按热重载估计。
    return { kind: 'generation', subtrees: [], slots: [], reasons: ['source ownership unavailable; assuming a hot reload'], estimated: true };
  }
  const plan = port.planFiles(files.map(file => path.join(projectRoot, ...file.path.split('/'))));
  if (plan.kind !== 'generation') return { kind: plan.kind, subtrees: [], slots: [], reasons: plan.reasons, estimated: false };
  const owners = (plan.fallbacks ?? []).flatMap(fallback => fallback.owners);
  return {
    kind: 'generation',
    subtrees: [...new Set([...plan.subtrees, ...owners])],
    slots: [...plan.slots],
    reasons: plan.reasons,
    estimated: false,
  };
}

const IMPACT_RANK: Readonly<Record<SelfChangeImpactKind, number>> = Object.freeze({ none: 0, generation: 1, process: 2 });

function mergeImpact(files: FileImpact, config: SelfChangeConfigImpact | null): SelfChangeImpact {
  const kind = config && IMPACT_RANK[config.kind] > IMPACT_RANK[files.kind] ? config.kind : files.kind;
  // 插件配置段热重载对应插件；宿主段由进程重启覆盖，不再列子树。
  const configSubtrees = config && config.kind === 'generation' ? config.sections : [];
  const subtrees = kind === 'generation' ? [...new Set([...files.subtrees, ...configSubtrees])] : [];
  const slots = kind === 'generation' ? files.slots : [];
  return Object.freeze({
    kind,
    subtrees: Object.freeze(subtrees.slice(0, MAX_IMPACT_ITEMS)),
    slots: Object.freeze(slots.slice(0, MAX_IMPACT_ITEMS)),
    reasons: Object.freeze([...new Set([...files.reasons, ...(config?.reasons ?? [])])]
      .slice(0, MAX_IMPACT_ITEMS)
      .map(reason => clip(reason, MAX_REASON_CHARS) ?? '')),
    estimated: files.estimated || config?.estimated === true,
    config,
  });
}

interface CurrentFile {
  readonly bytes: number;
  /** 超过上限或不可读时为 null。 */
  readonly content: string | null;
}

/** 读生产目录里的现有文件：不存在 → null；符号链接或超过上限只报大小，不读内容。 */
async function readCurrentFile(projectRoot: string, target: string): Promise<CurrentFile | null> {
  const absolute = path.join(projectRoot, ...target.split('/'));
  let stat;
  try {
    stat = await lstat(absolute);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size > MAX_CHANGE_BYTES) return { bytes: stat.size, content: null };
  try {
    return { bytes: stat.size, content: await readFile(absolute, 'utf8') };
  } catch {
    return { bytes: stat.size, content: null };
  }
}

function diffFile(entry: SelfChangeFileEntry, before: CurrentFile | null, after: string | null): SelfChangeFileDiff {
  if (entry.op === 'delete') {
    return Object.freeze({
      path: entry.path,
      kind: 'delete',
      added: 0,
      removed: before?.content != null ? lineCount(before.content) : 0,
      bytesBefore: before?.bytes ?? null,
      bytesAfter: 0,
      ...(before && before.content === null ? { truncated: true as const } : {}),
    });
  }
  const next = after ?? '';
  if (!before) {
    return Object.freeze({ path: entry.path, kind: 'create', added: lineCount(next), removed: 0, bytesBefore: null, bytesAfter: entry.bytes });
  }
  if (before.content === null) {
    return Object.freeze({ path: entry.path, kind: 'modify', added: lineCount(next), removed: 0, bytesBefore: before.bytes, bytesAfter: entry.bytes, truncated: true });
  }
  const { added, removed } = lineDelta(before.content, next);
  return Object.freeze({ path: entry.path, kind: 'modify', added, removed, bytesBefore: before.bytes, bytesAfter: entry.bytes });
}

function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/u);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function lineCount(text: string): number {
  return splitLines(text).length;
}

/** 按行多重集求增删行数：移动的行不计，重复行按次数计。对摘要足够，且 O(n)。 */
export function lineDelta(before: string, after: string): { added: number; removed: number } {
  const counts = new Map<string, number>();
  for (const line of splitLines(before)) counts.set(line, (counts.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of splitLines(after)) {
    const left = counts.get(line) ?? 0;
    if (left > 0) counts.set(line, left - 1);
    else added += 1;
  }
  let removed = 0;
  for (const left of counts.values()) removed += left;
  return { added, removed };
}

function clip(value: string | null | undefined, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** 给模型 / 审批卡的一行影响面描述。 */
export function describeSelfChangeImpact(impact: SelfChangeImpact): string {
  const estimated = impact.estimated ? ' (estimated)' : '';
  if (impact.kind === 'none') return `no reload needed${estimated}`;
  if (impact.kind === 'process') return `process restart required${estimated}: ${impact.reasons.join('; ') || 'host change'}`;
  const parts = [
    impact.subtrees.length > 0 ? `${impact.subtrees.length} plugin(s): ${impact.subtrees.join(', ')}` : '',
    impact.slots.length > 0 ? `${impact.slots.length} capability slot(s)` : '',
  ].filter(Boolean);
  return `hot reload${estimated}${parts.length > 0 ? ` — ${parts.join('; ')}` : ''}`;
}
