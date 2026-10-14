/**
 * #740 finding 1: a plugin tool that reuses a reserved built-in name
 * (`write_file`) is subject to the built-in's file policy. On a turn without
 * workspace authority the call must be visibly denied, recorded in the
 * journal/trace and returned to the model as an error, never silently dropped.
 */
import { describe, expect, it } from 'vitest';
import { runEvalCase } from '../../evals/framework/index.js';

describe('reserved-name tool calls', () => {
  it('are denied with a recorded reason and the model gets a result to recover from', async () => {
    const run = await runEvalCase({
      id: 'reserved-name-denied',
      description: 'A plugin tool named write_file on a turn without workspace authority.',
      inbound: { text: 'write it', sender: { id: 'owner', roles: ['master'] } },
      tools: [{ name: 'write_file', result: 'should not run' }],
      script: [{ toolCalls: [{ name: 'write_file', args: { file_path: 'a.txt', content: 'x' } }] }, { text: 'Writing files is not available here.' }],
      expect: {},
    });
    expect(run.executedTools).toEqual([]);
    const call = run.traces[0]?.tool_calls.find((entry) => entry.tool_name === 'write_file');
    expect(call).toMatchObject({ status: 'denied', policy: 'workspace-access' });
    // The loop continued: the denial came back to the model as a tool result.
    expect(run.modelRequests).toHaveLength(2);
    expect(run.outbound).toEqual(['Writing files is not available here.']);
  });
});
