import type { Schema } from './schema.js';

/** Optional display metadata; translated labels never change stored values. */
export type ConfigFieldI18n = Readonly<Partial<Record<'zh-CN' | 'en', Readonly<{
  title?: string;
  description?: string;
  enumLabels?: Readonly<Record<string, string>>;
}>>>>;

/** Form annotations on the same JSON Schema used for configuration validation. */
export interface ConfigFieldMetadata {
  readonly secret?: boolean;
  readonly hidden?: boolean;
  readonly component?: string;
  readonly options?: readonly Schema.Option[];
  readonly effect?: 'reload';
}

export type ConfigJsonSchema = Readonly<Record<string, unknown>>;

/** Export serializable configuration declarations; non-JSON business types are explicit errors. */
export function toJsonSchema(schema: Schema): ConfigJsonSchema {
  const { meta, options } = schema;
  const result: Record<string, unknown> = {};
  switch (meta.type) {
    case 'string': case 'number': case 'boolean':
      result.type = meta.type;
      break;
    case 'object': {
      result.type = 'object';
      result.additionalProperties = false;
      const shape = options.object ?? {};
      result.properties = Object.fromEntries(Object.entries(shape).map(([key, field]) => [key, toJsonSchema(field)]));
      const required = Object.entries(shape).filter(([, field]) => field.meta.required).map(([key]) => key);
      if (required.length) result.required = required;
      break;
    }
    case 'dict':
      result.type = 'object';
      result.additionalProperties = toJsonSchema(options.inner!);
      break;
    case 'list':
      result.type = 'array';
      result.items = toJsonSchema(options.inner!);
      break;
    case 'tuple':
      result.type = 'array';
      result.prefixItems = (options.list ?? []).map(toJsonSchema);
      result.items = false;
      result.minItems = result.maxItems = options.list?.length ?? 0;
      break;
    case 'union':
      for (const branch of options.list ?? []) assertUnionBranchDefaults(branch, true);
      result.anyOf = (options.list ?? []).map(toJsonSchema);
      break;
    case 'intersect': {
      const branches = (options.list ?? []).map(toJsonSchema);
      if (branches.every(branch => branch.type === 'object')) {
        result.type = 'object';
        // Close the combined shape, rather than making each object reject
        // properties contributed by the other intersection branches.
        result.unevaluatedProperties = false;
        result.allOf = branches.map(branch => {
          // The outer intersection owns closure, including nested intersections.
          const { additionalProperties, unevaluatedProperties, ...rest } = branch;
          const openBranch: Record<string, unknown> = { ...rest };
          if (additionalProperties !== false && additionalProperties !== undefined) {
            openBranch.additionalProperties = additionalProperties;
          }
          if (unevaluatedProperties !== false && unevaluatedProperties !== undefined) {
            openBranch.unevaluatedProperties = unevaluatedProperties;
          }
          return openBranch;
        });
      } else result.allOf = branches;
      break;
    }
    case 'const': result.const = meta.default; break;
    case 'any': break;
    default: throw new TypeError(`Schema type ${meta.type} cannot describe JSON configuration`);
  }
  if (meta.description !== undefined) result.description = meta.description;
  if (meta.i18n !== undefined) result['x-i18n'] = structuredClone(meta.i18n);
  if (meta.default !== undefined) {
    assertJsonValue(meta.default);
    assertPublicDefault(schema, meta.default);
    result.default = structuredClone(meta.default);
  }
  const minKey = meta.type === 'number' ? 'minimum' : meta.type === 'string' ? 'minLength' : meta.type === 'list' ? 'minItems' : undefined;
  const maxKey = meta.type === 'number' ? 'maximum' : meta.type === 'string' ? 'maxLength' : meta.type === 'list' ? 'maxItems' : undefined;
  if (meta.min !== undefined && minKey) result[minKey] = meta.min;
  if (meta.max !== undefined && maxKey) result[maxKey] = meta.max;
  if (meta.step !== undefined && meta.type === 'number') {
    if (!Number.isFinite(meta.step) || meta.step <= 0) throw new TypeError('Configuration step must be a positive finite number');
    result.multipleOf = meta.step;
  }
  if (meta.options?.length) {
    for (const option of meta.options) assertJsonValue(option.value);
    result.enum = structuredClone(meta.options.map(option => option.value));
  }
  if (meta.secret) result.writeOnly = true;
  const annotations: ConfigFieldMetadata = {
    ...(meta.secret ? { secret: true } : {}),
    ...(meta.hidden ? { hidden: true } : {}),
    ...(meta.component !== undefined ? { component: meta.component } : {}),
    ...(meta.options !== undefined ? { options: structuredClone(meta.options) } : {}),
    ...(meta.effect !== undefined ? { effect: meta.effect } : {}),
  };
  if (Object.keys(annotations).length) result['x-zhin-config'] = annotations;
  return result;
}

/** Ajv cannot apply defaults inside anyOf alternatives without choosing a branch. */
function assertUnionBranchDefaults(schema: Schema, branchRoot = false): void {
  // A literal alternative carries its value as an intrinsic const annotation;
  // it never fills a nested property and must remain usable in literal unions.
  if (schema.meta.default !== undefined && !(branchRoot && schema.meta.type === 'const')) {
    throw new TypeError('Defaults inside union alternatives cannot be applied by Runtime; place the default on the union field');
  }
  for (const field of Object.values(schema.options.object ?? {})) assertUnionBranchDefaults(field);
  if (schema.options.inner) assertUnionBranchDefaults(schema.options.inner);
  for (const item of schema.options.list ?? []) assertUnionBranchDefaults(item, schema.meta.type === 'union');
}

/** Defaults on an enclosing object/list must not smuggle a secret into forms. */
function assertPublicDefault(schema: Schema, value: unknown): void {
  if (value === undefined) return;
  if (schema.meta.secret) {
    throw new TypeError('Secret configuration fields cannot contain default values; reference an environment variable');
  }
  switch (schema.meta.type) {
    case 'object':
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [key, field] of Object.entries(schema.options.object ?? {})) {
          assertPublicDefault(field, (value as Record<string, unknown>)[key]);
        }
      }
      break;
    case 'dict':
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const item of Object.values(value)) assertPublicDefault(schema.options.inner!, item);
      }
      break;
    case 'list': case 'tuple':
      if (Array.isArray(value)) value.forEach((item, index) => {
        const inner = schema.meta.type === 'list' ? schema.options.inner : schema.options.list?.[index];
        if (inner) assertPublicDefault(inner, item);
      });
      break;
    case 'union':
      // Validate-only matching is deliberately broader than JSON constraints:
      // inspect every structurally matching branch, including overlaps, so a
      // secret branch can never be bypassed by choosing a public alternative.
      for (const branch of schema.options.list ?? []) {
        if (branch.safeParse(value).success) assertPublicDefault(branch, value);
      }
      break;
    case 'intersect':
      for (const branch of schema.options.list ?? []) assertPublicDefault(branch, value);
      break;
  }
}

function assertJsonValue(value: unknown, parents = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value === 'object') {
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new TypeError('Configuration defaults must contain only JSON values');
    }
    if (parents.has(value)) throw new TypeError('Configuration defaults cannot be cyclic');
    parents.add(value);
    for (const item of Object.values(value)) assertJsonValue(item, parents);
    parents.delete(value);
    return;
  }
  throw new TypeError('Configuration defaults must contain only JSON values');
}
