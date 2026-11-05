import { ZhinAgent } from '../../src/zhin-agent/index.js';
import { runWithAgentTurnConfiguration } from '../../src/turn/agent-turn-context.js';
import { modelRuntimeFixture } from '../helpers/model-runtime.js';

it('rejects unresolved unscoped inference while a turn uses only its actual borrowed scope', async () => {
  const agent = new ZhinAgent({ config: { outputSchema: false } }), f = modelRuntimeFixture(), models = await f.acquire();
  try {
    expect(() => agent.getTurnExecution()).toThrow('not configured');
    await runWithAgentTurnConfiguration({ models }, async () => { expect(agent.getTurnExecution()).toBe(models.chat); });
    expect(() => agent.getTurnExecution()).toThrow('not configured');
  } finally { await models.release(); await agent.dispose(); }
});
