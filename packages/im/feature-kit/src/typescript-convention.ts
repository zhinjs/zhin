import { join, parse } from 'node:path';
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
    yield Object.freeze({
      localName: [...ancestors, parse(entry.name).name].join('/'),
      source: join(directory, entry.name),
      target: 'server' as const,
    });
  }
}

function isSegment(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/u.test(value);
}

function isModule(value: string, tsx: boolean): boolean {
  const extension = tsx ? 'tsx?' : 'ts';
  return new RegExp(`^[a-z0-9][a-z0-9-]*\\.${extension}$`, 'u').test(value);
}
