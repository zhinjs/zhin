import { describe, it, expect } from 'vitest';
import { PluginAILoopHookRegistry } from '../src/plugin-loop-hooks.js';

describe('PluginAILoopHookRegistry', () => {
  it('beforeToolCall can deny tool execution', async () => {
    const registry = new PluginAILoopHookRegistry();
    registry.onBeforeToolCall(() => ({ allowed: false, reason: 'blocked' }));
    const result = await registry.runBeforeToolCall({
      toolCall: { id: '1', name: 'bash', arguments: {} },
      sessionId: 's1',
    });
    expect(result?.allowed).toBe(false);
  });

  it('transformContext chains handlers', async () => {
    const registry = new PluginAILoopHookRegistry();
    registry.onTransformContext(async (messages) => messages.slice(-1));
    const out = await registry.runTransformContext(
      [
        { role: 'user', content: [{ type: 'text', text: 'a' }], timestamp: 1 },
        { role: 'user', content: [{ type: 'text', text: 'b' }], timestamp: 2 },
      ],
      { sessionId: 's1' },
    );
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe('user');
  });
});
