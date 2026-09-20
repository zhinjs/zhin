/** Converts plugin JSON Schema into the schema shape consumed by Console forms. */
export function jsonSchemaToConsoleSchema(
  input: unknown,
  key?: string,
): Record<string, unknown> | null {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return null;
  const schema = input as Record<string, unknown>;

  if (isConsoleSchemaJson(schema)) {
    return key && schema.key == null ? { ...schema, key } : { ...schema };
  }

  const typeField = schema.type;
  const description = typeof schema.description === 'string' ? schema.description : undefined;
  const defaultValue = schema.default;
  const requiredFlag = schema.required === true ? true : undefined;

  if (Array.isArray(typeField)) {
    const list = typeField
      .filter((type): type is string => typeof type === 'string')
      .map((type) => jsonSchemaToConsoleSchema({ type }))
      .filter((item): item is Record<string, unknown> => item != null);
    return compactMeta({
      type: 'union',
      key,
      description,
      default: defaultValue,
      list,
    });
  }

  const type = typeof typeField === 'string' ? typeField : inferJsonSchemaType(schema);
  if (type === 'object' || schema.properties != null) {
    return convertObjectSchema(schema, key, description, defaultValue, requiredFlag);
  }
  if (type === 'array') {
    const inner = Array.isArray(schema.items)
      ? { type: 'any' as const }
      : (jsonSchemaToConsoleSchema(schema.items) ?? { type: 'any' });
    return compactMeta({
      type: 'list',
      key,
      description,
      default: defaultValue,
      required: requiredFlag,
      inner,
      ...(Array.isArray(schema.enum)
        ? { options: schema.enum.map((value) => ({ label: String(value), value })) }
        : {}),
    });
  }

  const options = Array.isArray(schema.enum)
    ? schema.enum.map((value) => ({ label: String(value), value }))
    : undefined;
  return compactMeta({
    type: type === 'integer' ? 'number' : (type ?? 'any'),
    key,
    description,
    default: defaultValue,
    required: requiredFlag,
    min: typeof schema.minimum === 'number' ? schema.minimum : undefined,
    max: typeof schema.maximum === 'number' ? schema.maximum : undefined,
    options,
  });
}

function convertObjectSchema(
  schema: Record<string, unknown>,
  key: string | undefined,
  description: string | undefined,
  defaultValue: unknown,
  requiredFlag: true | undefined,
): Record<string, unknown> {
  const properties = schema.properties && typeof schema.properties === 'object'
    && !Array.isArray(schema.properties)
    ? schema.properties as Record<string, unknown>
    : {};
  const required = Array.isArray(schema.required)
    ? new Set(schema.required.map(String))
    : new Set<string>();
  const object: Record<string, unknown> = {};
  for (const [propertyKey, propertySchema] of Object.entries(properties)) {
    const converted = jsonSchemaToConsoleSchema(propertySchema, propertyKey);
    if (!converted) continue;
    if (required.has(propertyKey)) converted.required = true;
    object[propertyKey] = converted;
  }
  if (
    Object.keys(object).length === 0
    && schema.additionalProperties
    && typeof schema.additionalProperties === 'object'
  ) {
    return compactMeta({
      type: 'dict',
      key,
      description,
      default: defaultValue,
      inner: jsonSchemaToConsoleSchema(schema.additionalProperties) ?? { type: 'any' },
    });
  }
  return compactMeta({
    type: 'object',
    key,
    description,
    default: defaultValue,
    required: requiredFlag,
    object,
  });
}

function isConsoleSchemaJson(schema: Record<string, unknown>): boolean {
  if (schema.object != null || schema.list != null || schema.inner != null) return true;
  if (typeof schema.type === 'string'
    && ['dict', 'union', 'tuple', 'intersect', 'const', 'any', 'date', 'regexp'].includes(schema.type)) {
    return true;
  }
  if (
    schema.properties != null
    || schema.items != null
    || schema.$schema != null
    || schema.additionalProperties != null
    || schema.anyOf != null
    || schema.oneOf != null
    || schema.allOf != null
    || schema.enum != null
    || schema.minimum != null
    || schema.maximum != null
    || schema.type === 'integer'
    || Array.isArray(schema.type)
  ) {
    return false;
  }
  return typeof schema.type === 'string';
}

function inferJsonSchemaType(schema: Record<string, unknown>): string | undefined {
  if (schema.properties != null) return 'object';
  if (schema.items != null) return 'array';
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return typeof schema.enum[0];
  if (schema.enum != null) return 'string';
  return undefined;
}

function compactMeta(meta: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(meta).filter(([, value]) => value !== undefined),
  );
}
