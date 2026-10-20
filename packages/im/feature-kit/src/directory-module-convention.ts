import { join, sep } from 'node:path';
import type {
  DirectoryEntry,
  DiscoveredSource,
  DiscoveryContext,
  SourceConvention,
} from './provider.js';

export interface DirectoryModuleCapture {
  readonly capture: string;
  readonly naming: 'kebab' | 'identifier';
}

export type DirectoryModuleSegment = string | DirectoryModuleCapture;

export interface DirectoryModuleLayout {
  readonly segments: readonly DirectoryModuleSegment[];
  readonly localName: (captures: Readonly<Record<string, string>>) => string;
}

export interface DirectoryModulesOptions {
  readonly id: string;
  readonly layouts: readonly DirectoryModuleLayout[];
  readonly extensions?: readonly ('ts' | 'tsx' | 'js' | 'mjs' | 'cjs')[];
}

/** Discovers `<name>/index.ts` modules from explicit, optionally captured layouts. */
export function directoryModules(options: DirectoryModulesOptions): SourceConvention {
  const convention: SourceConvention = {
    id: options.id,
    async *discover(context) {
      for (const layout of options.layouts) {
        yield* discoverLayout(context, layout, context.packageRoot, 0, {}, options.extensions);
      }
    },
    async load(source, context) {
      const module = await context.host.loadModule<{ default?: unknown }>(source.source);
      return module.default;
    },
  };
  return Object.freeze(convention);
}

export function capture(
  captureName: string,
  naming: DirectoryModuleCapture['naming'] = 'kebab',
): DirectoryModuleCapture {
  return Object.freeze({ capture: captureName, naming });
}

/** Reads a capture guaranteed by the matching layout and fails on an invalid custom layout. */
export function captured(
  captures: Readonly<Record<string, string>>,
  name: string,
): string {
  const value = captures[name];
  if (value === undefined) throw new TypeError(`Directory layout did not capture ${name}`);
  return value;
}

async function* discoverLayout(
  context: DiscoveryContext,
  layout: DirectoryModuleLayout,
  directory: string,
  offset: number,
  captures: Readonly<Record<string, string>>,
  extensions?: DirectoryModulesOptions['extensions'],
): AsyncIterable<DiscoveredSource> {
  if (offset === layout.segments.length) {
    const entries = await context.host.list(directory);
    const source = preferredIndex(
      entries,
      context.packageRoot.split(sep).includes('node_modules'),
      extensions,
    );
    if (!source) return;
    yield Object.freeze({
      localName: layout.localName(captures),
      source: join(directory, source),
      relatedSources: Object.freeze(entries
        .filter((entry) => entry.kind === 'file' && entry.name !== source)
        .map((entry) => join(directory, entry.name))),
      target: 'server' as const,
    });
    return;
  }
  const segment = layout.segments[offset]!;
  if (typeof segment === 'string') {
    yield* discoverLayout(context, layout, join(directory, segment), offset + 1, captures, extensions);
    return;
  }
  const entries = [...await context.host.list(directory)]
    .filter((entry) => entry.kind === 'directory' && isName(entry.name, segment.naming))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    yield* discoverLayout(context, layout, join(directory, entry.name), offset + 1, {
      ...captures,
      [segment.capture]: entry.name,
    }, extensions);
  }
}

function preferredIndex(
  entries: readonly DirectoryEntry[],
  preferJavaScript: boolean,
  accepted: DirectoryModulesOptions['extensions'] = ['ts', 'js', 'mjs', 'cjs'],
): string | undefined {
  const files = new Set(entries.filter((entry) => entry.kind === 'file').map((entry) => entry.name));
  const ranked = preferJavaScript
    ? ['js', 'mjs', 'cjs', 'ts', 'tsx']
    : ['ts', 'tsx', 'js', 'mjs', 'cjs'];
  const extensions = ranked.filter((extension) => accepted.includes(extension as never));
  return extensions.map((extension) => `index.${extension}`).find((name) => files.has(name));
}

function isName(value: string, naming: DirectoryModuleCapture['naming']): boolean {
  return naming === 'identifier'
    ? /^[a-z0-9][a-z0-9_-]*$/u.test(value)
    : /^[a-z0-9][a-z0-9-]*$/u.test(value);
}
