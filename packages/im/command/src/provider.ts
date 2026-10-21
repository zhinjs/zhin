import { basename, dirname, join, relative, sep } from 'node:path';
import { featureId, isCapabilityLocalSegment } from '@zhin.js/plugin-runtime';
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
    const entries = [...await context.host.list(directory)]
      .filter((entry) => entry.kind === 'directory')
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const segment = parseCommandDirectory(entry.name);
      if (!segment) continue;
      yield* discoverCommandDirectory(context, join(directory, entry.name), [segment]);
    }
  },
  async load(source, context) {
    const module = await context.host.loadModule<{ default?: unknown }>(source.source);
    const definition = parseCommandDefinition(module.default);
    const commandDirectories = commandDirectoriesOf(context.packageRoot, source.source);
    assertSingleTrailingParameterDirectory(commandDirectories, source.source);
    const file = parseCommandDirectory(basename(dirname(source.source)));
    return bindCommandParameter(definition, resolveParameter(definition, file, source.source));
  },
};

async function* discoverCommandDirectory(
  context: DiscoveryContext,
  directory: string,
  ancestors: readonly ParsedCommandFile[],
): AsyncIterable<DiscoveredSource> {
  const entries = [...await context.host.list(directory)]
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const preferJavaScript = context.packageRoot
    .split(sep)
    .includes('node_modules');
  const index = preferredCommandIndex(entries, preferJavaScript);
  if (index) {
    yield {
      localName: ancestors.map((segment) => segment.localSegment).join('/'),
      source: join(directory, index),
      relatedSources: Object.freeze(entries
        .filter((entry) => entry.kind === 'file' && entry.name !== index)
        .map((entry) => join(directory, entry.name))),
      target: 'server',
    };
  }
  for (const entry of entries) {
    if (entry.kind !== 'directory') continue;
    const segment = parseCommandDirectory(entry.name);
    if (!segment) continue;
    yield* discoverCommandDirectory(context, join(directory, entry.name), [...ancestors, segment]);
  }
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

function parseCommandDirectory(value: string): ParsedCommandFile | undefined {
  for (const { pattern, optional, rest } of dynamicCommandFilePatterns) {
    const match = pattern.exec(`${value}.ts`);
    if (!match || !match[1]) continue;
    const name = match[1];
    // Metadata can change during HMR while $name keeps the Capability identity stable.
    return {
      localSegment: `$${name}`,
      parameter: { name, optional, rest },
    };
  }
  if (isCapabilityLocalSegment(value)) {
    return { localSegment: value };
  }
  if (value.startsWith('[') || value.includes(']')) {
    throw new CommandPathSyntaxError(value);
  }
  return undefined;
}

/** Directory segments between `commands/` and the command's `index.*` file. */
function commandDirectoriesOf(packageRoot: string, source: string): string[] {
  const commandsRoot = join(packageRoot, 'commands');
  const commandDirectory = dirname(source);
  return relative(commandsRoot, commandDirectory)
    .split(sep)
    .filter((segment) => segment !== '');
}

interface ParameterDirectory {
  readonly position: number;
  readonly directory: string;
  readonly hint: CommandParameterHint;
}

/**
 * A command path may contain at most one parameter directory, and it must be the
 * last directory before `index.*`. Further arguments belong in `defineCommand({ params })`.
 */
function assertSingleTrailingParameterDirectory(directories: readonly string[], source: string): void {
  const parameterDirectories: ParameterDirectory[] = [];
  directories.forEach((directory, position) => {
    const hint = parseCommandDirectory(directory)?.parameter;
    if (hint) parameterDirectories.push({ position, directory, hint });
  });
  const [keptDirectory, ...movedDirectories] = parameterDirectories;
  if (!keptDirectory) return;
  const lastPosition = directories.length - 1;
  if (movedDirectories.length === 0 && keptDirectory.position === lastPosition) return;
  throw new CommandPathSyntaxError(
    source,
    describeParameterDirectoryRule(directories, keptDirectory, movedDirectories),
  );
}

function describeParameterDirectoryRule(
  directories: readonly string[],
  keptDirectory: ParameterDirectory,
  movedDirectories: readonly ParameterDirectory[],
): string {
  const parameterDirectories = [keptDirectory, ...movedDirectories];
  const currentPath = `commands/${directories.join('/')}/index.ts`;
  const foundDirectories = parameterDirectories.map((entry) => entry.directory).join(', ');
  const staticDirectories = directories.filter((_directory, position) =>
    !parameterDirectories.some((entry) => entry.position === position));
  const suggestedPath = `commands/${[...staticDirectories, keptDirectory.directory].join('/')}/index.ts`;
  const suggestedParams = parameterDirectories
    .map((entry) => describeParamDeclaration(entry.hint))
    .join(', ');
  const movedNote = movedDirectories.length > 0
    ? `move ${movedDirectories.map((entry) => entry.directory).join(', ')} into defineCommand({ params })`
    : 'move the parameter directory to the end of the path';
  return `only the last directory of a command path may be a parameter directory `
    + `([name], [[name]], [...name] or [[...name]]), and a command may have at most one; `
    + `found ${foundDirectories} in ${currentPath}. `
    + `Fix: ${movedNote}, e.g. ${suggestedPath} with `
    + `defineCommand({ params: { ${suggestedParams} } }) `
    + `(the directory parameter must be listed first). `
    + 'See https://zhin.js.org/authoring/commands#目录参数规则';
}

function describeParamDeclaration(hint: CommandParameterHint): string {
  const type = hint.rest ? 'text' : 'string';
  const flags: string[] = [];
  if (hint.optional) flags.push('optional: true');
  if (hint.rest) flags.push('rest: true');
  const flagText = flags.map((flag) => `, ${flag}`).join('');
  return `${hint.name}: { type: '${type}'${flagText} }`;
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
  const declaredNames = Object.keys(definition.params ?? {});
  if (declaredNames[0] !== hint.name) {
    const reorderedNames = [hint.name, ...declaredNames.filter((name) => name !== hint.name)];
    throw new CommandPathSyntaxError(
      source,
      `params.${hint.name} must be the first parameter declaration: the parameter directory `
        + `binds the first argument after the command name, so it has to come first in `
        + `defineCommand({ params }). Current order: { ${declaredNames.join(', ')} }; `
        + `reorder to { ${reorderedNames.join(', ')} }`,
    );
  }
  if (schema.rest !== undefined && schema.rest !== hint.rest
    || schema.optional !== undefined && schema.optional !== hint.optional) {
    throw new CommandPathSyntaxError(source, `params.${hint.name} optional/rest declaration conflicts with the directory shape`);
  }
  if (!hint.optional && schema.default !== undefined) {
    throw new CommandPathSyntaxError(
      source,
      `params.${hint.name} has a default but the directory is required: rename it to [[${hint.name}]]`,
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

function preferredCommandIndex(
  entries: readonly { readonly name: string; readonly kind: 'file' | 'directory' }[],
  preferJavaScript: boolean,
): string | undefined {
  return entries
    .filter((entry) => entry.kind === 'file' && /^index\.(?:tsx?|[cm]?js)$/u.test(entry.name))
    .sort((left, right) => commandFilePriority(left.name, preferJavaScript)
      - commandFilePriority(right.name, preferJavaScript))[0]?.name;
}

export class CommandPathSyntaxError extends TypeError {
  constructor(
    file: string,
    detail = 'expected commands/foo/index.ts or commands/foo/[name]/index.ts',
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
      const rootConfig = context.snapshot.config.get(context.snapshot.root) as
        | Record<string, unknown> | undefined;
      const rawKeyword = rootConfig?.menuKeyword;
      const menu = rawKeyword === false || rawKeyword === ''
        ? undefined
        : { keyword: typeof rawKeyword === 'string' ? rawKeyword : '菜单' };
      return { value: new CommandIndex(slots, context.snapshot, menu) };
    },
  },
});

export default commandFeature;
