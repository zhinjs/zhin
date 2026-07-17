import {
  defineCommand,
  type CommandContext,
  type CommandDefinition,
  type CommandParameterValue,
} from '@zhin.js/next-feature-command';

export interface LegacyCommandMatchResult {
  readonly params: Readonly<Record<string, CommandParameterValue>>;
  readonly args: readonly string[];
}

export type LegacyCommandAction<TMessage = unknown, TResult = unknown> = (
  message: TMessage,
  result: LegacyCommandMatchResult,
) => TResult | undefined | Promise<TResult | undefined>;

export interface LegacyCommandDefinition<TMessage = unknown, TResult = unknown> {
  readonly description?: string;
  readonly action: LegacyCommandAction<TMessage, TResult>;
}

/**
 * Preserves the legacy `(message, matchResult)` callback while moving
 * registration, identity and lifetime ownership to the Command Feature.
 */
export function defineLegacyCommand<
  TConfig = unknown,
  TMessage = unknown,
  TResult = unknown,
>(
  legacy: LegacyCommandDefinition<TMessage, TResult>,
): Readonly<CommandDefinition<TConfig, TResult | undefined, TMessage>> {
  if (typeof legacy.action !== 'function') {
    throw new TypeError('Legacy Command action must be a function');
  }
  const action = legacy.action;
  return defineCommand<TConfig, TResult | undefined, TMessage>({
    description: legacy.description,
    execute(context: CommandContext<TConfig, TMessage>) {
      return action(context.input, Object.freeze({
        params: context.params,
        args: context.args,
      }));
    },
  });
}
