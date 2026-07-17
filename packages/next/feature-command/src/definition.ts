import type {
  PluginNodeSnapshot,
  RuntimeSnapshot,
  Token,
} from '@zhin.js/next-kernel';

const commandBrand = 'zhin.command/1' as const;

export interface CommandContext<TConfig = unknown> {
  readonly owner: PluginNodeSnapshot;
  readonly generation: number;
  readonly config: Readonly<TConfig>;
  readonly args: readonly string[];
  use<T>(token: Token<T>): T;
}

export interface CommandDefinition<TConfig = unknown, TResult = unknown> {
  readonly $feature: typeof commandBrand;
  readonly description?: string;
  execute(context: CommandContext<TConfig>): TResult | Promise<TResult>;
}

export function defineCommand<TConfig = unknown, TResult = unknown>(
  definition: Omit<CommandDefinition<TConfig, TResult>, '$feature'>,
): Readonly<CommandDefinition<TConfig, TResult>> {
  if (typeof definition.execute !== 'function') {
    throw new TypeError('Command execute must be a function');
  }
  return Object.freeze({ $feature: commandBrand, ...definition });
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
  ownerId: PluginNodeSnapshot['id'],
  args: readonly string[],
): CommandContext {
  const owner = snapshot.tree.get(ownerId);
  const resources = snapshot.resources.get(ownerId);
  if (!owner || !resources) throw new Error(`Broken Command owner: ${ownerId}`);
  return Object.freeze({
    owner,
    generation: snapshot.generation,
    config: snapshot.config.get(ownerId) as Readonly<unknown>,
    args: Object.freeze([...args]),
    use<T>(token: Token<T>): T {
      if (!resources.has(token.id)) {
        throw new Error(`Missing resource ${token.id} for Command owner ${ownerId}`);
      }
      return resources.get(token.id) as T;
    },
  });
}
