import { describe, expect, it } from 'vitest';
import { Schema, SchemaValidationError } from '../src/index.js';

describe('Schema.safeParse', () => {
  it('accepts valid object without filling defaults', () => {
    const schema = Schema.object({
      name: Schema.string().required(),
      age: Schema.number(),
    });
    const result = schema.safeParse({ name: 'alice' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: 'alice' });
    }
  });

  it('rejects missing required field', () => {
    const schema = Schema.object({
      name: Schema.string().required(),
    });
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(SchemaValidationError);
      expect(result.error.message).toContain('required');
    }
  });

  it('validates union branches', () => {
    const schema = Schema.union([
      Schema.const('a'),
      Schema.const('b'),
    ]);
    expect(schema.safeParse('a').success).toBe(true);
    expect(schema.safeParse('c').success).toBe(false);
  });

  it('validates discriminatedUnion by tag', () => {
    const schema = Schema.discriminatedUnion('type', {
      text: {
        data: Schema.object({ text: Schema.string().required() }).required(),
      },
      mention: {
        data: Schema.object({ target: Schema.string().required() }).required(),
      },
    });
    expect(schema.safeParse({ type: 'text', data: { text: 'hi' } }).success).toBe(true);
    expect(schema.safeParse({ type: 'mention', data: { target: 'all' } }).success).toBe(true);
    expect(schema.safeParse({ type: 'mention', data: {} }).success).toBe(false);
    expect(schema.safeParse({ type: 'image', data: {} }).success).toBe(false);
  });
});
