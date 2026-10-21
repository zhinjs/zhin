import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

/**
 * Version ranges that scaffolds write into new bot projects instead of `latest`.
 *
 * They are derived from the real package versions of the release that ships this package:
 * - published package: `prepack` writes `lib/stack-version-ranges.json` from the monorepo,
 *   so the ranges match the versions released together with it;
 * - inside the zhin monorepo (source / tests / local builds): read live from the workspace.
 * Anything unknown keeps the `latest` fallback, so a scaffold never writes an invalid range.
 */

/** File written next to the compiled module at pack time. */
export const STACK_VERSION_RANGES_FILE = 'stack-version-ranges.json';

/** Written when no derived range is known for a package. */
export const FALLBACK_DEPENDENCY_RANGE = 'latest';

/** Zhin packages whose peerDependencies define the supported third-party AI stack. */
const THIRD_PARTY_RANGE_SOURCES = ['@zhin.js/ai', '@zhin.js/agent'] as const;

export interface StackVersionRanges {
  readonly [packageName: string]: string;
}

interface WorkspaceManifest {
  readonly name?: string;
  readonly version?: string;
  readonly private?: boolean;
  readonly peerDependencies?: Record<string, string>;
}

function isZhinPackageName(name: string): boolean {
  return name === 'zhin.js' || name.startsWith('@zhin.js/');
}

/** `1.2.3-beta.1` → `^1.2.3-beta.1`; anything that is not a version yields `undefined`. */
export function caretRangeFromVersion(version: string | undefined): string | undefined {
  if (typeof version !== 'string') return undefined;
  const match = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/u.exec(version.trim());
  if (!match) return undefined;
  return `^${match[0]}`;
}

function readManifest(directory: string): WorkspaceManifest | undefined {
  const manifestPath = path.join(directory, 'package.json');
  if (!fs.existsSync(manifestPath)) return undefined;
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as WorkspaceManifest;
}

function workspacePackageDirectories(workspaceRoot: string): string[] {
  const workspaceFile = path.join(workspaceRoot, 'pnpm-workspace.yaml');
  const workspace = parseYaml(fs.readFileSync(workspaceFile, 'utf8')) as { packages?: unknown };
  const patterns = Array.isArray(workspace.packages)
    ? workspace.packages.filter((pattern): pattern is string => typeof pattern === 'string')
    : [];
  const directories: string[] = [];
  for (const pattern of patterns) {
    if (!pattern.endsWith('/*')) {
      directories.push(path.join(workspaceRoot, pattern));
      continue;
    }
    const parent = path.join(workspaceRoot, pattern.slice(0, -2));
    if (!fs.existsSync(parent)) continue;
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(path.join(parent, entry.name));
    }
  }
  return directories;
}

/**
 * Collect ranges from a zhin monorepo checkout: `^<version>` for every published Zhin package,
 * plus the third-party AI ranges Zhin itself declares as peers.
 */
export function collectStackVersionRanges(workspaceRoot: string): StackVersionRanges {
  const ranges: Record<string, string> = {};
  const manifestsByName = new Map<string, WorkspaceManifest>();
  for (const directory of workspacePackageDirectories(workspaceRoot)) {
    const manifest = readManifest(directory);
    if (!manifest?.name) continue;
    manifestsByName.set(manifest.name, manifest);
    if (manifest.private === true) continue;
    if (!isZhinPackageName(manifest.name)) continue;
    const range = caretRangeFromVersion(manifest.version);
    if (range) ranges[manifest.name] = range;
  }
  for (const sourceName of THIRD_PARTY_RANGE_SOURCES) {
    const peers = manifestsByName.get(sourceName)?.peerDependencies ?? {};
    for (const [peerName, peerRange] of Object.entries(peers)) {
      if (isZhinPackageName(peerName)) continue;
      if (peerRange.startsWith('workspace:')) continue;
      ranges[peerName] ??= peerRange;
    }
  }
  const sortedEntries = Object.entries(ranges).sort(([left], [right]) => left.localeCompare(right));
  return Object.freeze(Object.fromEntries(sortedEntries));
}

/** Nearest ancestor that is the zhin monorepo root, if this module runs from a checkout. */
export function findZhinWorkspaceRoot(startDirectory: string): string | undefined {
  let directory = startDirectory;
  for (;;) {
    const isWorkspaceRoot = fs.existsSync(path.join(directory, 'pnpm-workspace.yaml'))
      && fs.existsSync(path.join(directory, 'packages/toolkit/scaffold-wizard/package.json'));
    if (isWorkspaceRoot) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function readPackedRanges(moduleDirectory: string): StackVersionRanges | undefined {
  const rangesFile = path.join(moduleDirectory, STACK_VERSION_RANGES_FILE);
  if (!fs.existsSync(rangesFile)) return undefined;
  return Object.freeze(JSON.parse(fs.readFileSync(rangesFile, 'utf8')) as StackVersionRanges);
}

let cachedRanges: StackVersionRanges | undefined;

/** Ranges for this installation: packed file, then a live monorepo checkout, else none. */
export function loadStackVersionRanges(): StackVersionRanges {
  if (cachedRanges) return cachedRanges;
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const packedRanges = readPackedRanges(moduleDirectory);
  if (packedRanges) {
    cachedRanges = packedRanges;
    return cachedRanges;
  }
  const workspaceRoot = findZhinWorkspaceRoot(moduleDirectory);
  cachedRanges = workspaceRoot ? collectStackVersionRanges(workspaceRoot) : Object.freeze({});
  return cachedRanges;
}

/** Range to write for one package; `latest` only when no release version is known. */
export function scaffoldDependencyRange(
  packageName: string,
  ranges: StackVersionRanges = loadStackVersionRanges(),
): string {
  return ranges[packageName] ?? FALLBACK_DEPENDENCY_RANGE;
}

/**
 * Replace `latest` entries with derived ranges before a scaffold writes package.json.
 * Explicit ranges (database drivers, tooling) and packages without a known version stay as they are.
 */
export function withScaffoldVersionRanges(
  dependencies: Readonly<Record<string, string>>,
  ranges: StackVersionRanges = loadStackVersionRanges(),
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [packageName, range] of Object.entries(dependencies)) {
    const isFloating = range === FALLBACK_DEPENDENCY_RANGE;
    resolved[packageName] = isFloating ? scaffoldDependencyRange(packageName, ranges) : range;
  }
  return resolved;
}
