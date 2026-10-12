import Ajv2020 from 'ajv/dist/2020.js';
import { Schema } from '../src/index.js';

function configValidator(schema: Schema) {
  const ajv = new Ajv2020({ useDefaults: true, allErrors: true, strict: true });
  ajv.addKeyword({ keyword: 'x-zhin-config', schemaType: 'object' });
  return ajv.compile(schema.toJsonSchema());
}

describe('configuration declaration export', () => {
  it('uses one subscription declaration for typed defaults and strict validation', () => {
    const schema = Schema.object({
      interval: Schema.number().min(1).max(86400).step(1).default(300).description('Polling interval in seconds').effect('reload'),
      filters: Schema.list(Schema.string().min(1)).default([]),
      enabled: Schema.boolean().default(true),
      request: Schema.object({ timeout: Schema.number().min(1).default(15) }).default({ timeout: 15 }),
    });
    const validate = configValidator(schema);
    const input = {};
    expect(validate(input)).toBe(true);
    expect(input).toEqual({ interval: 300, filters: [], enabled: true, request: { timeout: 15 } });
    expect(validate({ interval: -1 })).toBe(false);
    expect(validate({ interval: 1.5 })).toBe(false);
    expect(validate({ filters: [''] })).toBe(false);
    expect(validate({ interval: '300' })).toBe(false);
    expect(validate({ typo: true })).toBe(false);
    expect(schema.toJsonSchema()).toMatchObject({
      properties: { interval: { minimum: 1, maximum: 86400, multipleOf: 1, 'x-zhin-config': { effect: 'reload' } } },
    });
  });

  it('exports lookup configuration and secret form hints without carrying a key value', () => {
    const schema = Schema.object({
      apiKey: Schema.string().required().secret().component('password').description('Use ${WEATHER_API_KEY} in configuration'),
      cacheSeconds: Schema.number().min(0).default(0),
      region: Schema.string().option([{ label: 'China', value: 'cn' }, { label: 'Global', value: 'global' }]).default('cn'),
      diagnostics: Schema.boolean().hidden().default(false),
    });
    const validate = configValidator(schema);
    expect(validate({})).toBe(false);
    const input = { apiKey: 'expanded-by-runtime' };
    expect(validate(input)).toBe(true);
    expect(input).toEqual({ apiKey: 'expanded-by-runtime', cacheSeconds: 0, region: 'cn', diagnostics: false });
    expect(validate({ apiKey: 123 })).toBe(false);
    expect(validate({ apiKey: 'value', region: 'unknown' })).toBe(false);
    const exported = schema.toJsonSchema();
    expect(exported).toMatchObject({
      required: ['apiKey'],
      properties: {
        apiKey: { type: 'string', writeOnly: true, 'x-zhin-config': { secret: true, component: 'password' } },
        diagnostics: { 'x-zhin-config': { hidden: true } },
      },
    });
    expect(JSON.stringify(exported)).not.toContain('expanded-by-runtime');
  });

  it('rejects secret defaults regardless of the order of chained calls', () => {
    expect(() => Schema.string().secret().default('key').toJsonSchema()).toThrow('cannot contain default');
    expect(() => Schema.string().default('key').secret().toJsonSchema()).toThrow('cannot contain default');
    expect(() => Schema.number().secret()).toThrow('only supports string');
    expect(() => Schema.object({ apiKey: Schema.string().secret() }).default({ apiKey: 'hidden-key' }).toJsonSchema()).toThrow('cannot contain default');
    expect(() => Schema.list(Schema.string().secret()).default(['hidden-key']).toJsonSchema()).toThrow('cannot contain default');
  });

  it('preserves numeric and boolean choices as JSON values', () => {
    const schema = Schema.object({ count: Schema.number().option([1, 2]), enabled: Schema.boolean().option([false]) });
    const validate = configValidator(schema);
    expect(validate({ count: 2, enabled: false })).toBe(true);
    expect(validate({ count: 3, enabled: false })).toBe(false);
    expect(validate({ count: 1, enabled: true })).toBe(false);
    expect(schema.toJsonSchema()).toMatchObject({ properties: { count: { enum: [1, 2] }, enabled: { enum: [false] } } });
  });

  it('exports tuples, dictionaries and literal alternatives using JSON Schema 2020-12', () => {
    const schema = Schema.object({
      coordinates: Schema.tuple([Schema.number(), Schema.number()]).required(),
      labels: Schema.dict(Schema.string()),
      mode: Schema.union([Schema.const('auto'), Schema.const('manual')]).required(),
    });
    const validate = configValidator(schema);
    expect(validate({ coordinates: [1, 2], mode: 'auto', labels: { cn: '你好' } })).toBe(true);
    expect(validate({ coordinates: [1], mode: 'auto' })).toBe(false);
    expect(validate({ coordinates: [1, 2], mode: 'other' })).toBe(false);
    expect(validate({ coordinates: [1, 2], mode: 'auto', labels: { cn: 1 } })).toBe(false);
  });

  it('rejects non-JSON types and defaults explicitly', () => {
    expect(() => Schema.date().toJsonSchema()).toThrow('cannot describe JSON');
    expect(() => Schema.regexp().toJsonSchema()).toThrow('cannot describe JSON');
    expect(() => Schema.any().default(new Date()).toJsonSchema()).toThrow('only JSON values');
    expect(() => Schema.number().default(NaN).toJsonSchema()).toThrow('only JSON values');
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => Schema.any().default(cycle).toJsonSchema()).toThrow('cannot be cyclic');
  });

  it('closes the combined object intersection instead of rejecting each other’s fields', () => {
    const schema = Schema.object({
      connection: Schema.intersect([
        Schema.object({ host: Schema.string().required() }),
        Schema.object({ port: Schema.number().default(5432) }),
      ]).required(),
    });
    const validate = configValidator(schema);
    const input = { connection: { host: 'localhost' } };
    expect(validate(input)).toBe(true);
    expect(input).toEqual({ connection: { host: 'localhost', port: 5432 } });
    expect(validate({ connection: { host: 'localhost', port: '5432' } })).toBe(false);
    expect(validate({ connection: { host: 'localhost', typo: true } })).toBe(false);
  });

  it('keeps the existing business schema serialization separate from the standard export', () => {
    const schema = Schema.object({ limit: Schema.number().default(10) });
    expect(schema.toJSON()).toMatchObject({ type: 'object', object: { limit: { type: 'number', default: 10 } } });
    expect(schema.toJsonSchema()).toMatchObject({ type: 'object', properties: { limit: { type: 'number', default: 10 } } });
  });
});
