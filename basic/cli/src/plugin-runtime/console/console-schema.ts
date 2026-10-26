import { readStringLiteralOptions } from './string-literal-options.js';

type Schema = Record<string, unknown>;
type Context = { root: unknown; references: ReadonlySet<string>; depth: number; budget: { remaining: number }; properties?: ReadonlySet<string> };
const record = (value: unknown): value is Schema => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const own = (value: Schema, key: string): boolean => Object.hasOwn(value, key);
const jsonTypes = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const unsupportedKeywords = ['not', 'if', 'then', 'else', 'dependentSchemas', '$dynamicRef', 'patternProperties', 'contains'];

/** Display projection only. Runtime retains the original JSON Schema validator. */
export function jsonSchemaToConsoleSchema(input: unknown, key?: string): Schema | null {
  if (input === undefined || input === null) return null;
  return convert(input, key, { root: input, references: new Set(), depth: 0, budget: { remaining: 8192 } });
}
function convert(input: unknown, key: string | undefined, context: Context): Schema {
  const fallback = (reason?: string): Schema => ({ type: 'any', ...(key === undefined ? {} : { key }), ...(reason ? { reason } : {}) });
  if (--context.budget.remaining < 0 || context.depth > 64) return fallback('projection-limit');
  if (typeof input === 'boolean') return input ? fallback() : fallback('never-schema');
  if (!record(input)) return fallback('malformed-schema');
  const schema = input;
  const properties = new Set([...context.properties ?? [], ...Object.keys(record(schema.properties) ? schema.properties : {})]);
  const child = (value: unknown, name?: string, references = context.references): Schema => convert(value, name, { ...context, depth: context.depth + 1, references, properties: undefined });
  const sameValue = (value: unknown, references = context.references): Schema => convert(value, undefined, { ...context, depth: context.depth + 1, references, properties });
  const finish = (value: Schema): Schema => annotate(value, schema, key);
  if (typeof schema.$ref === 'string') {
    const reference = schema.$ref;
    if (reference !== '#' && !reference.startsWith('#/')) return finish(fallback('external-reference'));
    if (context.references.has(reference)) return finish(fallback('cyclic-reference'));
    let target = context.root;
    try {
      for (const raw of reference === '#' ? [] : reference.slice(2).split('/')) {
        const part = decodeURIComponent(raw).replaceAll('~1', '/').replaceAll('~0', '~');
        if (!record(target) || !own(target, part)) return finish(fallback('unresolved-reference'));
        target = target[part];
      }
    } catch { return finish(fallback('unresolved-reference')); }
    const references = new Set(context.references); references.add(reference);
    const resolved = sameValue(target, references);
    const { $ref: _reference, ...siblings } = schema;
    const validations = Object.keys(siblings).filter(name => !annotationKeys.has(name) && !['$defs', 'definitions', '$id', '$schema', '$comment'].includes(name));
    return finish(validations.length ? { type: 'intersect', list: [resolved, sameValue(siblings)] } : resolved);
  }
  // Unsupported semantics stay editable as JSON at this field; siblings never disappear.
  if (unsupportedKeywords.some(name => own(schema, name))) {
    if (properties.size && validationOnly(schema, properties)) {
      const constraint = { type: 'constraint', reason: 'host-validation' };
      const { if: _if, then: _then, else: _else, not: _not, ...base } = schema;
      return finish(schema.properties ? { type: 'intersect', list: [constraint, sameValue(base)] } : constraint);
    }
    return finish(fallback('unsupported-construct'));
  }
  const literalOptions = readStringLiteralOptions(schema);
  if (literalOptions) return finish({ type: 'string', options: literalOptions });
  if (isConsoleSchemaJson(schema)) {
    const result: Schema = { ...schema };
    if (record(schema.object)) result.object = Object.fromEntries(Object.entries(schema.object).map(([name, value]) => [name, child(value)]));
    if (Array.isArray(schema.list)) result.list = schema.list.map(value => child(value));
    if (schema.inner !== undefined) result.inner = schema.inner === false ? false : child(schema.inner);
    if (schema.additional !== undefined) result.additional = schema.additional === false ? false : child(schema.additional);
    if (schema.type === 'const' && !own(schema, 'value') && own(schema, 'default')) result.value = schema.default;
    return finish(result);
  }
  for (const [keyword, type] of [['allOf', 'intersect'], ['anyOf', 'union'], ['oneOf', 'union']] as const) {
    if (!Array.isArray(schema[keyword])) continue;
    if (schema[keyword].length === 0) return finish(fallback('malformed-schema'));
    const { [keyword]: _branches, ...siblings } = schema;
    const list = (schema[keyword] as unknown[]).map(value => sameValue(value));
    const structuralSibling = ['properties', 'items', 'prefixItems', 'additionalProperties'].some(name => own(siblings, name));
    const composed = { type, list, ...(type === 'union' ? { mode: keyword } : {}) };
    return finish(structuralSibling ? { type: 'intersect', list: [composed, sameValue(siblings)] } : composed);
  }
  if (Array.isArray(schema.type)) {
    const { type: _types, ...constraints } = schema;
    return finish({ type: 'union', list: schema.type.map(type => child({ ...constraints, type })) });
  }
  if (own(schema, 'const')) return finish({ type: 'const', value: schema.const });
  const type = typeof schema.type === 'string' ? schema.type : schema.properties ? 'object' : schema.items || schema.prefixItems ? 'array' : undefined;
  if (type === 'object') {
    const properties = record(schema.properties) ? schema.properties : {};
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const object = Object.fromEntries(Object.entries(properties).map(([name, value]) => [name, { ...child(value, name), ...(required.has(name) ? { required: true } : {}) }]));
    const additional = schema.additionalProperties === false ? false : child(schema.additionalProperties ?? true);
    return finish(Object.keys(object).length === 0 && record(schema.additionalProperties)
      ? { type: 'dict', inner: additional } : { type: 'object', object, additional });
  }
  if (type === 'array') {
    const prefix = Array.isArray(schema.prefixItems) ? schema.prefixItems : Array.isArray(schema.items) ? schema.items : undefined;
    return finish(prefix ? { type: 'tuple', list: prefix.map(value => child(value)), inner: schema.items === false || schema.additionalItems === false ? false : child(Array.isArray(schema.items) ? schema.additionalItems ?? true : schema.items ?? true) }
      : { type: 'list', inner: child(schema.items ?? true) });
  }
  const inferred = type ?? (Array.isArray(schema.enum) && schema.enum.length ? (schema.enum[0] === null ? 'null' : typeof schema.enum[0]) : 'any');
  return finish({ type: inferred === 'integer' ? 'number' : jsonTypes.has(inferred) ? inferred : 'any', ...(inferred === 'integer' ? { integer: true } : {}) });
}
const annotationKeys = new Set(['title', 'description', 'x-descriptionZh', 'x-i18n', 'default', 'readOnly', 'writeOnly', 'examples', 'deprecated', 'x-zhin-config', 'key', 'hidden', 'component', 'options', 'effect', 'secret']);
function annotate(result: Schema, schema: Schema, key?: string): Schema {
  const output: Schema = { ...result };
  if (record(schema['x-i18n'])) output['x-i18n'] = schema['x-i18n'];
  for (const name of ['key', 'title', 'default', 'min', 'max', 'step', 'integer', 'pattern', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum', 'multipleOf', 'uniqueItems', 'minProperties', 'maxProperties', 'exclusiveMinimum', 'exclusiveMaximum', 'readOnly', 'deprecated', 'format', 'unevaluatedProperties']) if (own(schema, name)) output[name] = schema[name];
  if (key !== undefined && output.key === undefined) output.key = key;
  const description = typeof schema['x-descriptionZh'] === 'string' ? schema['x-descriptionZh'] : schema.description;
  if (typeof description === 'string') output.description = description;
  // Existing bilingual Host schemas already keep the English original beside x-descriptionZh.
  if (typeof schema['x-descriptionZh'] === 'string' && typeof schema.description === 'string') {
    const catalog = record(output['x-i18n']) ? output['x-i18n'] : {};
    const english = record(catalog.en) ? catalog.en : {};
    output['x-i18n'] = { ...catalog, en: { description: schema.description, ...english } };
  }
  if (typeof schema.required === 'boolean') output.required = schema.required;
  if (Array.isArray(schema.enum)) output.options = schema.enum.map(value => ({ label: String(value), value }));
  for (const name of ['hidden', 'component', 'options', 'effect']) if (schema[name] !== undefined) output[name] = schema[name];
  const metadata = record(schema['x-zhin-config']) ? schema['x-zhin-config'] : {};
  for (const name of ['hidden', 'component', 'options', 'effect']) if (metadata[name] !== undefined) output[name] = metadata[name];
  if (output.secret !== true && typeof schema.secret === 'boolean') output.secret = schema.secret;
  if (output.secret === true || schema.writeOnly === true || schema.secret === true || metadata.secret === true) {
    output.secret = true;
    if (output.component !== 'textarea') output.component = 'password';
  }
  const bounds = schema.type === 'string' ? ['minLength', 'maxLength'] : schema.type === 'array' ? ['minItems', 'maxItems'] : ['minimum', 'maximum'];
  if (typeof schema[bounds[0]!] === 'number') output.min = schema[bounds[0]!];
  if (typeof schema[bounds[1]!] === 'number') output.max = schema[bounds[1]!];
  if (typeof schema.multipleOf === 'number') output.step = schema.multipleOf;
  return output;
}

export function isConsoleSchemaJson(schema: Schema): boolean {
  if (schema.object !== undefined || schema.list !== undefined || schema.inner !== undefined || schema.additional !== undefined) return true;
  return typeof schema.type === 'string' && (['dict', 'union', 'tuple', 'intersect', 'const', 'any', 'date', 'regexp', 'list'].includes(schema.type)
    || ['string', 'number', 'boolean', 'null'].includes(schema.type) && (schema.key !== undefined || typeof schema.required === 'boolean' || ['hidden', 'component', 'options', 'effect', 'secret'].some(name => own(schema, name))) && !['const', 'anyOf', 'oneOf', 'allOf', '$ref'].some(name => own(schema, name)));
}

/** Validation-only branches do not own a second editable copy of the same value. */
function validationOnly(schema: Schema, properties: ReadonlySet<string>): boolean {
  if (['$ref', '$dynamicRef', 'default', 'items', 'prefixItems', 'additionalProperties', 'patternProperties', 'contains', 'dependentSchemas'].some(name => own(schema, name))) return false;
  if (Array.isArray(schema.required) && schema.required.some(name => !properties.has(String(name)))) return false;
  if (record(schema.properties)) {
    for (const [name, definition] of Object.entries(schema.properties)) {
      if (!properties.has(name) || !record(definition) || !validationOnly(definition, new Set())) return false;
    }
  }
  for (const name of ['if', 'then', 'else', 'not']) if (own(schema, name) && (!record(schema[name]) || !validationOnly(schema[name], properties))) return false;
  for (const name of ['allOf', 'anyOf', 'oneOf']) if (Array.isArray(schema[name]) && !(schema[name] as unknown[]).every(value => record(value) && validationOnly(value, properties))) return false;
  return true;
}
