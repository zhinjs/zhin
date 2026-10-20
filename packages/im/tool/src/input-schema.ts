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
  readonly path?: readonly PropertyKey[];
  readonly message?: string;
}

export type ExecutableToolInputParseResult<T> =
  | Readonly<{ success: true; data: T }>
  | Readonly<{
      success: false;
      error: Readonly<{ issues: readonly ToolInputIssue[] }>;
    }>;

/**
 * Runtime schema port implemented by Zod 4 object schemas.
 *
 * Requiring both public operations keeps validation and model-facing JSON
 * Schema projection on one contract without coupling this package to Zod.
 */
export interface ExecutableToolInputSchema<T = unknown> {
  safeParse(input: unknown): ExecutableToolInputParseResult<T>;
  toJSONSchema(options?: Readonly<{ io?: 'input' }>): unknown;
}

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
    return isJsonObjectSchema(value.toJSONSchema({ io: 'input' }));
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
    return normalizeJsonObjectSchema(schema.toJSONSchema({ io: 'input' }));
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
  if (parsed.success) return { ok: true, data: parsed.data };

  const error = parsed.error.issues
    .map((issue) => `${issue.path?.map(String).join('.') || 'root'}: ${issue.message ?? 'invalid'}`)
    .join('; ');
  return { ok: false, error: error || 'Invalid arguments' };
}

function isExecutableToolInputSchema<T = unknown>(
  value: unknown,
): value is ExecutableToolInputSchema<T> {
  if (!isRecord(value)) return false;
  return typeof value.safeParse === 'function' && typeof value.toJSONSchema === 'function';
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
