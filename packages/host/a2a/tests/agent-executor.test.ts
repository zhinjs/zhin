import { describe, expect, it, vi } from 'vitest';
import type { ExecutionEventBus, RequestContext } from '@a2a-js/sdk/server';
import type { AgentHostProtocolPort } from '@zhin.js/agent/runtime';
import { ZhinA2AExecutor } from '../src/agent-executor.js';
import { textPart, userTextMessage } from '../src/a2a-parts.js';

describe('ZhinA2AExecutor', () => {
  it('submits one fail-closed canonical A2A turn without a synthetic IM identity', async () => {
    let captured: Parameters<AgentHostProtocolPort['execute']>[1] | undefined;
    const protocol: AgentHostProtocolPort = {
      listBindings: () => [binding('planner')],
      execute: async (_name, request) => {
        captured = request;
        return {
          status: 'completed',
          output: [{ type: 'text', content: 'planned' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        };
      },
    };
    const bus = eventBus();
    await new ZhinA2AExecutor({ agentName: 'planner', protocol })
      .execute(requestContext('task-1', 'context-1', 'make a plan'), bus.value);

    expect(captured).toMatchObject({
      origin: { kind: 'a2a', taskId: 'task-1' },
      principal: { subjectId: 'a2a-client', roles: ['user'] },
      input: { text: 'make a plan' },
      session: { key: 'a2a:context-1' },
      policy: { permissions: ['user'], unattended: true },
      ports: {},
    });
    expect(captured?.origin.kind).not.toBe('im');
    expect(bus.finished).toHaveBeenCalledOnce();
  });

  it('propagates task cancellation to the canonical turn signal', async () => {
    let signal: AbortSignal | undefined;
    const protocol: AgentHostProtocolPort = {
      listBindings: () => [binding('planner')],
      execute: async (_name, request) => {
        signal = request.signal;
        await new Promise<void>((resolve) => request.signal.addEventListener('abort', () => resolve(), { once: true }));
        return {
          status: 'cancelled',
          reason: 'cancelled',
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        };
      },
    };
    const executor = new ZhinA2AExecutor({ agentName: 'planner', protocol });
    const executionBus = eventBus();
    const cancellationBus = eventBus();
    const running = executor.execute(
      requestContext('task-2', 'context-2', 'slow task'),
      executionBus.value,
    );
    await vi.waitFor(() => expect(signal).toBeDefined());
    await executor.cancelTask('task-2', cancellationBus.value);
    await running;

    expect(signal?.aborted).toBe(true);
    expect(cancellationBus.finished).toHaveBeenCalledOnce();
    expect(executionBus.finished).toHaveBeenCalledOnce();
  });
});

function binding(name: string) {
  return { name, providerAlias: 'provider', model: 'model', mcpServers: [] };
}

function requestContext(taskId: string, contextId: string, text: string): RequestContext {
  return {
    taskId,
    contextId,
    userMessage: userTextMessage(`message-${taskId}`, contextId, [textPart(text)]),
  } as RequestContext;
}

function eventBus() {
  const publish = vi.fn();
  const finished = vi.fn();
  return {
    publish,
    finished,
    value: { publish, finished } as unknown as ExecutionEventBus,
  };
}
