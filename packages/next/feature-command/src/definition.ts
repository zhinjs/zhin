import type { PluginId, RuntimeSnapshot } from '@zhin.js/next-kernel';
import {
  createCapabilityContext,
  type CapabilityContext,
} from '@zhin.js/next-feature-kit';

const commandBrand = 'zhin.command/1' as const;

export type CommandParameterType = 'string' | 'number' | 'boolean';
export type CommandParameterValue = string | number | boolean;

export interface CommandParameterDefinition {
  readonly name: string;
  readonly type: CommandParameterType;
  readonly defaultValue?: CommandParameterValue;
}

export interface CommandContext<TConfig = unknown> extends CapabilityContext<TConfig> {
  readonly args: readonly string[];
  readonly params: Readonly<Record<string, CommandParameterValue>>;
}

export interface CommandDefinition<TConfig = unknown, TResult = unknown> {
  readonly $feature: typeof commandBrand;
  readonly $parameter?: CommandParameterDefinition;
  readonly description?: string;
  execute(context: CommandContext<TConfig>): TResult | Promise<TResult>;
}

export function defineCommand<TConfig = unknown, TResult = unknown>(
  definition: Omit<CommandDefinition<TConfig, TResult>, '$feature' | '$parameter'>,
): Readonly<CommandDefinition<TConfig, TResult>> {
  if (typeof definition.execute !== 'function') {
    throw new TypeError('Command execute must be a function');
  }
  return Object.freeze({ $feature: commandBrand, ...definition });
}

export function bindCommandParameter<TConfig, TResult>(
  definition: CommandDefinition<TConfig, TResult>,
  parameter: CommandParameterDefinition | undefined,
): Readonly<CommandDefinition<TConfig, TResult>> {
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
): CommandContext {
  const context = createCapabilityContext(snapshot, ownerId);
  return Object.freeze({
    ...context,
    args: Object.freeze([...args]),
    params: Object.freeze({ ...params }),
  });
}
