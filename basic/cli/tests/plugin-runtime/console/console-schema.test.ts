import { describe, expect, it } from 'vitest';
import { jsonSchemaToConsoleSchema } from '../../../src/plugin-runtime/console/console-schema.js';
import { HOST_CONFIG_SCHEMA, parsePluginConfigSchema } from '@zhin.js/runtime';
import { calendarConfig } from '../../../../../plugins/utils/calendar/src/config.js';

describe('jsonSchemaToConsoleSchema', () => {
  it('projects object/list/enum/integer constraints without changing the original schema', () => {
    const input = { type: 'object', additionalProperties: false, required: ['name'], properties: {
      name: { type: 'string', minLength: 2, maxLength: 10, pattern: '^a', title: 'Name' },
      port: { type: 'integer', minimum: 1, maximum: 65535, multipleOf: 1 },
      mode: { type: 'string', enum: ['file', 'base64'] },
      endpoints: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    } }; const before = structuredClone(input);
    expect(jsonSchemaToConsoleSchema(input)).toMatchObject({ type: 'object', additional: false, object: {
      name: { type: 'string', key: 'name', required: true, min: 2, max: 10, pattern: '^a', title: 'Name' },
      port: { type: 'number', integer: true, min: 1, max: 65535, step: 1 },
      mode: { options: [{ label: 'file', value: 'file' }, { label: 'base64', value: 'base64' }] },
      endpoints: { type: 'list', min: 1, uniqueItems: true, inner: { object: { id: { required: true } } } },
    } }); expect(input).toEqual(before);
  });

  it('preserves author-provided option labels over generic enum labels', () => {
    expect(jsonSchemaToConsoleSchema({ type: 'string', enum: ['a'], 'x-zhin-config': { options: [{ label: '选项 A', value: 'a' }] } })).toMatchObject({ options: [{ label: '选项 A', value: 'a' }] });
  });

  it('passes through canonical Console Schema JSON', () => {
    const input = { type: 'object', object: { name: { type: 'string', key: 'name' } } };
    expect(jsonSchemaToConsoleSchema(input)).toEqual(input);
  });

  it('projects actual calendar branches without altering Runtime validation or applying branch defaults', () => {
    const schema = calendarConfig.toJsonSchema(), before = structuredClone(schema);
    const converted = jsonSchemaToConsoleSchema(schema);
    expect(converted).toMatchObject({ object: { provider: { type: 'string', default: 'none', effect: 'reload', options: [
      { label: 'none', value: 'none' }, { label: 'caldav', value: 'caldav' }, { label: 'google', value: 'google' }, { label: 'microsoft', value: 'microsoft' },
    ] }, caldav: { type: 'object', object: { password: { type: 'string' } } } } });
    for (const provider of ['none', 'caldav', 'google', 'microsoft']) expect(parsePluginConfigSchema(schema, { provider }).errors).toEqual([]);
    expect(parsePluginConfigSchema(schema, { provider: 'unsupported' }).errors.length).toBeGreaterThan(0);
    expect(schema).toEqual(before);
  });

  it('preserves parent metadata and branch constraints instead of collapsing unions', () => {
    const converted = jsonSchemaToConsoleSchema({ type: 'object', required: ['mode'], properties: {
      mode: { anyOf: [{ const: 'a', default: 'a', pattern: '^a' }, { type: 'number', minimum: 2 }],
        writeOnly: true, 'x-zhin-config': { effect: 'reload' } },
    } });
    expect(converted).toMatchObject({ object: { mode: { type: 'union', required: true, secret: true, component: 'password', effect: 'reload',
      list: [{ type: 'const', value: 'a', default: 'a', pattern: '^a' }, { type: 'number', min: 2 }],
    } } });
    expect((converted?.object as Record<string, unknown>).mode).not.toHaveProperty('default');
  });

  it('keeps actual Host mixed branches and unconstrained outputSchema visible', () => {
    expect(jsonSchemaToConsoleSchema(HOST_CONFIG_SCHEMA.properties.htmlRenderer)).toMatchObject({ object: {
      aiTextAsImage: { type: 'union', mode: 'anyOf', list: expect.any(Array) },
    } });
    expect(jsonSchemaToConsoleSchema(HOST_CONFIG_SCHEMA.properties.ai)).toMatchObject({ object: { agent: { object: { outputSchema: { type: 'union', list: [{ type: 'boolean' }, { type: 'string' }, { type: 'object' }] } } } } });
  });

  it('preserves local reference metadata and does not erase secret annotations with sibling overrides', () => {
    const converted = jsonSchemaToConsoleSchema({ type: 'object', $defs: { token: { type: 'string', writeOnly: true, minLength: 1 } }, properties: {
      token: { $ref: '#/$defs/token', 'x-zhin-config': { secret: false, effect: 'reload' } },
      tuple: { type: 'array', prefixItems: [{ const: null }] },
    } });
    expect(converted).toMatchObject({ object: {
      token: { type: 'string', secret: true, component: 'password', min: 1, effect: 'reload' },
      tuple: { type: 'tuple', list: [{ type: 'const', value: null }], inner: { type: 'any' } },
    } });
  });
});


describe('validation-only branches', () => {
  it('shows actual typesafe static controls once and leaves the condition authoritative to Host', async () => {
    const { readFile } = await import('node:fs/promises');
    const schema = JSON.parse(await readFile(new URL('../../../../../plugins/services/typesafe/schema.json', import.meta.url), 'utf8'));
    const projection = jsonSchemaToConsoleSchema(schema);
    expect(projection).toMatchObject({ type: 'intersect', list: [
      { type: 'intersect', list: [{ type: 'constraint', reason: 'host-validation' }] },
      { type: 'object', object: { enabled: { type: 'boolean' }, apiKey: { type: 'string', secret: true }, model: { type: 'string' } } },
    ] });
    expect(JSON.stringify(projection)).not.toContain('unsupported-construct');
    expect(parsePluginConfigSchema(schema, { enabled: false }).errors).toEqual([]);
    expect(parsePluginConfigSchema(schema, { enabled: true }).errors.length).toBeGreaterThan(0);
    expect(parsePluginConfigSchema(schema, { enabled: true, apiKey: 'synthetic-test-key' }).errors).toEqual([]);
  });
  it('does not hide conditional properties that are not in the static form or inject their defaults', () => {
    const projection = jsonSchemaToConsoleSchema({ type: 'object', properties: { enabled: { type: 'boolean' } }, allOf: [{
      if: { properties: { enabled: { const: true } } }, then: { properties: { newField: { type: 'string', default: 'inactive' } } },
    }] });
    expect(projection).toMatchObject({ type: 'intersect', list: [{ list: [{ type: 'any', reason: 'unsupported-construct' }] }, { object: { enabled: { type: 'boolean' } } }] });
  });
});
