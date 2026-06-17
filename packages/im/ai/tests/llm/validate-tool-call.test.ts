import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  validateToolCall,
  ToolCallValidationError,
  stringParamTool,
} from '../../src/llm/validate-tool-call.js';

describe('validateToolCall', () => {
  const tool = {
    name: 'echo',
    description: 'echo',
    parameters: z.object({
      message: z.string(),
    }),
  };

  it('accepts valid arguments', () => {
    const result = validateToolCall([tool], {
      id: '1',
      name: 'echo',
      arguments: { message: 'hi' },
    });
    expect(result.arguments.message).toBe('hi');
  });

  it('rejects unknown tool', () => {
    expect(() =>
      validateToolCall([tool], { id: '1', name: 'missing', arguments: {} }),
    ).toThrow(ToolCallValidationError);
  });

  it('rejects invalid arguments', () => {
    expect(() =>
      validateToolCall([tool], { id: '1', name: 'echo', arguments: { message: 1 } }),
    ).toThrow(/Invalid arguments/);
  });

  it('stringParamTool builds required schema', () => {
    const t = stringParamTool('search', 'search', ['query']);
    expect(() =>
      validateToolCall([t], { id: '1', name: 'search', arguments: {} }),
    ).toThrow(ToolCallValidationError);
  });
});
