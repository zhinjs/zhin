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

describe('runDeferredWorker async', () => {
  it('returns delegated immediately and delivers on finish', async () => {
    const sender = vi.fn(async () => {});
    const runSync = vi.spyOn(DeferredWorkerRunner.prototype, 'runSync').mockResolvedValue({
      summary: JSON.stringify({ status: 'ok', summary: 'done body' }),
      loadedToolNames: ['read_file'],
      iterations: 1,
      status: 'ok',
      toolCalls: [],
    });

    const readFile = makeTool('read_file');
    const agent = {
      config: { ...DEFAULT_CONFIG, workerBaseTools: ['read_file'] } as Required<typeof DEFAULT_CONFIG>,
      provider: { name: 'mock', models: ['m'] } as AIProvider,
      deferredCatalog: [readFile],
      deferredWorkerRunner: new DeferredWorkerRunner(),
      modelRegistry: null,
      emitter: new ZhinAgentEventEmitter(),
      getDeferredResultSender: () => sender,
    } as unknown as ZhinAgentPrivate;

    const context = {
      platform: 'sandbox',
      botId: 'b1',
      sceneId: 'g1',
      senderId: 'u1',
      scope: 'group',
    };

    const raw = await runDeferredWorker(agent, 'read memory file', 'read_file', context, [readFile]);
    const parsed = JSON.parse(raw) as { status: string; task_id: string };
    expect(parsed.status).toBe('delegated');
    expect(parsed.task_id).toBeTruthy();

    await vi.waitFor(() => {
      expect(sender).toHaveBeenCalledTimes(1);
    });

    runSync.mockRestore();
  });
});
