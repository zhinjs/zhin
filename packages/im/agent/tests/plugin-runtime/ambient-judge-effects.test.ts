/**
 * ADR 0066 D7 / P3: the Console sees the interjection judge that really runs — `purposeEffects.ambient`
 * (effective, or ignored because interjection never runs), `decisions.<task>` that are off, and the
 * judge chain of the ambient status (a decision judge is shown as the decision model, acceptance 6).
 */
import { ModelAvailabilityRegistry } from '@zhin.js/ai';
import { normalizeProviderGraph } from '@zhin.js/ai/provider';
import { ambientPurposeEffects } from '../../src/plugin-runtime/inference/management.js';
import { ambientJudgeStatusView } from '../../src/plugin-runtime/inference/host.js';

const HOST = 'host:test';
const base = { rootId: 'root', ownerId: HOST, revision: 1 };
function graph(purposes: Record<string, unknown>) {
  const profile = (id: string, model: string) => ({ ...base, id, accountId: 'account', model, parameters: {} });
  return normalizeProviderGraph({ rootId: 'root', revision: 1,
    services: { service: { ...base, id: 'service', label: '主站', driver: { id: 'fixture', owner: 'root/providers', contractVersion: '1' }, options: {}, models: {
      text: { id: 'text', kinds: ['language'], protocol: 'fixture' }, jev: { id: 'jev', kinds: ['decision'], protocol: 'native' } } } },
    accounts: { account: { ...base, id: 'account', serviceId: 'service', incarnation: 'a', authentication: { method: 'none' } } },
    profiles: { chat: profile('chat', 'text'), small: profile('small', 'text'), jev: profile('jev', 'jev') },
    purposes });
}

describe('purposeEffects.ambient and decisions.<task>', () => {
  const configured = { configured: true, conversations: 1 };

  it('lists the chain actually used, with kinds, and the compared model', () => {
    const effects = ambientPurposeEffects(graph({ defaults: { chat: 'chat' }, ambient: { profile: 'jev', fallbacks: ['small'], compare: 'chat' } }), configured);
    expect(effects.ambient).toEqual({ status: 'effective', chain: [{ profile: 'jev', kind: 'decision' }, { profile: 'small', kind: 'language' }], compare: { profile: 'chat', kind: 'language' } });
  });

  it('marks a chain that follows chat as inherited', () => {
    expect(ambientPurposeEffects(graph({ defaults: { chat: 'chat' } }), configured).ambient)
      .toEqual({ status: 'effective', chain: [{ profile: 'chat', kind: 'language' }], inheritedFrom: 'chat' });
  });

  it('is ignored when the configuration has no ai.trigger.ambient, or no group and no switch turns it on', () => {
    const value = graph({ defaults: { chat: 'chat' }, ambient: { profile: 'jev' } });
    expect(ambientPurposeEffects(value, { configured: false, conversations: 0 }).ambient).toMatchObject({ status: 'ignored', reason: 'ambient-not-configured' });
    expect(ambientPurposeEffects(value, { configured: true, conversations: 0, switchesOn: false }).ambient).toMatchObject({ status: 'ignored', reason: 'no-conversations' });
    // A feature switch turns it on somewhere, or that is unknown: effective.
    expect(ambientPurposeEffects(value, { configured: true, conversations: 0, switchesOn: true }).ambient).toMatchObject({ status: 'effective' });
    expect(ambientPurposeEffects(value, { configured: true, conversations: 0 }).ambient).toMatchObject({ status: 'effective' });
  });

  it('marks a decision purpose that is off', () => {
    const effects = ambientPurposeEffects(graph({ defaults: { chat: 'chat' }, decisions: { tools: { profile: 'jev', mode: 'off' }, skills: { profile: 'jev', mode: 'active' } } }), configured);
    expect(effects['decisions.tools']).toEqual({ status: 'ignored', reason: 'mode-off' });
    expect(effects['decisions.skills']).toEqual({ status: 'effective' });
  });

  it('shows a legacy active decision as the decision model, never the uncalled language model alone (acceptance 6)', () => {
    const legacy = graph({ defaults: { chat: 'chat', ambient: 'small' }, decisions: { ambient: { profile: 'jev', mode: 'active' } } });
    expect(ambientPurposeEffects(legacy, configured).ambient).toMatchObject({ chain: [{ profile: 'jev', kind: 'decision' }, { profile: 'small', kind: 'language' }] });
    expect(ambientPurposeEffects(legacy, configured)).not.toHaveProperty(['decisions.ambient']);
  });
});

describe('ambient status judge chain', () => {
  it('returns the decision model first when it judges, its skip period, the compared model and the policy mode', () => {
    const registry = new ModelAvailabilityRegistry();
    registry.markUnavailable({ accountId: 'account', model: 'jev', reason: 'quota_exhausted', until: Date.now() + 60_000 });
    const view = ambientJudgeStatusView(graph({ defaults: { chat: 'chat' }, ambient: { profile: 'jev', fallbacks: ['small'], compare: 'chat', mode: 'shadow', minConfidence: 0.8 } }), undefined, registry);
    expect(view).toMatchObject({ mode: 'shadow', minConfidence: 0.8,
      chain: [{ profile: 'jev', kind: 'decision', role: 'primary', label: '主站/jev', skipReason: 'quota_exhausted' }, { profile: 'small', kind: 'language', role: 'fallback' }],
      compare: { profile: 'chat', role: 'compare' } });
    expect(view.chain[1]).not.toHaveProperty('skippedUntil');
  });
});
