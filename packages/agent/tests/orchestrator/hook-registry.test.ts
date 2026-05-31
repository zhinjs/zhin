import { describe, it, expect } from 'vitest';
import { Plugin, storage } from '@zhin.js/core';
import { HookRegistry, createAIHookEvent } from '../../src/orchestrator/index.js';

describe('HookRegistry ai.hook bus bridge', () => {
  it('bridges orchestrator hooks to plugin ai.hook bus', async () => {
    const hostPlugin = new Plugin('/virtual/host-plugin.ts');
    const payloads: any[] = [];
    hostPlugin.on('ai.hook', payload => payloads.push(payload));

    await storage.run(hostPlugin, async () => {
      const registry = new HookRegistry();
      await registry.trigger(createAIHookEvent('tool', 'call', 'test:scene1:user1', {
        platform: 'mock',
        senderId: 'user1',
        sceneId: 'scene1',
        toolName: 'read_file',
        args: { filePath: 'README.md' },
      }), 'worker-1');
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0].source).toBe('orchestrator-hook');
    expect(payloads[0].hookType).toBe('tool');
    expect(payloads[0].hookAction).toBe('call');
    expect(payloads[0].toolName).toBe('read_file');
    expect(payloads[0].agentId).toBe('worker-1');
  });

  it('bridges session compact hooks to stable ai.session.compact bus event', async () => {
    const hostPlugin = new Plugin('/virtual/host-plugin.ts');
    const payloads: any[] = [];
    hostPlugin.on('ai.session.compact', payload => payloads.push(payload));

    await storage.run(hostPlugin, async () => {
      const registry = new HookRegistry();
      await registry.trigger(createAIHookEvent('session', 'compact', 'test:scene1:user1', {
        platform: 'mock',
        senderId: 'user1',
        sceneId: 'scene1',
        compactedCount: 1,
        savedTokens: 48,
        totalTokensBefore: 300,
        totalTokensAfter: 252,
      }), 'worker-1');
    });

    expect(payloads).toHaveLength(1);
    expect(payloads[0].source).toBe('orchestrator-hook');
    expect(payloads[0].compactedCount).toBe(1);
    expect(payloads[0].savedTokens).toBe(48);
  });
});