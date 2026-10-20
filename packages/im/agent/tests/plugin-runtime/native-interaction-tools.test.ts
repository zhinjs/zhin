import { describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from '@zhin.js/tool';
import { createNativeInteractionToolFeatures } from '../../src/plugin-runtime/native-interaction-tools.js';

describe('native interaction ToolFeature', () => {
  it('uses only the turn-scoped QuestionPort and preserves typed input', async () => {
    const ask = vi.fn(async () => ({ type: 'pick' as const, value: 'blue', index: 1 }));
    const tool = createNativeInteractionToolFeatures()[0]!.definition;
    const context = executionContext({ ask });

    await expect(tool.execute({
      question: 'Choose a color', type: 'pick', options: ['red', 'blue'], timeout: 30,
    }, context)).resolves.toBe('blue');
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({
      question: 'Choose a color', type: 'pick', options: ['red', 'blue'], timeoutMs: 30_000,
      signal: context.signal,
    }));
  });

  it('fails closed when the ingress does not provide interactive authority', async () => {
    const tool = createNativeInteractionToolFeatures()[0]!.definition;
    await expect(tool.execute({ question: 'Continue?' }, executionContext()))
      .rejects.toThrow('QuestionPort is unavailable');
  });
});

function executionContext(question?: ToolExecutionContext['question']): ToolExecutionContext {
  return {
    signal: new AbortController().signal,
    traceId: 'trace',
    turnId: 'turn',
    sessionKey: 'im:bot:private:user',
    origin: { kind: 'im', platform: 'sandbox', endpoint: 'bot', scope: 'private', sceneId: 'user' },
    principal: { subjectId: 'user', roles: ['user'] },
    policy: { permissions: ['user'], unattended: false, network: { enabled: false } },
    ...(question ? { question } : {}),
  };
}
