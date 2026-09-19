import { AUTHORING_KIND, type AuthoringConnectionDefinition, type ConnectionTransport } from './types.js';

export type DefineConnectionInput = Omit<AuthoringConnectionDefinition, typeof AUTHORING_KIND>;

export function defineConnection(input: DefineConnectionInput): AuthoringConnectionDefinition {
  const schema = input.configSchema as unknown as {
    safeParse?: unknown;
    toJSONSchema?: (options?: Readonly<{ io?: 'input' }>) => unknown;
  };
  let projection: unknown;
  try {
    projection = schema.toJSONSchema?.({ io: 'input' });
  } catch {
    projection = undefined;
  }
  if (typeof schema.safeParse !== 'function'
    || typeof schema.toJSONSchema !== 'function'
    || !projection
    || typeof projection !== 'object'
    || (projection as { type?: unknown }).type !== 'object') {
    throw new TypeError('Connection configSchema must be a Zod 4 object schema');
  }
  return Object.freeze({
    [AUTHORING_KIND]: 'connection' as const,
    ...input,
  });
}

export type { ConnectionTransport };
