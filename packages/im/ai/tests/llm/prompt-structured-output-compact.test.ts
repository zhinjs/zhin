import { describe, expect, it } from 'vitest';
import { registerStructuredOutputPromptText, withStructuredOutputInstruction } from '../../src/llm/bridge/prompt-structured-output.js';

describe('prompt-mode structured output text', () => {
  const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] };

  it('shows the JSON Schema when no compact text is registered', () => {
    const context = withStructuredOutputInstruction({ systemPrompt: 'sys', messages: [] }, schema);
    expect(context.systemPrompt).toContain(JSON.stringify(schema));
  });

  it('shows the registered compact text instead of the schema, which is left untouched', () => {
    const registered = { ...schema };
    registerStructuredOutputPromptText(registered, 'COMPACT {a:str}');
    const context = withStructuredOutputInstruction({ systemPrompt: 'sys', messages: [] }, registered);
    expect(context.systemPrompt).toBe('sys\n\nCOMPACT {a:str}');
    expect(context.systemPrompt).not.toContain('"required"');
    expect(registered).toEqual(schema);
  });
});
