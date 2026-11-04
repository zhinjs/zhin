import { describe, expect, it } from 'vitest';
import {
  getAgentTurnConfiguration,
  runWithAgentTurnConfiguration,
} from '../../src/turn/agent-turn-context.js';

describe('AgentTurn configuration', () => {
  it('isolates concurrent turn routing state', async () => {
    const [first, second] = await Promise.all([
      runWithAgentTurnConfiguration({
        activeBinding: { name: 'first' } as never,
        bootstrapContext: 'first bootstrap',
      }, async () => {
        await Promise.resolve();
        return getAgentTurnConfiguration();
      }),
      runWithAgentTurnConfiguration({
        activeBinding: { name: 'second' } as never,
        bootstrapContext: 'second bootstrap',
      }, async () => {
        await Promise.resolve();
        return getAgentTurnConfiguration();
      }),
    ]);

    expect(first).toMatchObject({ activeBinding: { name: 'first' }, bootstrapContext: 'first bootstrap' });
    expect(second).toMatchObject({ activeBinding: { name: 'second' }, bootstrapContext: 'second bootstrap' });
    expect(getAgentTurnConfiguration()).toBeUndefined();
  });
  it('captures binding authority before external mutation', async () => {
    const binding = { name: 'zhin', providerAlias: 'host', model: 'original', mcpServers: ['original'],
      permission: { task: { worker: 'allow' as const } } };
    await runWithAgentTurnConfiguration({ activeBinding: binding }, async () => {
      binding.mcpServers.push('new-server');
      binding.model = 'mutated';
      expect(getAgentTurnConfiguration()?.activeBinding).toMatchObject({ model: 'original', mcpServers: ['original'] });
      expect(Object.isFrozen(getAgentTurnConfiguration()?.activeBinding?.permission?.task)).toBe(true);
    });
  });

});
