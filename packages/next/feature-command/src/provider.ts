import { basename, join, parse } from 'node:path';
import { featureId } from '@zhin.js/next-kernel';
import {
  defineFeatureProvider,
  type DiscoveryContext,
  type DiscoveredSource,
  type SourceConvention,
} from '@zhin.js/next-feature-kit';
import { CommandIndex } from './command-index.js';
import {
  bindCommandParameter,
  parseCommandDefinition,
  type CommandParameterDefinition,
  type CommandParameterType,
  type CommandParameterValue,
} from './definition.js';

export const commandFeatureId = featureId('zhin.command');

const commandFiles: SourceConvention = {
  id: 'commands-ts',
  async *discover(context) {
    const directory = join(context.packageRoot, 'commands');
    yield* discoverCommandDirectory(context, directory, []);
  },
  async load(source, context) {
    const module = await context.host.loadModule<{ default?: unknown }>(source.source);
    const definition = parseCommandDefinition(module.default);
    const file = parseCommandFile(basename(source.source));
    return bindCommandParameter(definition, file?.parameter);
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
    if (entry.kind !== 'file') continue;
    const file = parseCommandFile(entry.name);
    if (!file) continue;
    yield {
      localName: [...ancestors, file.localSegment].join('/'),
      source: join(directory, entry.name),
      target: 'server',
    };
  }
}

function isCommandSegment(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(value);
}

interface ParsedCommandFile {
  readonly localSegment: string;
  readonly parameter?: CommandParameterDefinition;
}

const dynamicCommandFilePattern =
  /^\[([a-z][a-zA-Z0-9]*):(string|number|boolean)(?:=([^\]]*))?\]\.tsx?$/;

function parseCommandFile(value: string): ParsedCommandFile | undefined {
  if (/^[a-z0-9][a-z0-9-]*\.tsx?$/.test(value)) {
    return { localSegment: parse(value).name };
  }
  const match = dynamicCommandFilePattern.exec(value);
  if (match) {
    const [, name, type, rawDefault] = match as RegExpExecArray & {
      readonly 1: string;
      readonly 2: CommandParameterType;
    };
    // Metadata can change during HMR while $name keeps the Capability identity stable.
    const parameter = rawDefault === undefined
      ? { name, type }
      : { name, type, defaultValue: parseParameterValue(name, type, rawDefault, value) };
    return { localSegment: `$${name}`, parameter };
  }
  if (value.startsWith('[') || value.includes(']')) {
    throw new CommandPathSyntaxError(value);
  }
  return undefined;
}

function parseParameterValue(
  name: string,
  type: CommandParameterType,
  value: string,
  source: string,
): CommandParameterValue {
  if (type === 'string') return value;
  if (type === 'number') {
    const number = Number(value);
    if (value.trim().length > 0 && Number.isFinite(number)) return number;
  } else if (value === 'true' || value === 'false') {
    return value === 'true';
  }
  throw new CommandPathSyntaxError(
    source,
    `default for ${name}:${type} is invalid`,
  );
}

export class CommandPathSyntaxError extends TypeError {
  constructor(file: string, detail = 'expected [name:string|number|boolean=default].ts(x)') {
    super(`Invalid Command path ${file}: ${detail}`);
    this.name = 'CommandPathSyntaxError';
  }
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
