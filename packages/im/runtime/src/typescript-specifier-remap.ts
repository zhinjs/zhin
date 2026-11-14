import { readFile, stat } from 'node:fs/promises';
import { register } from 'node:module';
import { isAbsolute, relative, sep } from 'node:path';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';

interface ResolveResult {
  readonly url: string;
  readonly shortCircuit?: boolean;
  readonly format?: string;
}

/**
 * ESM resolve hook: when a relative/absolute `.js` specifier fails and a
 * sibling `.ts` / `.tsx` exists, rewrite to that source file.
 *
 * Needed for Plugin Runtime on Node 22.6–22.17 with `--experimental-strip-types`:
 * TypeScript authoring uses `.js` import suffixes, but strip-types does not
 * remap missing `.js` → `.ts` the way `tsc`/tsx do.
 */
export async function resolve(
  specifier: string,
  context: { parentURL?: string },
  nextResolve: (
    specifier: string,
    context: { parentURL?: string },
  ) => Promise<ResolveResult>,
): Promise<ResolveResult> {
  let resolved: ResolveResult;
  try {
    resolved = await nextResolve(specifier, context);
  } catch (error) {
    if (!shouldTryTypeScript(specifier, error)) throw error;
    const candidate = await firstExistingTypeScript(specifier, context.parentURL);
    if (!candidate) throw error;
    resolved = await nextResolve(candidate, context);
  }
  return inheritGenerationRevision(specifier, context.parentURL, resolved);
}

let registered = false;

/**
 * Main thread: the channel to the hooks thread. Package roots whose modules a package-name import
 * reloads with its importer (#1250 `hmr-stale-cross-package-import`) are sent over it.
 */
let control: MessagePort | undefined;
let messageSequence = 0;
const pendingAcks = new Map<number, () => void>();

/** Register once for the current process (safe to call from CLI / RootHost). */
export function ensureTypeScriptSpecifierRemap(): void {
  if (registered) return;
  registered = true;
  const channel = new MessageChannel();
  try {
    register(import.meta.url, { data: { port: channel.port2 }, transferList: [channel.port2] });
  } catch {
    // Loaders without transferable data still get the TypeScript remap.
    register(import.meta.url);
    channel.port1.close();
    return;
  }
  control = channel.port1;
  control.on('message', (message: { readonly ack?: number }) => {
    if (typeof message?.ack !== 'number') return;
    pendingAcks.get(message.ack)?.();
  });
  control.unref();
}

/**
 * Records the revision at which files of revisionable packages were invalidated (#1250). A
 * package-name import of such a file loads it at that revision, so every importer shares one
 * instance per change; files that never changed keep their unrevisioned shared instance. Resolves
 * like {@link publishRevisionablePackageRoots}.
 */
export function publishPackageFileRevisions(
  owner: string,
  revisions: ReadonlyArray<readonly [file: string, revision: string]>,
): Promise<void> {
  return post(owner, { revisions: revisions.map(([file, revision]) => [file, revision]) });
}

/**
 * Replaces the revisionable package roots one module runtime owns. Resolves once the hooks
 * thread applied them, or after a short grace period when it does not answer (the hook then
 * keeps the previous behaviour: package-name imports are not revisioned).
 */
export function publishRevisionablePackageRoots(owner: string, roots: readonly string[]): Promise<void> {
  return post(owner, { roots: [...roots] });
}

function post(owner: string, payload: Record<string, unknown>): Promise<void> {
  if (!control) return Promise.resolve();
  const id = ++messageSequence;
  const port = control;
  return new Promise<void>((resolve) => {
    // While an answer is due the port keeps the process alive; the bounded timer ends the wait.
    const settle = () => {
      clearTimeout(timer);
      pendingAcks.delete(id);
      if (pendingAcks.size === 0) port.unref();
      resolve();
    };
    const timer = setTimeout(settle, 1000);
    pendingAcks.set(id, settle);
    port.ref();
    port.postMessage({ id, owner, ...payload });
  });
}

/** Hooks thread: revisionable package roots by owning module runtime. */
const revisionableRootsByOwner = new Map<string, readonly string[]>();
/** Hooks thread: invalidated revisionable package files and their latest revision, by owner. */
const fileRevisionsByOwner = new Map<string, Map<string, string>>();

interface ControlMessage {
  readonly id?: number;
  readonly owner?: string;
  readonly roots?: readonly string[];
  readonly revisions?: ReadonlyArray<readonly [string, string]>;
}

export function initialize(data?: { readonly port?: MessagePort }): void {
  const port = data?.port;
  if (!port) return;
  port.on('message', (message: ControlMessage) => {
    applyControlMessage(message);
    if (typeof message?.id === 'number') port.postMessage({ ack: message.id });
  });
  port.unref();
}

/** Applies a control message in the hooks thread. */
function applyControlMessage(message: ControlMessage): void {
  if (typeof message?.owner !== 'string') return;
  if (Array.isArray(message.roots)) {
    if (message.roots.length === 0) {
      revisionableRootsByOwner.delete(message.owner);
      fileRevisionsByOwner.delete(message.owner);
    } else {
      revisionableRootsByOwner.set(message.owner, Object.freeze([...message.roots]));
    }
  }
  if (Array.isArray(message.revisions)) {
    const revisions = fileRevisionsByOwner.get(message.owner) ?? new Map<string, string>();
    for (const entry of message.revisions) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string') {
        revisions.set(entry[0], entry[1]);
      }
    }
    fileRevisionsByOwner.set(message.owner, revisions);
  }
}

/**
 * The revision a package-name import of this file loads at: the latest revision its module
 * runtime invalidated it at, while it lies in a revisionable root of that runtime. `undefined`
 * keeps the one shared, unrevisioned instance.
 */
function packageFileRevision(url: string): string | undefined {
  if (fileRevisionsByOwner.size === 0) return undefined;
  let path: string;
  try {
    path = fileURLToPath(url);
  } catch {
    return undefined;
  }
  if (path.split(/[\\/]/u).includes('node_modules')) return undefined;
  let latest: string | undefined;
  for (const [owner, revisions] of fileRevisionsByOwner) {
    const revision = revisions.get(path);
    if (revision === undefined) continue;
    const roots = revisionableRootsByOwner.get(owner) ?? [];
    if (!roots.some((root) => isWithin(root, path))) continue;
    if (latest === undefined || Number(revision) > Number(latest)) latest = revision;
  }
  return latest;
}

function isWithin(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

function shouldTryTypeScript(specifier: string, error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ERR_MODULE_NOT_FOUND') {
    return false;
  }
  if (specifier.startsWith('node:') || specifier.startsWith('data:')) return false;
  return /\.[cm]?js$/u.test(specifier) || specifier.endsWith('.jsx');
}

function inheritGenerationRevision(
  specifier: string,
  parentURL: string | undefined,
  resolved: ResolveResult,
): ResolveResult {
  if (!resolved.url.startsWith('file:')) return resolved;
  if (!isLocalSpecifier(specifier)) {
    // A package-name import of a mounted local Plugin package file loads the revision of its
    // latest change (#1250): importers that reload share one fresh instance, and a package that
    // did not change keeps its one shared instance (no re-run of top-level side effects).
    // Other package-name imports always keep one shared instance (framework identity).
    const revision = packageFileRevision(resolved.url);
    if (revision === undefined) return resolved;
    const url = new URL(resolved.url);
    url.searchParams.set('zhin-generation', revision);
    return { ...resolved, url: url.href };
  }
  if (!parentURL) return resolved;
  let revision: string | null;
  try {
    revision = new URL(parentURL).searchParams.get('zhin-generation');
  } catch {
    return resolved;
  }
  if (revision === null) return resolved;
  const url = new URL(resolved.url);
  url.searchParams.set('zhin-generation', revision);
  return { ...resolved, url: url.href };
}

function isLocalSpecifier(specifier: string): boolean {
  return specifier.startsWith('.')
    || specifier.startsWith('#')
    || specifier.startsWith('file:')
    || isAbsolute(specifier);
}

async function firstExistingTypeScript(
  specifier: string,
  parentURL: string | undefined,
): Promise<string | undefined> {
  const resolvedJs = resolveAgainstParent(specifier, parentURL);
  if (!resolvedJs) return undefined;

  const bases = [
    resolvedJs.replace(/\.jsx$/u, ''),
    resolvedJs.replace(/\.[cm]?js$/u, ''),
  ];
  let tsCandidate: string | undefined;
  let tsMtimeMs: number | undefined;
  for (const base of bases) {
    for (const ext of ['.ts', '.tsx', '.mts', '.cts'] as const) {
      const candidate = `${base}${ext}`;
      const mtime = await fileMtimeMs(candidate);
      if (mtime !== undefined) {
        tsCandidate = candidate;
        tsMtimeMs = mtime;
        break;
      }
    }
    if (tsCandidate !== undefined) break;
  }

  // Prefer compiled lib/ over strip-types (.ts) when lib/ is up to date:
  // many packages use syntax that Node strip-only mode rejects (parameter properties, enums, etc.).
  // When the TypeScript source is newer than the compiled lib/ file, prefer the fresh source
  // so development mode does not silently load stale build artifacts.
  const libCandidate = compiledLibPath(resolvedJs);
  if (libCandidate) {
    const libMtimeMs = await fileMtimeMs(libCandidate);
    if (libMtimeMs !== undefined) {
      if (
        !isCiEnvironment()
        && tsCandidate !== undefined
        && tsMtimeMs !== undefined
        && tsMtimeMs > libMtimeMs
        && await isStripTypesCompatible(tsCandidate)
      ) {
        return pathToFileURL(tsCandidate).href;
      }
      return pathToFileURL(libCandidate).href;
    }
  }

  return tsCandidate ? pathToFileURL(tsCandidate).href : undefined;
}

function isCiEnvironment(): boolean {
  const ci = process.env.CI;
  return Boolean(ci && ci !== 'false' && ci !== '0');
}

async function isStripTypesCompatible(tsPath: string): Promise<boolean> {
  if (tsPath.endsWith('.tsx') || tsPath.endsWith('.jsx')) return false;
  try {
    const source = await readFile(tsPath, 'utf8');
    if (/(?:^|[\s;{}])(?:export\s+)?(?:const\s+)?enum\s+[A-Za-z_$]/u.test(source)) return false;
    if (/(?:^|[\s;{}])(?:export\s+)?namespace\s+[A-Za-z_$]/u.test(source)) return false;
    if (/\bconstructor\s*\([^)]*\b(?:private|protected|public|readonly)\s+/u.test(source)) return false;
    return true;
  } catch {
    return false;
  }
}

function compiledLibPath(sourceJsPath: string): string | undefined {
  const marker = `${sep}src${sep}`;
  const index = sourceJsPath.lastIndexOf(marker);
  if (index < 0) return undefined;
  return `${sourceJsPath.slice(0, index)}${sep}lib${sep}${sourceJsPath.slice(index + marker.length)}`;
}

function resolveAgainstParent(specifier: string, parentURL: string | undefined): string | undefined {
  try {
    if (specifier.startsWith('file:')) return fileURLToPath(specifier);
    if (!parentURL) return undefined;
    return fileURLToPath(new URL(specifier, parentURL));
  } catch {
    return undefined;
  }
}

async function fileMtimeMs(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return undefined;
  }
}
