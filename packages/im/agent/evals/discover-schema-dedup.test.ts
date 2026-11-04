import { describe, expect, it } from 'vitest';
import definition from './cases/deferred-announcement-discover-schema.case.js';
import { evaluateExpectations, runEvalCase } from './framework/index.js';

describe('discover schema at the model request boundary', () => {
  it('keeps the complete definition in tools, not in messages, without an extra loading request', async () => {
    const run = await runEvalCase(definition);
    const tool = definition.tools![0];
    const [before, afterDiscover, afterExecution] = run.modelRequests;

    expect(run.modelRequests).toHaveLength(3);
    expect(before.offeredTools).not.toContain(tool.name);
    expect(afterDiscover.toolCalls).toEqual([tool.name]);
    expect(run.attemptedTools).toEqual(['discover', tool.name]);
    expect(run.executedTools).toEqual([{ name: tool.name, args: { content: '周五放假' } }]);
    for (const request of [afterDiscover, afterExecution]) {
      const definitions = JSON.parse(request.toolSchemaText);
      expect(definitions.filter((entry: { name: string }) => entry.name === tool.name)).toEqual([{
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }]);
      expect(request.inputText).not.toContain('ANNOUNCEMENT-SCHEMA-MARKER');
    }
    // Loading appends definitions; executing them must not reshuffle the cache prefix.
    expect(afterExecution.toolSchemaText).toBe(afterDiscover.toolSchemaText);
    expect(evaluateExpectations(definition, run)).toEqual([]);
  });
});
