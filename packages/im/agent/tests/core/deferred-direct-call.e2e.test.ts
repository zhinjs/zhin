/**
 * Auto-loading deferred tools must not widen what a turn can call: names that
 * are not in the turn's catalog are still rejected as unknown. (The auto-load
 * path itself is covered in packages/im/ai/tests/llm/agent-loop-missing-tool.test.ts
 * and the controller tests; tools passed to `process()` are never deferred.)
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZhinAgent } from '@zhin.js/agent';
import type { AIProvider, Tool } from '@zhin.js/core';
import {
  assistantTextReply,
  assistantToolCallReply,
  wireMockLlmApi,
  type MockLlmApi,
} from '../helpers/mock-llm-api.js';
import { mockCommMessage } from '../helpers/mock-comm-message.js';

function deferredTool(name: string): Tool & { execute: ReturnType<typeof vi.fn> } {
  return {
    name,
    description: `${name} (deferred plugin tool)`,
    parameters: { type: 'object', properties: {} },
    execute: vi.fn(async () => `${name} result`),
  };
}

function createAgent(llm: MockLlmApi): ZhinAgent {
  const provider = Object.assign(llm.provider, {
    listModels: vi.fn(async () => ['mock-model']),
  }) as unknown as AIProvider;
  return new ZhinAgent(provider, { persona: '测试助手', maxIterations: 5 }, undefined, llm.runtime);
}

const message = () => mockCommMessage({ adapter: 'test', endpoint: 'bot1', senderId: 'u1', scope: 'private', sceneId: 's1' });

describe('direct call to a tool outside the turn catalog', () => {
  let agent: ZhinAgent | undefined;

  afterEach(() => {
    agent?.dispose();
    agent = undefined;
  });

  function callOnceThenAnswer(llm: MockLlmApi, toolName: string): void {
    llm.respondWith((context) => {
      const answered = context.messages.some((entry) => entry.role === 'toolResult');
      return answered
        ? assistantTextReply('完成')
        : assistantToolCallReply([{ id: 'call-1', name: toolName, arguments: {} }]);
    });
  }

  it('still rejects a name that is not in the turn catalog', async () => {
    const llm = wireMockLlmApi();
    callOnceThenAnswer(llm, 'delete_everything');
    agent = createAgent(llm);

    await agent.process('删库', message(), [deferredTool('probe_weather')]);

    const toolResult = llm.calls.at(-1)?.context.messages.find((entry) => entry.role === 'toolResult');
    expect(JSON.stringify(toolResult)).toContain('Unknown tool: delete_everything');
  });
});
