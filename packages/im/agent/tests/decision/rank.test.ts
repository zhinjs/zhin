import type { DecisionProvider, DecisionQuestions, DecisionRequest, DecisionResult } from '@zhin.js/ai';
import { rankDecisionCandidates } from '../../src/decision/rank.js';
import type { AgentDecisionRuntime, DecisionObservation } from '../../src/decision/types.js';

function provider(score: (name: string) => readonly [number, number]): DecisionProvider {
  return {
    async evaluate<Q extends DecisionQuestions>(request: DecisionRequest<Q>): Promise<DecisionResult<Q>> {
      const state = request.state as { candidates: Record<string, { name: string }> };
      return {
        model: 'jev-fixed',
        answers: Object.fromEntries(Object.keys(request.questions).map(key => {
          const [value, confidence] = score(state.candidates[key]!.name);
          return [key, { type: 'score', score: value, confidence, legend: {}, probabilities: {} }];
        })),
        usage: { inputTokens: 2, outputTokens: 1 },
      } as DecisionResult<Q>;
    },
  };
}

describe('decision candidate ranking', () => {
  const candidates = ['unrelated', 'different words', 'useful'].map(name => ({ name, description: name }));
  const signal = () => new AbortController().signal;

  it('scores the complete eligible directory in bounded batches, without keyword truncation', async () => {
    const observations: DecisionObservation[] = [];
    const evaluate = vi.spyOn(provider(name => name === 'useful' ? [0.95, 0.9] : [0.1, 0.9]), 'evaluate');
    const runtime: AgentDecisionRuntime = { provider: { evaluate },
      config: { provider: 'root/typesafe', skills: { mode: 'active', maxCandidates: 1, topK: 1 } },
      observe: event => observations.push(event) };
    const ranked = await rankDecisionCandidates(runtime, 'skills', '禁言', candidates, signal());
    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(ranked).toMatchObject({ applied: true, selectedNames: ['useful'] });
    expect(observations).toEqual([expect.objectContaining({ candidates: 3, selected: 1,
      usage: { inputTokens: 6, outputTokens: 3, totalTokens: 9 } })]);
    expect(JSON.stringify(observations)).not.toContain('禁言');
    expect(JSON.stringify(observations)).not.toContain('useful');
  });

  it('keeps shadow recommendations observational and active low confidence as explicit abstention', async () => {
    const runtime: AgentDecisionRuntime = { provider: provider(() => [0.9, 0.2]),
      config: { provider: 'root/typesafe', skills: { mode: 'active' } } };
    expect(await rankDecisionCandidates(runtime, 'skills', 'request', candidates, signal()))
      .toMatchObject({ applied: true, outcome: 'abstained', selectedNames: [] });
    expect(await rankDecisionCandidates({ ...runtime, provider: provider(() => [0.9, 0.9]),
      config: { provider: 'root/typesafe', skills: { mode: 'shadow' } } }, 'skills', 'request', candidates, signal()))
      .toMatchObject({ applied: false, outcome: 'shadow', selectedNames: candidates.map(candidate => candidate.name) });
  });

  it('does not call a provider for an off policy, and does not expose provider errors', async () => {
    const evaluate = vi.fn().mockRejectedValue(new Error('SECRET api key and message'));
    const observations: DecisionObservation[] = [];
    const runtime: AgentDecisionRuntime = { provider: { evaluate },
      config: { provider: 'root/typesafe', tools: { mode: 'off' } }, observe: event => observations.push(event) };
    await rankDecisionCandidates(runtime, 'tools', 'request', candidates, signal());
    expect(evaluate).not.toHaveBeenCalled();
    const ranked = await rankDecisionCandidates({ ...runtime,
      config: { provider: 'root/typesafe', tools: { mode: 'active' } } }, 'tools', 'request', candidates, signal());
    expect(ranked).toMatchObject({ applied: false, outcome: 'failed' });
    expect(observations[0]?.reason).toBe('provider_error');
    expect(JSON.stringify(observations)).not.toContain('SECRET');
  });

  it('bounds an uncooperative provider and propagates caller cancellation without fallback', async () => {
    const observations: DecisionObservation[] = [];
    const runtime: AgentDecisionRuntime = { provider: { evaluate: () => new Promise(() => undefined) },
      config: { provider: 'root/typesafe', skills: { mode: 'active', timeoutMs: 10 } },
      observe: event => observations.push(event) };
    expect(await rankDecisionCandidates(runtime, 'skills', 'request', candidates, signal()))
      .toMatchObject({ applied: false, outcome: 'failed' });
    expect(observations[0]?.reason).toBe('timeout');
    const controller = new AbortController();
    const pending = rankDecisionCandidates(runtime, 'skills', 'request', candidates, controller.signal);
    const rejection = expect(pending).rejects.toThrow('turn superseded');
    controller.abort(new Error('turn superseded'));
    await rejection;
    expect(observations).toHaveLength(1);
  });

  it('rejects an invalid batch entirely and isolates diagnostic failures', async () => {
    const runtime: AgentDecisionRuntime = { provider: provider(() => [Number.NaN, 0.9]),
      config: { provider: 'root/typesafe', tools: { mode: 'active' } } };
    expect(await rankDecisionCandidates(runtime, 'tools', 'request', candidates, signal()))
      .toMatchObject({ applied: false, outcome: 'failed' });
    expect(await rankDecisionCandidates({ ...runtime, provider: provider(() => [0.9, 0.9]),
      observe: () => { throw new Error('journal unavailable'); } }, 'tools', 'request', candidates, signal()))
      .toMatchObject({ applied: true, outcome: 'selected' });
  });
});
