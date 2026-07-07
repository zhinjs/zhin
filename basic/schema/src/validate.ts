import type { Schema } from './schema.js';

export class SchemaValidationError extends Error {
  readonly issues: SchemaValidationIssue[];

  constructor(message: string, issues: SchemaValidationIssue[] = []) {
    super(message);
    this.name = 'SchemaValidationError';
    this.issues = issues;
  }

  static fromUnknown(err: unknown, path = 'value'): SchemaValidationError {
    if (err instanceof SchemaValidationError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new SchemaValidationError(message, [{ path, message }]);
  }
}

export interface SchemaValidationIssue {
  path: string;
  message: string;
}

export type SchemaSafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: SchemaValidationError };

function issue(path: string, message: string): SchemaValidationError {
  return new SchemaValidationError(message, [{ path, message }]);
}

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function validateOnly(schema: Schema, path: string, value: unknown): unknown {
  if (schema.meta.required && isEmptyValue(value)) {
    throw issue(path, `${path} is required`);
  }

  switch (schema.meta.type) {
    case 'string':
      if (value !== undefined && typeof value !== 'string') {
        throw issue(path, `${path} is not a string`);
      }
      return value;
    case 'number':
      if (value !== undefined && typeof value !== 'number') {
        throw issue(path, `${path} is not a number`);
      }
      return value;
    case 'boolean':
      if (value !== undefined && typeof value !== 'boolean') {
        throw issue(path, `${path} is not a boolean`);
      }
      return value;
    case 'const':
      if (value !== undefined && value !== schema.meta.default) {
        throw issue(path, `${path} const value not match`);
      }
      return value ?? schema.meta.default;
    case 'any':
      return value;
    case 'dict': {
      if (value === undefined) return value;
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw issue(path, `${path} is not an object`);
      }
      const inner = schema.options.inner!;
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        validateOnly(inner, `${path}.${k}`, v);
      }
      return value;
    }
    case 'object': {
      if (value === undefined) return value;
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw issue(path, `${path} is not an object`);
      }
      const shape = schema.options.object ?? {};
      const record = value as Record<string, unknown>;
      for (const [k, propSchema] of Object.entries(shape)) {
        const propValue = record[k];
        if (propValue === undefined) {
          if (propSchema.meta.required) {
            throw issue(`${path}.${k}`, `${path}.${k} is required`);
          }
          continue;
        }
        validateOnly(propSchema, `${path}.${k}`, propValue);
      }
      return value;
    }
    case 'list': {
      if (value === undefined) return value;
      if (!Array.isArray(value)) throw issue(path, `${path} is not a list`);
      const inner = schema.options.inner!;
      value.forEach((item, index) => {
        validateOnly(inner, `${path}[${index}]`, item);
      });
      return value;
    }
    case 'tuple': {
      if (value === undefined) return value;
      if (!Array.isArray(value)) throw issue(path, `${path} is not a tuple`);
      const list = schema.options.list ?? [];
      if (value.length !== list.length) {
        throw issue(path, `${path} tuple length mismatch`);
      }
      value.forEach((item, index) => {
        validateOnly(list[index]!, `${path}[${index}]`, item);
      });
      return value;
    }
    case 'union': {
      if (value === undefined) return value;
      const variants = schema.options.list ?? [];
      let lastError: SchemaValidationError | undefined;
      for (const variant of variants) {
        try {
          return validateOnly(variant, path, value);
        } catch (err) {
          lastError = SchemaValidationError.fromUnknown(err, path);
        }
      }
      throw lastError ?? issue(path, `${path} union type not match`);
    }
    case 'intersect': {
      if (value === undefined) return value;
      let current: unknown = value;
      for (const branch of schema.options.list ?? []) {
        current = validateOnly(branch, path, current);
      }
      return current;
    }
    case 'regexp':
    case 'date':
      return value;
    default:
      throw issue(path, `${path} has unsupported schema type ${schema.meta.type}`);
  }
}

export function safeParseSchema<T>(schema: Schema<T>, value: unknown): SchemaSafeParseResult<T> {
  try {
    const data = validateOnly(schema as Schema, 'value', value) as T;
    return { success: true, data };
  } catch (err) {
    return { success: false, error: SchemaValidationError.fromUnknown(err) };
  }
}
