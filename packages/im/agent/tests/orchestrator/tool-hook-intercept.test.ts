import { describe, it, expect, vi } from 'vitest';
import { HookRegistry } from '../../src/orchestrator/index.js';
import type {
  PreToolUseEvent,
  PostToolUseEvent,
  ToolHookDecision,
  PostToolHookDecision,
} from '../../src/orchestrator/types.js';

function makePreEvent(overrides: Partial<PreToolUseEvent> = {}): PreToolUseEvent {
  return {
    type: 'preToolUse',
    toolName: 'bash',
    toolInput: { command: 'ls' },
    sessionId: 'test-session',
    ...overrides,
  };
}

function makePostEvent(overrides: Partial<PostToolUseEvent> = {}): PostToolUseEvent {
  return {
    type: 'postToolUse',
    toolName: 'bash',
    toolInput: { command: 'ls' },
    toolOutput: 'file.txt',
    durationMs: 42,
    sessionId: 'test-session',
    ...overrides,
  };
}

describe('HookRegistry PreToolUse interception', () => {
  it('defaults to allow when no hooks registered', async () => {
    const registry = new HookRegistry();
    const result = await registry.triggerPreToolUse(makePreEvent());
    expect(result).toEqual({ decision: 'allow' });
  });

  it('deny stops tool execution', async () => {
    const registry = new HookRegistry();
    registry.addPreToolUseHook({
      name: 'block-rm',
      type: 'preToolUse',
      priority: 0,
      handler: (event) => {
        if (String(event.toolInput.command).includes('rm')) {
          return { decision: 'deny', reason: 'dangerous command blocked' };
        }
        return { decision: 'skip' };
      },
    });

    const allowed = await registry.triggerPreToolUse(makePreEvent({ toolInput: { command: 'ls' } }));
    expect(allowed.decision).toBe('allow');

    const denied = await registry.triggerPreToolUse(makePreEvent({ toolInput: { command: 'rm -rf /' } }));
    expect(denied.decision).toBe('deny');
    if (denied.decision === 'deny') {
      expect(denied.reason).toBe('dangerous command blocked');
    }
  });

  it('modify rewrites tool input', async () => {
    const registry = new HookRegistry();
    registry.addPreToolUseHook({
      name: 'sanitize-path',
      type: 'preToolUse',
      priority: 0,
      handler: () => ({
        decision: 'modify',
        modifiedInput: { command: 'ls -la /safe/path' },
      }),
    });

    const result = await registry.triggerPreToolUse(makePreEvent());
    expect(result.decision).toBe('modify');
    if (result.decision === 'modify') {
      expect(result.modifiedInput.command).toBe('ls -la /safe/path');
    }
  });

  it('skip falls through to next hook', async () => {
    const registry = new HookRegistry();
    const order: string[] = [];

    registry.addPreToolUseHook({
      name: 'skipper',
      type: 'preToolUse',
      priority: 10,
      handler: () => { order.push('skipper'); return { decision: 'skip' }; },
    });
    registry.addPreToolUseHook({
      name: 'decider',
      type: 'preToolUse',
      priority: 5,
      handler: () => { order.push('decider'); return { decision: 'allow' }; },
    });

    const result = await registry.triggerPreToolUse(makePreEvent());
    expect(result.decision).toBe('allow');
    expect(order).toEqual(['skipper', 'decider']);
  });

  it('all skip → default allow', async () => {
    const registry = new HookRegistry();
    registry.addPreToolUseHook({
      name: 'skip1',
      type: 'preToolUse',
      priority: 10,
      handler: () => ({ decision: 'skip' }),
    });
    registry.addPreToolUseHook({
      name: 'skip2',
      type: 'preToolUse',
      priority: 5,
      handler: () => ({ decision: 'skip' }),
    });

    const result = await registry.triggerPreToolUse(makePreEvent());
    expect(result).toEqual({ decision: 'allow' });
  });

  it('higher priority hooks run first', async () => {
    const registry = new HookRegistry();
    const order: string[] = [];

    registry.addPreToolUseHook({
      name: 'low',
      type: 'preToolUse',
      priority: 0,
      handler: () => { order.push('low'); return { decision: 'skip' }; },
    });
    registry.addPreToolUseHook({
      name: 'high',
      type: 'preToolUse',
      priority: 100,
      handler: () => { order.push('high'); return { decision: 'skip' }; },
    });
    registry.addPreToolUseHook({
      name: 'mid',
      type: 'preToolUse',
      priority: 50,
      handler: () => { order.push('mid'); return { decision: 'skip' }; },
    });

    await registry.triggerPreToolUse(makePreEvent());
    expect(order).toEqual(['high', 'mid', 'low']);
  });

  it('hook error is swallowed and next hook runs', async () => {
    const registry = new HookRegistry();
    registry.addPreToolUseHook({
      name: 'broken',
      type: 'preToolUse',
      priority: 10,
      handler: () => { throw new Error('boom'); },
    });
    registry.addPreToolUseHook({
      name: 'fallback',
      type: 'preToolUse',
      priority: 5,
      handler: () => ({ decision: 'deny', reason: 'fallback reached' }),
    });

    const result = await registry.triggerPreToolUse(makePreEvent());
    expect(result.decision).toBe('deny');
  });

  it('unregister removes hook', async () => {
    const registry = new HookRegistry();
    const dispose = registry.addPreToolUseHook({
      name: 'blocker',
      type: 'preToolUse',
      priority: 0,
      handler: () => ({ decision: 'deny', reason: 'blocked' }),
    });

    let result = await registry.triggerPreToolUse(makePreEvent());
    expect(result.decision).toBe('deny');

    dispose();
    result = await registry.triggerPreToolUse(makePreEvent());
    expect(result.decision).toBe('allow');
  });
});

describe('HookRegistry PostToolUse interception', () => {
  it('defaults to accept when no hooks registered', async () => {
    const registry = new HookRegistry();
    const result = await registry.triggerPostToolUse(makePostEvent());
    expect(result).toEqual({ decision: 'accept' });
  });

  it('reject replaces output with error', async () => {
    const registry = new HookRegistry();
    registry.addPostToolUseHook({
      name: 'output-guard',
      type: 'postToolUse',
      priority: 0,
      handler: (event) => {
        if (String(event.toolOutput).includes('secret')) {
          return { decision: 'reject', reason: 'output contains sensitive data' };
        }
        return { decision: 'accept' };
      },
    });

    const safe = await registry.triggerPostToolUse(makePostEvent({ toolOutput: 'hello' }));
    expect(safe.decision).toBe('accept');

    const blocked = await registry.triggerPostToolUse(makePostEvent({ toolOutput: 'secret-key-123' }));
    expect(blocked.decision).toBe('reject');
  });

  it('modify rewrites output', async () => {
    const registry = new HookRegistry();
    registry.addPostToolUseHook({
      name: 'redact',
      type: 'postToolUse',
      priority: 0,
      handler: () => ({
        decision: 'modify',
        modifiedOutput: '[REDACTED]',
      }),
    });

    const result = await registry.triggerPostToolUse(makePostEvent());
    expect(result.decision).toBe('modify');
    if (result.decision === 'modify') {
      expect(result.modifiedOutput).toBe('[REDACTED]');
    }
  });

  it('dispose clears all tool hooks', async () => {
    const registry = new HookRegistry();
    registry.addPreToolUseHook({
      name: 'a',
      type: 'preToolUse',
      priority: 0,
      handler: () => ({ decision: 'deny', reason: 'blocked' }),
    });
    registry.addPostToolUseHook({
      name: 'b',
      type: 'postToolUse',
      priority: 0,
      handler: () => ({ decision: 'reject', reason: 'rejected' }),
    });

    registry.dispose();

    const pre = await registry.triggerPreToolUse(makePreEvent());
    expect(pre.decision).toBe('allow');
    const post = await registry.triggerPostToolUse(makePostEvent());
    expect(post.decision).toBe('accept');
  });
});
