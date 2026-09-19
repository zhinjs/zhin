import { describe, expect, it } from 'vitest';
import { jsonSchemaToConsoleSchema } from '../../../src/plugin-runtime/console/console-schema.js';

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
});
