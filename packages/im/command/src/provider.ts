import { basename, join, parse, sep } from 'node:path';
import { featureId } from '@zhin.js/plugin-runtime';
import {
  defineFeatureProvider,
  type DiscoveryContext,
  type DiscoveredSource,
  type SourceConvention,
} from '@zhin.js/feature-kit';
import { CommandIndex } from './command-index.js';
import {
  bindCommandParameter,
  parseCommandDefinition,
  type CommandDefinition,
  type CommandParameterDefinition,
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
    return bindCommandParameter(definition, resolveParameter(definition, file, source.source));
  },
};

async function* discoverCommandDirectory(
  context: DiscoveryContext,
  directory: string,
  ancestors: readonly string[],
): AsyncIterable<DiscoveredSource> {
  const entries = [...await context.host.list(directory)]
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const files = entries.flatMap((entry) => {
    if (entry.kind !== 'file') return [];
    const parsed = parseCommandFile(entry.name);
    return parsed ? [{ entry, parsed }] : [];
  });
  const preferJavaScript = context.packageRoot
    .split(sep)
    .includes('node_modules');
  const preferredFiles = new Map<string, string>();
  for (const { entry, parsed } of files) {
    const current = preferredFiles.get(parsed.localSegment);
    if (!current || commandFilePriority(entry.name, preferJavaScript)
      < commandFilePriority(current, preferJavaScript)) {
      preferredFiles.set(parsed.localSegment, entry.name);
    }
  }
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
    if (preferredFiles.get(file.localSegment) !== entry.name) continue;
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
  readonly parameter?: CommandParameterHint;
}

/** 文件名声明的参数形态；类型与默认值来自 `defineCommand({ params })`。 */
interface CommandParameterHint {
  readonly name: string;
  readonly optional: boolean;
  readonly rest: boolean;
}

const dynamicCommandFilePatterns: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly optional: boolean;
  readonly rest: boolean;
}> = [
  { pattern: /^\[\[\.\.\.([a-zA-Z][a-zA-Z0-9]*)\]\]\.(?:tsx?|[cm]?js)$/, optional: true, rest: true },
  { pattern: /^\[\.\.\.([a-zA-Z][a-zA-Z0-9]*)\]\.(?:tsx?|[cm]?js)$/, optional: false, rest: true },
  { pattern: /^\[\[([a-zA-Z][a-zA-Z0-9]*)\]\]\.(?:tsx?|[cm]?js)$/, optional: true, rest: false },
  { pattern: /^\[([a-zA-Z][a-zA-Z0-9]*)\]\.(?:tsx?|[cm]?js)$/, optional: false, rest: false },
];

function parseCommandFile(value: string): ParsedCommandFile | undefined {
  if (/^[a-z0-9][a-z0-9-]*\.(?:tsx?|[cm]?js)$/.test(value)) {
    return { localSegment: parse(value).name };
  }
  for (const { pattern, optional, rest } of dynamicCommandFilePatterns) {
    const match = pattern.exec(value);
    if (!match || !match[1]) continue;
    const name = match[1];
    // Metadata can change during HMR while $name keeps the Capability identity stable.
    return {
      localSegment: `$${name}`,
      parameter: { name, optional, rest },
    };
  }
  if (value.startsWith('[') || value.includes(']')) {
    throw new CommandPathSyntaxError(value);
  }
  return undefined;
}

/** 把文件名形态与 `definition.params` 合并成完整参数定义。 */
function resolveParameter(
  definition: CommandDefinition,
  file: ParsedCommandFile | undefined,
  source: string,
): CommandParameterDefinition | undefined {
  const hint = file?.parameter;
  if (!hint) return undefined;
  const schema = definition.params?.[hint.name];
  if (!schema) {
    throw new CommandPathSyntaxError(
      source,
      `missing params.${hint.name} declaration in defineCommand({ params })`,
    );
  }
  if (!hint.optional && schema.default !== undefined) {
    throw new CommandPathSyntaxError(
      source,
      `params.${hint.name} has a default but the file is required: rename to [[${hint.name}]]`,
    );
  }
  return {
    name: hint.name,
    type: schema.type,
    ...(schema.default !== undefined ? { defaultValue: schema.default } : {}),
    optional: hint.optional,
    rest: hint.rest,
    ...(schema.description !== undefined ? { description: schema.description } : {}),
  };
}

function commandFilePriority(value: string, preferJavaScript: boolean): number {
  const extension = value.slice(value.lastIndexOf('.') + 1);
  const order = preferJavaScript
    ? ['js', 'mjs', 'cjs', 'ts', 'tsx']
    : ['ts', 'tsx', 'js', 'mjs', 'cjs'];
  const priority = order.indexOf(extension);
  return priority < 0 ? Number.MAX_SAFE_INTEGER : priority;
}

export class CommandPathSyntaxError extends TypeError {
  constructor(
    file: string,
    detail = 'expected [name].ts(x), [[name]].ts(x), [...name].ts(x) or [[...name]].ts(x)',
  ) {
    super(`Invalid Command path ${file}: ${detail}`);
    this.name = 'CommandPathSyntaxError';
  }
}

const commandFeature = defineFeatureProvider({
  protocol: 1,
  id: commandFeatureId,
  authoring: {
    setupMethod: 'addCommand',
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
