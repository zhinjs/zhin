import { join, parse, sep } from 'node:path';
import type {
  DiscoveryContext,
  DiscoveredSource,
  SourceConvention,
} from './provider.js';

export interface TypeScriptConventionOptions {
  readonly id: string;
  readonly directory: string;
  readonly tsx?: boolean;
  readonly recursive?: boolean;
}

/** Discovers stable, nested local names without assigning Feature semantics. */
export function typeScriptModules(
  options: TypeScriptConventionOptions,
): SourceConvention {
  const convention: SourceConvention = {
    id: options.id,
    async *discover(context) {
      const directory = join(context.packageRoot, options.directory);
      yield* discoverDirectory(
        context,
        directory,
        [],
        Boolean(options.tsx),
        options.recursive !== false,
      );
    },
    async load(source, context) {
      const module = await context.host.loadModule<{ default?: unknown }>(source.source);
      return module.default;
    },
  };
  return Object.freeze(convention);
}

async function* discoverDirectory(
  context: DiscoveryContext,
  directory: string,
  ancestors: readonly string[],
  tsx: boolean,
  recursive: boolean,
): AsyncIterable<DiscoveredSource> {
  const entries = [...await context.host.list(directory)]
    .sort((left, right) => left.name.localeCompare(right.name));
  const discoveredNames = new Set<string>();
  const preferJavaScript = context.packageRoot
    .split(sep)
    .includes('node_modules');
  for (const entry of entries) {
    if (entry.kind === 'directory' && recursive && isSegment(entry.name)) {
      yield* discoverDirectory(
        context,
        join(directory, entry.name),
        [...ancestors, entry.name],
        tsx,
        recursive,
      );
      continue;
    }
    if (entry.kind !== 'file' || !isModule(entry.name, tsx)) continue;
    const localName = parse(entry.name).name;
    if (discoveredNames.has(localName)) continue;
    const preferred = preferredSibling(
      entries,
      localName,
      tsx,
      preferJavaScript,
    );
    if (preferred !== entry.name) continue;
    discoveredNames.add(localName);
    yield Object.freeze({
      localName: [...ancestors, localName].join('/'),
      source: join(directory, entry.name),
      target: 'server' as const,
    });
  }
}

function isSegment(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/u.test(value);
}

function isModule(value: string, tsx: boolean): boolean {
  const extension = tsx ? '(?:tsx?|[cm]?js)' : '(?:ts|[cm]?js)';
  return new RegExp(`^[a-z0-9][a-z0-9-]*\\.${extension}$`, 'u').test(value);
}

function preferredSibling(
  entries: readonly { readonly name: string; readonly kind: string }[],
  localName: string,
  tsx: boolean,
  preferJavaScript: boolean,
): string | undefined {
  const extensions = preferJavaScript
    ? ['js', 'mjs', 'cjs', 'ts', ...(tsx ? ['tsx'] : [])]
    : ['ts', ...(tsx ? ['tsx'] : []), 'js', 'mjs', 'cjs'];
  const names = new Set(
    entries
      .filter((entry) => entry.kind === 'file')
      .map((entry) => entry.name),
  );
  return extensions
    .map((extension) => `${localName}.${extension}`)
    .find((name) => names.has(name));
}
