import { ZhinAgent } from '../../src/zhin-agent/index.js';
import { asPrivate } from '../../src/internal/as-private.js';
import { collectAgentLoopTurnRun, runAgentLoopVisionTurnRun } from '../../src/core/agent-core-run.js';
import { createProviderHarness } from '../../../ai/tests/helpers/provider-harness/index.js';

it('keeps the deprecated vision entry on its first explicit model when resolution fails', async () => {
  const harness = createProviderHarness({ sdk: 'anthropic', model: 'primary-model' });
  const agent = new ZhinAgent(harness.adapter(), { outputSchema: false }, undefined, harness.runtime);
  const failure = new Error('Primary vision model does not resolve');
  const resolve = vi.spyOn(harness.runtime, 'model').mockImplementation(() => { throw failure; });
  try {
    await expect(collectAgentLoopTurnRun(runAgentLoopVisionTurnRun({
      host: asPrivate(agent), sessionId: 'vision-fixed-selection', visionSystemPrompt: '',
      userMessages: [], modelCandidates: ['primary-model', 'other-model'],
    }))).rejects.toBe(failure);
    expect(resolve.mock.calls).toEqual([[harness.alias, 'primary-model']]);
    expect(harness.requests).toHaveLength(0);
  } finally { resolve.mockRestore(); await agent.dispose(); }
});
