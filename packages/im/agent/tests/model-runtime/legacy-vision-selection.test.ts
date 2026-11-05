import { ZhinAgent } from '../../src/zhin-agent/index.js';
import { asPrivate } from '../../src/internal/as-private.js';
import { collectAgentLoopTurnRun, runAgentLoopVisionTurnRun } from '../../src/core/agent-core-run.js';
import { runWithAgentTurnConfiguration } from '../../src/turn/agent-turn-context.js';
import { modelRuntimeFixture } from '../helpers/model-runtime.js';

it('does not replace a fixed vision model with a candidate after a real completion failure', async () => {
  const failure = new Error('Primary vision request failed'), calls: string[] = [];
  const f = modelRuntimeFixture({ execution: { language: { generate: async ({ request }) => { calls.push(JSON.stringify(request)); throw failure; }, stream: async () => { throw failure; } } } });
  const agent = new ZhinAgent({ config: { outputSchema: false, providerResilience: { maxRetries: 0 } } });
  const models = await f.acquire();
  try {
    await runWithAgentTurnConfiguration({ models }, async () => {
      const result = await collectAgentLoopTurnRun(runAgentLoopVisionTurnRun({ host: asPrivate(agent), sessionId: 'vision-fixed-selection', visionSystemPrompt: '', userMessages: [], modelCandidates: ['text', 'other-model'] }));
      expect(result.reply).toContain(failure.message);
      expect(result.model).toBe('text');
    });
    expect(f.calls.factories).toBe(1);
  } finally { await models.release(); await agent.dispose(); }
});
