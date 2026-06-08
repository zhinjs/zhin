import { describe, it, expect, vi } from 'vitest';
import type { AgentTool, AIProvider } from '@zhin.js/ai';
import { runDeferredWorker } from '../../src/zhin-agent/tool-orchestration.js';
import type { ZhinAgentPrivate } from '../../src/zhin-agent/zhin-agent-private.js';
import { DeferredWorkerRunner } from '../../src/deferred-worker-runner.js';
import { ZhinAgentEventEmitter } from '../../src/zhin-agent/event-emitter.js';
import { DEFAULT_CONFIG } from '../../src/zhin-agent/config.js';

function makeTool(name: string): AgentTool {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    execute: async () => `ok:${name}`,
  };
}

function makeAgent(overrides: Partial<ZhinAgentPrivate> = {}): ZhinAgentPrivate {
  const readFile = makeTool('read_file');
  return {
    config: { ...DEFAULT_CONFIG, workerBaseTools: ['read_file'] } as Required<typeof DEFAULT_CONFIG>,
    provider: { name: 'mock', models: ['m'] } as AIProvider,
    deferredCatalog: [readFile],
    deferredWorkerRunner: new DeferredWorkerRunner(),
    modelRegistry: null,
    emitter: new ZhinAgentEventEmitter(),
    getDeferredResultSender: () => vi.fn(async () => {}),
    ...overrides,
  } as unknown as ZhinAgentPrivate;
}

describe('runDeferredWorker sync', () => {
  it('awaits worker and returns summary JSON for main agent loop', async () => {
    const sender = vi.fn(async () => {});
    const runSync = vi.spyOn(DeferredWorkerRunner.prototype, 'runSync').mockResolvedValue({
      summary: JSON.stringify({ status: 'ok', summary: 'done body' }),
      loadedToolNames: ['read_file'],
      iterations: 1,
      status: 'ok',
      toolCalls: [],
    });

    const readFile = makeTool('read_file');
    const agent = makeAgent({
      getDeferredResultSender: () => sender,
    });

    const context = {
      platform: 'sandbox',
      botId: 'b1',
      sceneId: 'g1',
      senderId: 'u1',
      scope: 'group',
    };

    const raw = await runDeferredWorker(agent, 'read memory file', 'read_file', context, [readFile]);
    const parsed = JSON.parse(raw) as { status: string; summary: string };
    expect(parsed.status).toBe('ok');
    expect(parsed.summary).toContain('done body');
    expect(sender).not.toHaveBeenCalled();

    runSync.mockRestore();
  });

  it('returns error JSON when worker throws', async () => {
    const runSync = vi.spyOn(DeferredWorkerRunner.prototype, 'runSync').mockRejectedValue(
      new Error('worker boom'),
    );

    const readFile = makeTool('read_file');
    const agent = makeAgent();
    const context = {
      platform: 'sandbox',
      botId: 'b1',
      sceneId: 'g1',
      senderId: 'u1',
      scope: 'group',
    };

    const raw = await runDeferredWorker(agent, 'read memory file', 'read_file', context, [readFile]);
    const parsed = JSON.parse(raw) as { status: string; error: string };
    expect(parsed.status).toBe('error');
    expect(parsed.error).toContain('worker boom');

    runSync.mockRestore();
  });
});
