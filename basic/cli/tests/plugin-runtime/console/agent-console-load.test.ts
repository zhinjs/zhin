import { describe, expect, it } from 'vitest';
import { loadAgentConsoleModule } from '../../../src/plugin-runtime/console/agent-console.js';

const agentToken = { id: 'agent' } as never;
const importAgent = async () => ({ agentHostToken: agentToken });

describe('loadAgentConsoleModule', () => {
  it('returns null when the agent import fails', async () => {
    const result = await loadAgentConsoleModule(async () => { throw new Error('no agent'); });
    expect(result).toBeNull();
  });

  it('returns the agentHostToken on success', async () => {
    const result = await loadAgentConsoleModule(importAgent);
    expect(result).toEqual({ agentHostToken: agentToken });
  });
});
