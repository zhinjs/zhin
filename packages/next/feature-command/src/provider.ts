import { join, parse } from 'node:path';
import { featureId } from '@zhin.js/next-kernel';
import {
  defineFeatureProvider,
  type SourceConvention,
} from '@zhin.js/next-feature-kit';
import { CommandIndex } from './command-index.js';
import { parseCommandDefinition } from './definition.js';

export const commandFeatureId = featureId('zhin.command');

const commandFiles: SourceConvention = {
  id: 'commands-ts',
  async *discover(context) {
    const directory = join(context.packageRoot, 'commands');
    const entries = await context.host.list(directory);
    for (const entry of entries) {
      if (entry.kind !== 'file' || !/^[a-z0-9][a-z0-9-]*\.tsx?$/.test(entry.name)) {
        continue;
      }
      yield {
        localName: parse(entry.name).name,
        source: join(directory, entry.name),
        target: 'server',
      };
    }
  },
  async load(source, context) {
    const module = await context.host.loadModule<{ default?: unknown }>(source.source);
    return module.default;
  },
};

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
