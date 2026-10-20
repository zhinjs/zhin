import { describe, expect, it } from 'vitest';
import { jsonSchemaToConsoleSchema } from '../../../src/plugin-runtime/console/console-schema.js';
import { HOST_CONFIG_SCHEMA, parsePluginConfigSchema } from '@zhin.js/runtime';
import { calendarConfig } from '../../../../../plugins/utils/calendar/src/config.js';

describe('jsonSchemaToConsoleSchema', () => {
  it('converts object properties to the canonical Console object map', () => {
    const consoleSchema = jsonSchemaToConsoleSchema({
      type: 'object',
      properties: {
        name: { type: 'string', description: 'QQ uin' },
        autoReconnect: { type: 'boolean', default: true },
        endpoints: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
        },
      },
      required: ['name'],
    });
    expect(consoleSchema).toMatchObject({
      type: 'object',
      object: {
        name: { type: 'string', key: 'name', description: 'QQ uin', required: true },
        autoReconnect: { type: 'boolean', key: 'autoReconnect', default: true },
        endpoints: {
          type: 'list',
          key: 'endpoints',
          inner: {
            type: 'object',
            object: {
              name: { type: 'string', key: 'name', required: true },
            },
          },
        },
      },
    });
    expect(consoleSchema).not.toHaveProperty('dict');
    expect(consoleSchema).not.toHaveProperty('properties');
  });

  it('maps enum to options and integer to number', () => {
    const consoleSchema = jsonSchemaToConsoleSchema({
      type: 'object',
      properties: {
        outboundMedia: { type: 'string', enum: ['file', 'base64'] },
        port: { type: 'integer', minimum: 1, maximum: 65535 },
      },
    });
    expect(consoleSchema?.object).toMatchObject({
      outboundMedia: {
        type: 'string',
        options: [
          { label: 'file', value: 'file' },
          { label: 'base64', value: 'base64' },
        ],
      },
      port: { type: 'number', min: 1, max: 65535 },
    });
  });

  it('passes through canonical Console Schema JSON', () => {
    const input = {
      type: 'object',
      object: { name: { type: 'string', key: 'name' } },
    };
    expect(jsonSchemaToConsoleSchema(input)).toEqual(input);
  });

  it('projects the actual calendar provider without changing its validator or nested configuration', () => {
    const schema = calendarConfig.toJsonSchema();
    const before = structuredClone(schema);
    const converted = jsonSchemaToConsoleSchema(schema);
    expect(converted).toMatchObject({ object: {
      provider: { type: 'string', default: 'none', effect: 'reload', options: [
        { label: 'none', value: 'none' }, { label: 'caldav', value: 'caldav' },
        { label: 'google', value: 'google' }, { label: 'microsoft', value: 'microsoft' },
      ] },
      caldav: { type: 'object', object: { password: { type: 'string' } } },
      google: { type: 'object', object: { refresh_token: { type: 'string' } } },
    } });
    for (const provider of ['none', 'caldav', 'google', 'microsoft']) {
      expect(parsePluginConfigSchema(schema, { provider }).errors).toEqual([]);
    }
    expect(parsePluginConfigSchema(schema, { provider: 'unsupported' }).errors.length).toBeGreaterThan(0);
    expect(schema).toEqual(before);
  });

  it('preserves required, secret and outer default metadata, without applying branch defaults', () => {
    const converted = jsonSchemaToConsoleSchema({ type: 'object', required: ['mode'], properties: {
      mode: { anyOf: [{ const: 'a', default: 'a' }, { const: 'b', default: 'b' }],
        writeOnly: true, 'x-zhin-config': { effect: 'reload' } },
    } });
    expect(converted).toMatchObject({ object: { mode: {
      type: 'string', required: true, secret: true, component: 'password', effect: 'reload',
      options: [{ label: 'a', value: 'a' }, { label: 'b', value: 'b' }],
    } } });
    expect((converted?.object as Record<string, unknown>).mode).not.toHaveProperty('default');
  });

  it.each([
    { anyOf: [] },
    { anyOf: [{ const: 'a' }, { const: 1 }] },
    { anyOf: [{ const: 'a' }, { type: 'string' }] },
    { anyOf: [{ const: 'a' }, { const: 'a' }] },
    { anyOf: [{ const: '' }, { const: 'a' }] },
    { anyOf: [{ const: 'a', default: 'b' }] },
    { anyOf: [{ const: 'a', type: 'number' }] },
    { anyOf: [{ const: 'a', pattern: '^a$' }] },
    { anyOf: [{ const: 'a' }], default: 'b' },
    { anyOf: [{ const: 'a' }], enum: ['b'] },
    { anyOf: [{ const: 'a' }], minLength: 2 },
    { anyOf: [{ const: 'a' }], type: 'object' },
    { anyOf: [{ const: 'a' }], properties: { extra: { type: 'string' } } },
    { anyOf: [{ const: 'a' }], 'x-zhin-config': { options: [{ value: 'b', label: 'b' }] } },
    { anyOf: [{ const: 'a' }], 'x-zhin-config': { options: [{ value: 'a', label: { invalid: true } }] } },
    { anyOf: Array.from({ length: 65 }, (_, index) => ({ const: String(index) })) },
    { anyOf: [{ const: 'a'.repeat(257) }] },
  ])('does not erase unsupported union constraints: %j', schema => {
    expect(jsonSchemaToConsoleSchema(schema)).toMatchObject({ type: 'any' });
  });

  it('keeps unsupported actual Host fields present for whole-form source fallback', () => {
    const renderer = jsonSchemaToConsoleSchema(HOST_CONFIG_SCHEMA.properties.htmlRenderer);
    expect(renderer).toMatchObject({ object: { aiTextAsImage: { type: 'any' } } });
    expect(Object.keys(renderer?.object as object)).toEqual(
      Object.keys(HOST_CONFIG_SCHEMA.properties.htmlRenderer.properties),
    );
    const ai = jsonSchemaToConsoleSchema(HOST_CONFIG_SCHEMA.properties.ai);
    expect(ai).toMatchObject({ object: { agent: { object: { outputSchema: { type: 'any' } } } } });
  });
});
