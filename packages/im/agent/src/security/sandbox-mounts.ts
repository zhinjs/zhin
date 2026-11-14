/**
 * Read-only overlays for an isolated shell (#1030 P0-c).
 *
 * The container mounts the workspace read-write, so the policy layer's string detection of
 * `echo x > AGENTS.md` is only a first line. These overlays are the enforcement: the host
 * self-configuration paths (list A + B, see `host-config-paths.ts`) are bind-mounted read-only on
 * top of the writable workspace, so no shell trick (`sed -i`, symlink, `mv`, `rm -rf`) can change
 * them. `danger-full-access` does not exempt them — it simply has no container (residual risk,
 * see `docs/ai/default-behavior.md`).
 *
 * Overlay kinds:
 *  - `bind-file` / `bind-dir`: an existing host path, bound read-only at the same relative path.
 *  - `tmpfs-dir`: a *missing* directory (e.g. `skills/`) so it cannot be created. Docker creates
 *    the mount point on the host, so the executor removes it again afterwards if it is still empty.
 *  - Missing **files** get no overlay. Docker would create an empty placeholder on the host for the
 *    run, and an empty `zhin.config.*` / lockfile / `.pnpmfile.cjs` visible to the host (hot reload,
 *    config discovery, package manager) is worse than the gap. Creating one stays covered only by
 *    the policy-layer detection.
 *
 * Bounds: the `node_modules` scan walks at most {@link NODE_MODULES_SCAN_DEPTH} levels below the
 * mounted directory, visits at most {@link NODE_MODULES_SCAN_MAX_DIRS} directories, never descends
 * into `node_modules`, `.git` or symlinks, and yields at most {@link NODE_MODULES_SCAN_MAX_HITS}
 * overlays. A deeper `node_modules` is still refused by the policy layer.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ToolProtectedPathData } from '@zhin.js/tool';
import { DEFAULT_SELF_DIRS, DEFAULT_SELF_FILES, LOCKFILE_NAMES } from './host-config-paths.js';

export type ReadOnlyOverlayKind = 'bind-file' | 'bind-dir' | 'tmpfs-dir';

export interface ReadOnlyOverlay {
  readonly kind: ReadOnlyOverlayKind;
  /** Path inside the mount, relative to the mounted directory, posix separators. */
  readonly target: string;
  /** Host absolute path (bind kinds only). */
  readonly source?: string;
}

export const NODE_MODULES_SCAN_DEPTH = 4;
export const NODE_MODULES_SCAN_MAX_DIRS = 2000;
export const NODE_MODULES_SCAN_MAX_HITS = 64;

/** Container-side mount point of the workspace. */
export const CONTAINER_WORKSPACE = '/workspace';

const ENV_FILE = /^\.env(?:\..*)?$/iu;
/** Root-level paths `file-policy.ts#checkFileAccess` refuses, beyond the lists above. */
const POLICY_ROOT_DIRS = ['.zhin'] as const;
const POLICY_ROOT_FILES = ['.npmrc'] as const;
/** `data/memory` and `data/media` stay writable for the memory/media tools; every other child is list A. */
const DATA_WRITABLE_CHILDREN = new Set(['memory', 'media']);

const fold = (value: string): string => value.replace(/\\/g, '/').toLowerCase();

function safeRealpath(target: string): string | undefined {
  try {
    return fs.realpathSync(target);
  } catch {
    return undefined;
  }
}

/** Realpath of the nearest existing ancestor plus the missing tail. */
function realpathOfMissing(target: string): string {
  const tail: string[] = [];
  let cursor = target;
  for (;;) {
    const real = safeRealpath(cursor);
    if (real) return path.join(real, ...tail.reverse());
    const parent = path.dirname(cursor);
    if (parent === cursor) return target;
    tail.push(path.basename(cursor));
    cursor = parent;
  }
}

function within(parent: string, child: string): boolean {
  if (child === parent) return true;
  const prefix = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child.startsWith(prefix);
}

/** Resolves case-folded relative segments under `base`, matching directory entries case-insensitively. */
function resolveFolded(
  base: string,
  foldedRel: string,
  listing: (dir: string) => string[] | undefined,
  originalCase: ReadonlyMap<string, string>,
): { abs: string; exists: boolean } {
  let cursor = base;
  const segments = foldedRel.split('/').filter(Boolean);
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i]!;
    const entries = listing(cursor);
    const hit = entries?.find(name => name === seg) ?? entries?.find(name => fold(name) === seg);
    if (hit !== undefined) {
      cursor = path.join(cursor, hit);
      continue;
    }
    const original = (originalCase.get(foldedRel) ?? foldedRel).split('/').filter(Boolean);
    return { abs: path.join(cursor, ...original.slice(i)), exists: false };
  }
  return { abs: cursor, exists: true };
}

function makeListing(): (dir: string) => string[] | undefined {
  const cache = new Map<string, string[] | undefined>();
  return (dir) => {
    if (!cache.has(dir)) {
      try {
        cache.set(dir, fs.readdirSync(dir));
      } catch {
        cache.set(dir, undefined);
      }
    }
    return cache.get(dir);
  };
}

interface Candidate {
  readonly abs: string;
  readonly exists: boolean;
  /** Treated as a directory when absent. */
  readonly isDir: boolean;
}

/**
 * The project root the self-path overlays anchor to: the injected `projectRoot` (realpath), else
 * the first case-folded root resolved against the filesystem; without data the (realpathed)
 * mounted directory stands in for it. `undefined` when the injected root does not exist.
 */
function resolveProjectAnchor(
  mount: string,
  protectedPaths: ToolProtectedPathData | undefined,
  listing: (dir: string) => string[] | undefined,
): string | undefined {
  if (!protectedPaths) return mount;
  return protectedPaths.projectRoot
    ? safeRealpath(protectedPaths.projectRoot)
    : resolveFolded('/', protectedPaths.roots[0] ?? '', listing, new Map()).abs;
}

/**
 * Overlays for one mounted directory. `protectedPaths` is `undefined` when the host injected
 * nothing: the conventional names are then anchored to the mounted directory itself (fail closed).
 * `mountDir` must be the directory handed to `docker run -v`.
 */
export function computeReadOnlyOverlays(
  mountDir: string,
  protectedPaths: ToolProtectedPathData | undefined,
): ReadOnlyOverlay[] {
  return computeOverlaySet(mountDir, protectedPaths).overlays;
}

function computeOverlaySet(
  mountDir: string,
  protectedPaths: ToolProtectedPathData | undefined,
): { overlays: ReadOnlyOverlay[]; hidden: ReadOnlyOverlay[] } {
  const mount = safeRealpath(mountDir);
  if (!mount) return { overlays: [], hidden: [] };
  const listing = makeListing();
  const candidates: Candidate[] = [];

  const resolveFrom = (base: string, foldedRel: string, isDir: boolean, originals: ReadonlyMap<string, string>) => {
    const { abs, exists } = resolveFolded(base, foldedRel, listing, originals);
    candidates.push({ abs, exists, isDir });
  };

  const defaultFiles = new Map(DEFAULT_SELF_FILES.map(name => [fold(name), name] as const));
  const defaultDirs = new Map(DEFAULT_SELF_DIRS.map(name => [fold(name), name] as const));
  const lockfiles = LOCKFILE_NAMES.map(fold);

  const projectRoot = resolveProjectAnchor(mount, protectedPaths, listing);
  const anchors = new Set<string>();
  if (projectRoot) anchors.add(projectRoot);

  const selfFiles = protectedPaths ? [...protectedPaths.selfFiles] : [...defaultFiles.keys()];
  const selfDirs = protectedPaths ? [...protectedPaths.selfDirs] : [...defaultDirs.keys()];
  for (const root of anchors) {
    for (const rel of selfFiles) resolveFrom(root, rel, false, defaultFiles);
    for (const rel of lockfiles) resolveFrom(root, rel, false, new Map());
    for (const rel of selfDirs) resolveFrom(root, rel, true, defaultDirs);
    // checkFileAccess denials anchored to the project root.
    for (const dir of POLICY_ROOT_DIRS) resolveFrom(root, dir, true, new Map());
    for (const file of POLICY_ROOT_FILES) resolveFrom(root, file, false, new Map());
    for (const name of listing(root) ?? []) {
      if (ENV_FILE.test(name)) candidates.push({ abs: path.join(root, name), exists: true, isDir: false });
    }
    const dataDir = path.join(root, 'data');
    for (const name of listing(dataDir) ?? []) {
      if (!DATA_WRITABLE_CHILDREN.has(name.toLowerCase())) {
        candidates.push({ abs: path.join(dataDir, name), exists: true, isDir: false });
      }
    }
  }
  for (const file of protectedPaths?.denyFiles ?? []) {
    // Absolute and case-folded: walk down from the mount when it lies on that path.
    const folded = fold(mount);
    if (!file.startsWith(`${folded}/`)) continue;
    resolveFrom(mount, file.slice(folded.length + 1), false, new Map());
  }

  const overlays = new Map<string, ReadOnlyOverlay>();
  const add = (overlay: ReadOnlyOverlay) => {
    if (!overlays.has(overlay.target)) overlays.set(overlay.target, overlay);
  };
  const toTarget = (abs: string): string | undefined => {
    const real = safeRealpath(abs);
    const lexical = real ?? abs;
    if (!within(mount, lexical) || lexical === mount) return undefined;
    return path.relative(mount, lexical).split(path.sep).join('/');
  };

  for (const candidate of candidates) {
    if (candidate.exists) {
      const real = safeRealpath(candidate.abs);
      if (!real) continue;
      const target = toTarget(real);
      if (!target) continue;
      let stat: fs.Stats;
      try { stat = fs.statSync(real); } catch { continue; }
      if (stat.isDirectory()) add({ kind: 'bind-dir', target, source: real });
      else if (stat.isFile()) add({ kind: 'bind-file', target, source: real });
    } else if (candidate.isDir) {
      // A missing path's parent may itself be a symlink out of the mount; compare lexically after
      // resolving the parent.
      const target = toTarget(realpathOfMissing(candidate.abs));
      if (target && !target.split('/').includes('.git')) add({ kind: 'tmpfs-dir', target });
    }
  }

  // node_modules: any depth under the mount (bounded scan) + the mount root itself.
  for (const rel of scanNodeModules(mount)) {
    add({ kind: 'bind-dir', target: rel, source: path.join(mount, ...rel.split('/')) });
  }
  if (!fs.existsSync(path.join(mount, 'node_modules'))) add({ kind: 'tmpfs-dir', target: 'node_modules' });

  // `.zhin/` (the gateway's account store, the project keys, the control socket — ADR 0059 §7) is
  // hidden, not only read-only: an empty read-only tmpfs takes its place inside the container.
  const hidden = new Set([...anchors].flatMap(root => POLICY_ROOT_DIRS.map(dir => safeRealpath(path.join(root, dir)))).filter((value): value is string => !!value));
  const hiddenOverlays: ReadOnlyOverlay[] = [];
  for (const [target, overlay] of overlays) {
    if (overlay.kind === 'bind-dir' && overlay.source && hidden.has(overlay.source)) {
      const replacement: ReadOnlyOverlay = { kind: 'tmpfs-dir', target };
      overlays.set(target, replacement);
      hiddenOverlays.push(replacement);
    }
  }
  return { overlays: pruneOverlays([...overlays.values()]), hidden: hiddenOverlays };
}

/** Bounded scan; see the module comment for the limits. */
export function scanNodeModules(mount: string): string[] {
  const hits: string[] = [];
  let visited = 0;
  let level: string[] = [''];
  for (let depth = 0; depth <= NODE_MODULES_SCAN_DEPTH && level.length > 0; depth += 1) {
    const next: string[] = [];
    for (const rel of level) {
      if (visited >= NODE_MODULES_SCAN_MAX_DIRS || hits.length >= NODE_MODULES_SCAN_MAX_HITS) return hits;
      visited += 1;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(path.join(mount, rel), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue; // symlinks are not directories here, so never followed
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.name === 'node_modules') {
          if (hits.length < NODE_MODULES_SCAN_MAX_HITS) hits.push(childRel);
        } else if (entry.name !== '.git') {
          next.push(childRel);
        }
      }
    }
    level = next;
  }
  return hits;
}

/** Parents first; entries below a directory overlay are already covered by it. */
function pruneOverlays(overlays: readonly ReadOnlyOverlay[]): ReadOnlyOverlay[] {
  const sorted = [...overlays].sort((a, b) => a.target.split('/').length - b.target.split('/').length
    || a.target.localeCompare(b.target));
  const kept: ReadOnlyOverlay[] = [];
  for (const overlay of sorted) {
    const covered = kept.some(parent => parent.kind !== 'bind-file' && overlay.target.startsWith(`${parent.target}/`));
    if (!covered) kept.push(overlay);
  }
  return kept;
}

/** One `--mount` field value, CSV-quoted when it carries a comma or a quote. */
function mountField(key: string, value: string): string {
  const raw = `${key}=${value}`;
  return /[,"]/u.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

/** `docker run` arguments that apply the overlays (after the writable workspace mount). */
export function overlayDockerArgs(overlays: readonly ReadOnlyOverlay[]): string[] {
  const args: string[] = [];
  for (const overlay of overlays) {
    const target = `${CONTAINER_WORKSPACE}/${overlay.target}`;
    if (overlay.kind === 'tmpfs-dir') {
      args.push('--mount', ['type=tmpfs', mountField('target', target), 'tmpfs-size=4096', 'readonly'].join(','));
    } else if (overlay.source) {
      args.push('--mount', ['type=bind', mountField('source', overlay.source), mountField('target', target), 'readonly'].join(','));
    }
  }
  return args;
}

/**
 * The overlays that hide `.zhin/` (the gateway's account store, the project keys, the control
 * socket — ADR 0059 §7) under the mounted directory: an empty read-only tmpfs over each existing
 * `.zhin` of the project roots. Applied in every mode, read-only turns included (a read-only mount
 * alone would still let `find . -type f -exec cat {} +` read gateway.db).
 */
export function computeHiddenOverlays(mountDir: string, protectedPaths?: ToolProtectedPathData): ReadOnlyOverlay[] {
  return computeOverlaySet(mountDir, protectedPaths).hidden;
}

/**
 * Directories Docker will create on the host for `tmpfs-dir` mount points that do not exist yet.
 * Returned deepest-last so cleanup can walk them in reverse.
 */
export function missingMountPointDirs(mountDir: string, overlays: readonly ReadOnlyOverlay[]): string[] {
  const missing: string[] = [];
  for (const overlay of overlays) {
    if (overlay.kind !== 'tmpfs-dir') continue;
    const segments = overlay.target.split('/');
    for (let i = 1; i <= segments.length; i += 1) {
      const dir = path.join(mountDir, ...segments.slice(0, i));
      if (!fs.existsSync(dir) && !missing.includes(dir)) missing.push(dir);
    }
  }
  return missing;
}

/** Removes mount-point directories created for the run, if they are still empty. */
export function removeMountPointDirs(created: readonly string[]): void {
  for (const dir of [...created].reverse()) {
    try {
      fs.rmdirSync(dir);
    } catch {
      // not empty or already gone: leave it
    }
  }
}

/** One self file the isolated shell created that was moved aside after the run. */
export interface QuarantinedSelfFile {
  /** Name the shell created, directly under the project root. */
  readonly name: string;
  /** Name it was renamed to (same directory). */
  readonly quarantinedAs: string;
  /** Set when the rename failed: the file is still in place under its original name. */
  readonly error?: string;
}

/**
 * Case-folded names of the self files directly under the project root: {@link DEFAULT_SELF_FILES}
 * plus the root-level entries of the host-injected `selfFiles`.
 */
export function rootSelfFileNames(protectedPaths?: ToolProtectedPathData): ReadonlySet<string> {
  const names = new Set(DEFAULT_SELF_FILES.map(fold));
  for (const rel of protectedPaths?.selfFiles ?? []) {
    if (!rel.includes('/')) names.add(fold(rel));
  }
  return names;
}

/**
 * The project root the self-file overlays anchor to, resolved exactly like
 * {@link computeReadOnlyOverlays} does (realpath; `roots[0]` without `projectRoot`; the mounted
 * directory without data). `undefined` when it cannot be resolved.
 */
export function selfFileAnchor(mountDir: string, protectedPaths?: ToolProtectedPathData): string | undefined {
  const mount = safeRealpath(mountDir);
  if (!mount) return undefined;
  return resolveProjectAnchor(mount, protectedPaths, makeListing());
}

/** Names (original case) of the self files that exist directly under `projectRoot` right now. */
export function snapshotRootSelfFiles(projectRoot: string, names: ReadonlySet<string>): ReadonlySet<string> {
  let entries: string[];
  try {
    entries = fs.readdirSync(projectRoot);
  } catch {
    return new Set();
  }
  return new Set(entries.filter(entry => names.has(fold(entry))));
}

/**
 * Read-only overlays only cover self files that existed before the run (a missing file gets no
 * overlay, see the module comment). After an isolated-shell run, a self file that did not exist
 * before and exists now — e.g. a new `BOT.md`, which would replace `AGENTS.md` as the bot's
 * instructions — is renamed to `<name>.quarantined-<timestamp>` so the host never loads it.
 */
export function quarantineNewSelfFiles(
  projectRoot: string,
  names: ReadonlySet<string>,
  before: ReadonlySet<string>,
  now: number = Date.now(),
): QuarantinedSelfFile[] {
  const quarantined: QuarantinedSelfFile[] = [];
  for (const name of snapshotRootSelfFiles(projectRoot, names)) {
    if (before.has(name)) continue;
    let quarantinedAs = `${name}.quarantined-${now}`;
    for (let n = 1; fs.existsSync(path.join(projectRoot, quarantinedAs)); n += 1) {
      quarantinedAs = `${name}.quarantined-${now}-${n}`;
    }
    try {
      fs.renameSync(path.join(projectRoot, name), path.join(projectRoot, quarantinedAs));
      quarantined.push({ name, quarantinedAs });
    } catch (error) {
      if (!fs.existsSync(path.join(projectRoot, name))) continue; // gone already
      quarantined.push({ name, quarantinedAs, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return quarantined;
}
