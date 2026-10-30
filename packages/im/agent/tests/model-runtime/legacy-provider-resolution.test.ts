import { ZhinAgent } from '../../src/zhin-agent/index.js';
import { ModelRuntimeService } from '../../src/model-runtime/service.js';
import { runWithAgentTurnConfiguration } from '../../src/turn/agent-turn-context.js';
import { createProviderHarness } from '../../../ai/tests/helpers/provider-harness/index.js';

it('rejects an unresolved unscoped provider while scoped turns use only their leased provider', async () => {
  const legacy = createProviderHarness({ sdk: 'anthropic' });
  const original = legacy.adapter();
  const agent = new ZhinAgent(original, { outputSchema: false }, undefined, legacy.runtime);
  agent.activeBinding = { name: 'zhin', providerAlias: 'missing', model: 'missing-model', mcpServers: [] };
  agent.providerResolver = vi.fn(() => { throw new Error('Legacy binding no longer resolves'); });
  const runtime = new ModelRuntimeService({ hostOwnerId: 'host', config: {
    providers: { scoped: { sdk: 'ollama', models: ['scoped-model'] } },
    agents: { zhin: { provider: 'scoped', model: 'scoped-model' } },
  } });
  const models = await runtime.acquireForTurn({ rootId: '/host', ownerId: 'host' });
  try {
    expect(() => agent.getTurnProvider()).toThrow('Legacy binding no longer resolves');
    expect(agent.providerResolver).toHaveBeenCalledOnce();
    await runWithAgentTurnConfiguration({ models }, async () => {
      expect(agent.getTurnProvider()).toBe(models.chat.provider);
      expect(agent.getTurnProvider()).not.toBe(original);
      expect(agent.providerResolver).toHaveBeenCalledOnce();
    });
    expect(() => agent.getTurnProvider()).toThrow('Legacy binding no longer resolves');
  } finally {
    await models.release(); await runtime.dispose(); await agent.dispose();
  }
});
