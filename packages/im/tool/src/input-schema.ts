/** JSON Schema subset accepted by the Agent Tool projection boundary. */
export interface ToolInputJsonSchema {
  readonly type: string;
  readonly properties?: Readonly<Record<string, ToolInputJsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: ToolInputJsonSchema;
  readonly enum?: readonly unknown[];
  readonly description?: string;
  readonly default?: unknown;
  readonly [keyword: string]: unknown;
}

export interface ToolInputJsonObjectSchema extends ToolInputJsonSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, ToolInputJsonSchema>>;
}

export interface ToolInputIssue {
  readonly path?: readonly PropertyKey[] | string;
  readonly message?: string;
}

export type ExecutableToolInputParseResult<T> =
  | Readonly<{ success: true; data: T }>
  | Readonly<{
      success: false;
      error: Readonly<{ issues: readonly ToolInputIssue[] }>;
    }>;

/**
 * Runtime schema port implemented by `@zhin.js/schema` (`Schema.object(...)`).
 * Infers `T` from the schema's `output` type witness so defaulted fields are
 * non-optional on `execute(args)`.
 */
export interface ZhinToolInputSchema<T = unknown> {
  (value?: never, key?: string): unknown;
  readonly output?: T;
  safeParse(input: unknown): ExecutableToolInputParseResult<unknown>;
  toJsonSchema(): unknown;
  toJSONSchema?(options?: Readonly<{ io?: 'input' }>): unknown;
}

/**
 * Runtime schema port implemented by Zod 4 object schemas or `@zhin.js/schema`.
 *
 * Requiring both public operations keeps validation and model-facing JSON
 * Schema projection on one contract without coupling this package to Zod.
 */
export type ExecutableToolInputSchema<T = unknown> =
  | ZhinToolInputSchema<T>
  | {
      readonly output?: never;
      safeParse(input: unknown): ExecutableToolInputParseResult<T>;
      toJSONSchema?(options?: Readonly<{ io?: 'input' }>): unknown;
      toJsonSchema?(): unknown;
    };

export type ToolInputSchema<T = unknown> =
  | ToolInputJsonObjectSchema
  | ExecutableToolInputSchema<T>;

export type ToolInputParseResult<T> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{ ok: false; error: string }>;

export function isToolInputSchema(value: unknown): value is ToolInputSchema {
  if (isJsonObjectSchema(value)) return true;
  if (!isExecutableToolInputSchema(value)) return false;
  try {
    return isJsonObjectSchema(projectExecutableSchema(value));
  } catch {
    return false;
  }
}

export function requireToolInputSchema<T = unknown>(
  value: unknown,
  subject = 'Agent Tool inputSchema',
): ToolInputSchema<T> {
  if (!isToolInputSchema(value)) {
    throw new TypeError(`${subject} must be an object JSON Schema or executable schema`);
  }
  return value as ToolInputSchema<T>;
}

export function toolInputSchemaToParameters(
  schema?: ToolInputSchema,
): ToolInputJsonObjectSchema {
  if (schema === undefined) return emptyObjectSchema();
  if (isExecutableToolInputSchema(schema)) {
    return normalizeJsonObjectSchema(projectExecutableSchema(schema));
  }
  return normalizeJsonObjectSchema(schema);
}

export function parseToolInputSchema<T>(
  schema: ToolInputSchema<T> | undefined,
  input: unknown,
): ToolInputParseResult<T> {
  if (!isExecutableToolInputSchema<T>(schema)) {
    return { ok: true, data: input as T };
  }
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    if (typeof schema === 'function') {
      const evaluated = (schema as (value: unknown) => unknown)(parsed.data);
      return { ok: true, data: toPlainData(evaluated) as T };
    }
    return { ok: true, data: parsed.data as T };
  }

  const error = parsed.error.issues
    .map((issue) => {
      const path = Array.isArray(issue.path)
        ? issue.path.map(String).join('.')
        : (typeof issue.path === 'string' ? issue.path : '');
      return `${path || 'root'}: ${issue.message ?? 'invalid'}`;
    })
    .join('; ');
  return { ok: false, error: error || 'Invalid arguments' };
}

function projectExecutableSchema(schema: ExecutableToolInputSchema): unknown {
  if (typeof schema.toJSONSchema === 'function') {
    return schema.toJSONSchema({ io: 'input' });
  }
  if (typeof schema.toJsonSchema === 'function') {
    return schema.toJsonSchema();
  }
  return undefined;
}

function toPlainData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toPlainData);
  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto === null || proto === Object.prototype) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = toPlainData(v);
      }
      return out;
    }
  }
  return value;
}

function isExecutableToolInputSchema<T = unknown>(
  value: unknown,
): value is ExecutableToolInputSchema<T> {
  if (!isObjectOrFunction(value)) return false;
  return typeof value.safeParse === 'function'
    && (typeof value.toJSONSchema === 'function' || typeof value.toJsonSchema === 'function');
}

function isJsonObjectSchema(value: unknown): value is ToolInputJsonObjectSchema {
  if (!isRecord(value) || value.type !== 'object') return false;
  if (value.properties !== undefined && !isRecord(value.properties)) return false;
  return value.required === undefined
    || (Array.isArray(value.required) && value.required.every((key) => typeof key === 'string'));
}

function normalizeJsonObjectSchema(value: unknown): ToolInputJsonObjectSchema {
  if (!isJsonObjectSchema(value)) {
    throw new TypeError('Agent Tool inputSchema must produce an object JSON Schema');
  }
  return Object.freeze({
    ...value,
    type: 'object',
    properties: Object.freeze({ ...(value.properties ?? {}) }),
    ...(value.required
      ? { required: Object.freeze([...value.required]) }
      : {}),
  });
}

function emptyObjectSchema(): ToolInputJsonObjectSchema {
  return Object.freeze({ type: 'object', properties: Object.freeze({}) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isObjectOrFunction(value: unknown): value is Record<string, unknown> {
  return value !== null && (typeof value === 'object' || typeof value === 'function') && !Array.isArray(value);
}
