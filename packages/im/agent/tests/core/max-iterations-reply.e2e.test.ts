/**
 * Reproduces the QQ incident: the model keeps calling exploration tools until
 * maxIterations, and the harness used to send the raw tool output as the reply.
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
import { EXHAUSTED_TURN_FALLBACK_REPLY } from '../../src/core/exhausted-turn-reply.js';
import { DEFAULT_ALWAYS_LOADED_TOOLS } from '../../src/tool-catalog/types.js';

/** Ordinary private chat scene default (ADR 0042 §7); the agent config leaves maxIterations at its stock value. */
const MAX_ITERATIONS = 10;
const RAW_TOOL_OUTPUT = 'File: commands/赞/[[who]]/helper.ts\n1 | export interface ZanClient {';
const SUMMARY = '我看了 dice 和赞命令的实现，还没改输出格式。要我继续吗？';

function probeTool(): Tool {
  return {
    name: 'probe_source',
    description: 'Read a source file',
    parameters: { type: 'object', properties: {} },
    execute: vi.fn(async () => RAW_TOOL_OUTPUT),
  };
}

function createAgent(llm: MockLlmApi): ZhinAgent {
  const provider = Object.assign(llm.provider, {
    listModels: vi.fn(async () => ['mock-model']),
  }) as unknown as AIProvider;
  return new ZhinAgent(
    provider,
    {
      persona: '测试助手',
      deferredTools: { alwaysLoadedTools: [...DEFAULT_ALWAYS_LOADED_TOOLS, 'probe_source'] },
    },
    undefined,
    llm.runtime,
  );
}

function replyText(output: Awaited<ReturnType<ZhinAgent['process']>>): string {
  return JSON.stringify(output);
}

describe('agent turn that exhausts maxIterations', () => {
  let agent: ZhinAgent | undefined;

  afterEach(() => {
    agent?.dispose();
    agent = undefined;
  });

  function toolsOnlyUntilDisabled(llm: MockLlmApi, onSummaryCall: () => ReturnType<typeof assistantTextReply>) {
    let callIndex = 0;
    llm.respondWith((context) => {
      if (!context.tools?.length) return onSummaryCall();
      callIndex += 1;
      return assistantToolCallReply([{ id: `call-${callIndex}`, name: 'probe_source', arguments: {} }]);
    });
  }

  it('sends a model-written summary instead of the raw tool dump', async () => {
    const llm = wireMockLlmApi();
    toolsOnlyUntilDisabled(llm, () => assistantTextReply(JSON.stringify({ segments: [{ type: 'text', data: { text: SUMMARY } }] })));
    agent = createAgent(llm);

    const output = await agent.process('让 dice 输出更友好', mockCommMessage({ adapter: 'test', endpoint: 'bot1', senderId: 'u1', scope: 'private', sceneId: 's1' }), [probeTool()]);

    const toolTurns = llm.calls.filter((call) => call.context.tools?.length);
    const summaryTurns = llm.calls.filter((call) => !call.context.tools?.length);
    expect(toolTurns).toHaveLength(MAX_ITERATIONS);
    expect(summaryTurns).toHaveLength(1);
    expect(replyText(output)).toContain(SUMMARY);
    expect(replyText(output)).not.toContain('ZanClient');
  });

  it('sends the fixed message when the summary call fails', async () => {
    const llm = wireMockLlmApi();
    toolsOnlyUntilDisabled(llm, () => {
      throw new Error('summary call failed');
    });
    agent = createAgent(llm);

    const output = await agent.process('让 dice 输出更友好', mockCommMessage({ adapter: 'test', endpoint: 'bot1', senderId: 'u1', scope: 'private', sceneId: 's1' }), [probeTool()]);

    expect(replyText(output)).toContain(EXHAUSTED_TURN_FALLBACK_REPLY);
    expect(replyText(output)).not.toContain('ZanClient');
  });
});
