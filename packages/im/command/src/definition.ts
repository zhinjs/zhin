import type { PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import {
  createCapabilityContext,
  type CapabilityContext,
} from '@zhin.js/feature-kit';

const commandBrand = 'zhin.command/1' as const;

export type CommandParameterType =
  | 'string'
  | 'number'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'word'
  | 'text'
  | 'mention'
  | 'image'
  | 'face'
  | 'reply'
  | 'forward'
  | 'dice'
  | 'rps';
export type CommandParameterValue =
  | string
  | number
  | boolean
  | Readonly<Record<string, unknown>>
  | null;

/** Minimal structural contract shared with canonical IM segments. */
export interface CommandSegment {
  readonly type: string | { readonly name: string };
  readonly data: Readonly<Record<string, unknown>>;
}

export interface CommandParameterDefinition {
  readonly name: string;
  readonly type: CommandParameterType;
  readonly defaultValue?: CommandParameterValue;
}

export interface CommandContext<TConfig = unknown, TInput = unknown>
  extends CapabilityContext<TConfig> {
  readonly args: readonly string[];
  readonly params: Readonly<Record<string, CommandParameterValue>>;
  /** Structured arguments left after the command pattern was consumed. */
  readonly segments: readonly Readonly<CommandSegment>[];
  readonly input: TInput;
}

export interface CommandDefinition<TConfig = unknown, TResult = unknown, TInput = unknown> {
  readonly $feature: typeof commandBrand;
  readonly $parameter?: CommandParameterDefinition;
  readonly description?: string;
  execute(context: CommandContext<TConfig, TInput>): TResult | Promise<TResult>;
}

declare module '@zhin.js/plugin-runtime' {
  interface PluginSetupContext<TConfig> {
    addCommand<TResult = unknown, TInput = unknown>(
      localName: string,
      definition: CommandDefinition<TConfig, TResult, TInput>,
    ): void;
  }
}

/**
 * 定义一个命令模块（`commands/` 约定目录下默认导出）。
 * @public 用户侧创作面，承诺 semver（见 docs/contributing/public-api-surface.md）。
 */
export function defineCommand<TConfig = unknown, TResult = unknown, TInput = unknown>(
  definition: Omit<CommandDefinition<TConfig, TResult, TInput>, '$feature' | '$parameter'>,
): Readonly<CommandDefinition<TConfig, TResult, TInput>> {
  if (typeof definition.execute !== 'function') {
    throw new TypeError('Command execute must be a function');
  }
  return Object.freeze({ $feature: commandBrand, ...definition });
}

export function bindCommandParameter<TConfig, TResult, TInput>(
  definition: CommandDefinition<TConfig, TResult, TInput>,
  parameter: CommandParameterDefinition | undefined,
): Readonly<CommandDefinition<TConfig, TResult, TInput>> {
  if (!parameter) return definition;
  return Object.freeze({ ...definition, $parameter: Object.freeze({ ...parameter }) });
}

export function parseCommandDefinition(value: unknown): CommandDefinition {
  if (!value || typeof value !== 'object') {
    throw new TypeError('Command module must default-export defineCommand(...)');
  }
  const definition = value as Partial<CommandDefinition>;
  if (definition.$feature !== commandBrand || typeof definition.execute !== 'function') {
    throw new TypeError('Command module must default-export defineCommand(...)');
  }
  return definition as CommandDefinition;
}

export function createCommandContext(
  snapshot: RuntimeSnapshot,
  ownerId: PluginId,
  args: readonly string[],
  params: Readonly<Record<string, CommandParameterValue>> = Object.freeze({}),
  input: unknown = undefined,
  segments: readonly Readonly<CommandSegment>[] = Object.freeze([]),
): CommandContext {
  const context = createCapabilityContext(snapshot, ownerId);
  return Object.freeze({
    ...context,
    args: Object.freeze([...args]),
    params: Object.freeze({ ...params }),
    segments: freezeSegments(segments),
    input,
  });
}

function freezeSegments(
  segments: readonly Readonly<CommandSegment>[],
): readonly Readonly<CommandSegment>[] {
  return Object.freeze(segments.map((segment) => Object.freeze({
    type: typeof segment.type === 'string'
      ? segment.type
      : Object.freeze({ name: segment.type.name }),
    data: Object.freeze({ ...segment.data }),
  })));
}
