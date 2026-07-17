import { join, parse } from 'node:path';
import { featureId } from '@zhin.js/next-kernel';
import {
  defineFeatureProvider,
  type DiscoveryContext,
  type DiscoveredSource,
  type SourceConvention,
} from '@zhin.js/next-feature-kit';
import { CommandIndex } from './command-index.js';
import { parseCommandDefinition } from './definition.js';

export const commandFeatureId = featureId('zhin.command');

const commandFiles: SourceConvention = {
  id: 'commands-ts',
  async *discover(context) {
    const directory = join(context.packageRoot, 'commands');
    yield* discoverCommandDirectory(context, directory, []);
  },
  async load(source, context) {
    const module = await context.host.loadModule<{ default?: unknown }>(source.source);
    return module.default;
  },
};

async function* discoverCommandDirectory(
  context: DiscoveryContext,
  directory: string,
  ancestors: readonly string[],
): AsyncIterable<DiscoveredSource> {
  const entries = [...await context.host.list(directory)]
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (const entry of entries) {
    if (entry.kind === 'directory' && isCommandSegment(entry.name)) {
      yield* discoverCommandDirectory(
        context,
        join(directory, entry.name),
        [...ancestors, entry.name],
      );
      continue;
    }
    if (entry.kind !== 'file' || !isCommandFile(entry.name)) continue;
    yield {
      localName: [...ancestors, parse(entry.name).name].join('/'),
      source: join(directory, entry.name),
      target: 'server',
    };
  }
}

function isCommandSegment(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(value);
}

function isCommandFile(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.tsx?$/.test(value);
}

const commandFeature = defineFeatureProvider({
  protocol: 1,
  id: commandFeatureId,
  authoring: {
    conventions: [commandFiles],
    validate: parseCommandDefinition,
  },
  runtime: {
    project(slots, context) {
      return { value: new CommandIndex(slots, context.snapshot) };
    },
  },
});

export default commandFeature;
