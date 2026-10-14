import { describe, expect, it, vi } from 'vitest';
import { loadAgentConsoleModule } from '../../../src/plugin-runtime/console/agent-console.js';

const agentToken = { id: 'agent' } as never;
const workroomToken = { id: 'workroom' } as never;
const importAgent = async () => ({ agentHostToken: agentToken });

describe('loadAgentConsoleModule', () => {
  it('degrades silently when the workroom package is missing', async () => {
    const onWarn = vi.fn();
    const missing = Object.assign(new Error("Cannot find package '@zhin.js/workroom' imported from x"), {
      code: 'ERR_MODULE_NOT_FOUND',
    });
    const result = await loadAgentConsoleModule(importAgent, async () => { throw missing; }, onWarn);
    expect(result).toEqual({ agentHostToken: agentToken });
    expect(onWarn).not.toHaveBeenCalled();
  });

  it('warns and degrades on other workroom load errors', async () => {
    const onWarn = vi.fn();
    const result = await loadAgentConsoleModule(importAgent, async () => { throw new Error('boom'); }, onWarn);
    expect(result).toEqual({ agentHostToken: agentToken });
    expect(onWarn).toHaveBeenCalledTimes(1);
    expect(onWarn.mock.calls[0]![0]).toContain('boom');
  });

  it('returns null when the agent import fails', async () => {
    const importWorkroom = vi.fn();
    const result = await loadAgentConsoleModule(async () => { throw new Error('no agent'); }, importWorkroom, vi.fn());
    expect(result).toBeNull();
  });

  it('returns both tokens on success', async () => {
    const result = await loadAgentConsoleModule(importAgent, async () => ({ workroomHostToken: workroomToken }), vi.fn());
    expect(result).toEqual({ agentHostToken: agentToken, workroomHostToken: workroomToken });
  });
});
