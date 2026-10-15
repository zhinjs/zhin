/**
 * S5: tool JSON Schemas reach the provider as written (enum, anyOf, nullable,
 * integer, format, bounds), and tool-call arguments are validated against the
 * same constraints. Request bodies come from the shared provider harness (`h.capture`).
 */
import { describe, expect, it } from 'vitest';
import { agentToolToLlmTool, jsonSchemaToZod } from '../../src/llm/tool-bridge.js';
import { validateToolCall } from '../../src/llm/validate-tool-call.js';
import type { ProviderInstanceConfig } from '../../src/llm/types/model.js';
import type { AgentTool, JsonSchema } from '../../src/types.js';
import { createProviderHarness } from '../helpers/provider-harness/index.js';

const PARAMS: JsonSchema = {
  type: 'object',
  properties: {
    unit: { type: 'string', enum: ['celsius', 'fahrenheit'], description: 'Temperature unit' },
    days: { type: 'integer', minimum: 1, maximum: 7 },
    city: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
    note: { type: ['string', 'null'] },
    region: { type: 'string', nullable: true },
    when: { type: 'string', format: 'date-time' },
    mode: { const: 'fast' },
    tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] }, maxItems: 2 },
    options: { type: 'object', properties: { verbose: { type: 'boolean' } }, required: ['verbose'] },
    extra: { description: 'Anything' },
  },
  required: ['unit', 'days'],
};

const agentTool: AgentTool = { name: 'forecast', description: 'Forecast', parameters: PARAMS, execute: async () => 'ok' };

async function requestBody(sdk: ProviderInstanceConfig['sdk'], modelId: string) {
  const h = createProviderHarness({ sdk, model: modelId });
  const { body } = await h.capture({ system: 'sys', user: 'hi', tools: [agentToolToLlmTool(agentTool)] });
  return body;
}

describe('tool schema fidelity (S5)', () => {
  it('openai: parameters keep enum, integer, anyOf, nullable type arrays, format, const and bounds', async () => {
    const body = await requestBody('openai', 'gpt-5');
    const params = body.tools[0].function.parameters;
    expect(params.required).toEqual(['unit', 'days']);
    expect(params.properties.unit).toEqual({ type: 'string', enum: ['celsius', 'fahrenheit'], description: 'Temperature unit' });
    expect(params.properties.days).toEqual({ type: 'integer', minimum: 1, maximum: 7 });
    expect(params.properties.city.anyOf).toEqual([{ type: 'string', minLength: 1 }, { type: 'null' }]);
    expect(params.properties.note.type).toEqual(['string', 'null']);
    expect(params.properties.when.format).toBe('date-time');
    expect(params.properties.mode.const).toBe('fast');
    expect(params.properties.tags.items.enum).toEqual(['a', 'b']);
    expect(params.properties.options.required).toEqual(['verbose']);
  });

  it('anthropic: input_schema is the tool schema as written', async () => {
    const body = await requestBody('anthropic', 'claude-sonnet-4-5');
    const schema = body.tools[0].input_schema;
    expect(schema.properties.unit.enum).toEqual(['celsius', 'fahrenheit']);
    expect(schema.properties.days.type).toBe('integer');
    expect(schema.properties.city.anyOf).toHaveLength(2);
    expect(schema.properties.region).toEqual({ type: 'string', nullable: true });
  });

  it('openai-compatible: same parameters', async () => {
    const body = await requestBody('openai-compatible', 'some-model');
    expect(body.tools[0].function.parameters.properties.days.type).toBe('integer');
    expect(body.tools[0].function.parameters.properties.unit.enum).toEqual(['celsius', 'fahrenheit']);
  });

  it('google: enum, integer, nullable and format survive; untyped properties get a type', async () => {
    const body = await requestBody('google', 'gemini-3.8-flash');
    const params = body.tools[0].functionDeclarations[0].parameters;
    expect(params.properties.unit).toMatchObject({ type: 'string', enum: ['celsius', 'fahrenheit'] });
    expect(params.properties.days.type).toBe('integer');
    expect(params.properties.city).toMatchObject({ type: 'string', nullable: true });
    expect(params.properties.note).toMatchObject({ nullable: true });
    expect(params.properties.when.format).toBe('date-time');
    expect(params.properties.mode.enum).toEqual(['fast']);
    expect(params.properties.extra).toEqual({ type: 'string', description: 'Anything' });
    expect(params.required).toEqual(['unit', 'days']);
  });

  it('a tool with no parameters still sends an object schema', async () => {
    const h = createProviderHarness({ sdk: 'openai', model: 'gpt-5' });
    const empty = agentToolToLlmTool({ name: 'now', description: 'Time', parameters: { type: 'object' }, execute: async () => '' });
    const { body } = await h.capture({ system: 's', user: 'hi', tools: [empty] });
    expect(body.tools[0].function.parameters).toMatchObject({ type: 'object', properties: {} });
  });

  it('validation enforces the same constraints the provider was told about', () => {
    const tools = [agentToolToLlmTool(agentTool)];
    const call = (args: Record<string, unknown>) => validateToolCall(tools, { id: '1', name: 'forecast', arguments: args });
    expect(() => call({ unit: 'celsius', days: 3 })).not.toThrow();
    expect(() => call({ unit: 'kelvin', days: 3 })).toThrow(/Invalid arguments/);
    expect(() => call({ unit: 'celsius', days: 1.5 })).toThrow(/Invalid arguments/);
    expect(() => call({ unit: 'celsius', days: 9 })).toThrow(/Invalid arguments/);
    expect(() => call({ unit: 'celsius', days: 3, city: null, note: null, region: null })).not.toThrow();
    expect(() => call({ unit: 'celsius', days: 3, city: '' })).toThrow(/Invalid arguments/);
    expect(() => call({ unit: 'celsius', days: 3, mode: 'slow' })).toThrow(/Invalid arguments/);
    expect(() => call({ unit: 'celsius', days: 3, tags: ['a', 'c'] })).toThrow(/Invalid arguments/);
    expect(() => call({ unit: 'celsius', days: 3, options: {} })).toThrow(/Invalid arguments/);
    expect(() => call({ unit: 'celsius', days: 3, extra: { any: 1 } })).not.toThrow();
  });

  it('mixed-type enums validate by value', () => {
    const schema = jsonSchemaToZod({ type: 'object', properties: { level: { enum: [1, 'max', null] } }, required: ['level'] });
    expect(schema.safeParse({ level: 1 }).success).toBe(true);
    expect(schema.safeParse({ level: null }).success).toBe(true);
    expect(schema.safeParse({ level: 2 }).success).toBe(false);
  });
});
