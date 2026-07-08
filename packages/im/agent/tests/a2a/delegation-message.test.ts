import { describe, it, expect } from 'vitest';
import { TaskState } from '@a2a-js/sdk';
import { buildSendMessageRequest } from '../../src/a2a/delegation-message.js';
import { mapA2aTaskState, extractTaskResultText } from '../../src/a2a/task-state.js';

describe('A2A delegation message', () => {
  it('builds SendMessageRequest with skillId from role', () => {
    const req = buildSendMessageRequest({
      title: 'Job',
      description: 'Do work',
      role: 'planner',
    });
    expect(req.message?.parts.length).toBeGreaterThan(0);
    expect(req.metadata?.skillId).toBe('planner');
  });
});

describe('A2A task state mapping', () => {
  it('maps completed state', () => {
    expect(mapA2aTaskState(TaskState.TASK_STATE_COMPLETED)).toBe('completed');
  });

  it('extracts result text from artifacts', () => {
    const text = extractTaskResultText({
      id: 't1',
      contextId: 'c1',
      status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: undefined },
      artifacts: [{
        artifactId: 'a1',
        name: 'result',
        description: '',
        parts: [{
          content: { $case: 'text', value: 'done' },
          metadata: undefined,
          filename: '',
          mediaType: 'text/plain',
        }],
        metadata: undefined,
        extensions: [],
      }],
      history: [],
      metadata: undefined,
    });
    expect(text).toBe('done');
  });
});
