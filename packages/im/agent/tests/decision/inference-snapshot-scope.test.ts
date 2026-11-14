import type { InferenceGraphSnapshot } from '@zhin.js/ai/provider';
import { getAgentTurnInferenceSnapshot, runWithAgentDecisionTurn } from '../../src/plugin-runtime/decision-runtime.js';

describe('turn-scoped inference snapshot (#1250)', () => {
  it('does not hand a chat turn capture to a turn started inside it (schedule_preview)', async () => {
    const captured = Object.freeze({}) as unknown as InferenceGraphSnapshot;
    expect(getAgentTurnInferenceSnapshot('chat')).toBeUndefined();
    await runWithAgentDecisionTurn({ turnId: 'chat', inferenceSnapshot: captured, disabled: true }, async () => {
      expect(getAgentTurnInferenceSnapshot('chat')).toBe(captured);
      expect(getAgentTurnInferenceSnapshot()).toBe(captured);
      // The nested preview turn has its own operation id and session: reusing the capture
      // made openScope refuse it as `AI provider: forbidden`.
      expect(getAgentTurnInferenceSnapshot('preview-turn')).toBeUndefined();
    });
  });
});
