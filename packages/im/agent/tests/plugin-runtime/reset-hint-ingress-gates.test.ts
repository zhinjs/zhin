import { describe, expect, it, vi } from 'vitest';
import { evaluateIngressGatesAndTrigger } from '../../src/plugin-runtime/ingress/ingress-venue-helpers.js';
import { ColdFieldMonitor } from '../../src/plugin-runtime/ingress/cold-field.js';
import { NO_DECISION_AUDIT } from '../../src/plugin-runtime/ingress/decision-audit.js';

/**
 * #1250 (ADR 0067 D8): the reset hint (`onUnmatched`) runs only after the control-plane gate and the
 * speaking gate passed, and only for a message no trigger matched.
 */
describe('reset hint placement in the ingress gates (#1250)', () => {
  const conversation = { endpoint: { adapter: 'root/sandbox', id: 'main' }, kind: 'private', id: 'user' } as const;

  function evaluate(options: {
    control?: { gate?: () => unknown; outboundGate?: () => unknown };
    blockedSpeak?: boolean;
    matched?: { content: string } | null;
    onUnmatched: (outboundBlocked: (stage: string) => boolean) => Promise<boolean>;
  }) {
    const sessions = options.blockedSpeak
      ? { observeInbound: vi.fn(async () => ({ blocked: 'muted' })) }
      : undefined;
    return evaluateIngressGatesAndTrigger({
      message: { conversation, content: '/clear', sender: { id: 'user' }, metadata: {} } as never,
      lease: {} as never,
      turnAccess: { origin: { kind: 'im', platform: 'sandbox', scope: 'private', sceneId: 'user' }, principal: { subjectId: 'user' } } as never,
      effectiveEndpoint: 'main',
      conversationSequence: 3,
      trigger: undefined,
      bindingNickname: 'bot',
      projectRoot: '/tmp/project',
      liveRoom: false,
      initialMatched: options.matched ?? null,
      initialSessionKey: 'session-key',
      im: { conversationEventReader: undefined } as never,
      agent: {
        agent: {
          getControlPlane: () => options.control,
          getUserProfiles: () => (sessions ? { sessions } : undefined),
        },
        service: { getTriggerConfig: () => undefined },
      } as never,
      assistantStatus: undefined,
      ambientEngagement: null,
      coldField: new ColdFieldMonitor({} as never),
      audit: NO_DECISION_AUDIT,
      withInference: async (_input, run) => run({} as never),
      onUnmatched: options.onUnmatched,
    });
  }

  const stopped = { blocked: true, switch: 'emergency_stop', level: 'instance', reasonCode: 'control_emergency_stop', outcome: 'deny' };

  it('answers an unmatched message once the gates passed and stops the ingress there', async () => {
    const onUnmatched = vi.fn(async () => true);
    expect(await evaluate({ onUnmatched })).toEqual({ kind: 'halt', handled: true });
    expect(onUnmatched).toHaveBeenCalledTimes(1);
  });

  it('is not consulted when the control plane stops the conversation', async () => {
    const onUnmatched = vi.fn(async () => true);
    const result = await evaluate({ control: { gate: () => stopped, outboundGate: () => stopped }, onUnmatched });
    expect(result).toEqual({ kind: 'halt', handled: false });
    expect(onUnmatched).not.toHaveBeenCalled();
  });

  it('is not consulted when the bot cannot speak here', async () => {
    const onUnmatched = vi.fn(async () => true);
    const result = await evaluate({ blockedSpeak: true, onUnmatched });
    expect(result).toEqual({ kind: 'halt', handled: false });
    expect(onUnmatched).not.toHaveBeenCalled();
  });

  it('is not consulted for a matched message, and falls through when it does not answer', async () => {
    const onUnmatched = vi.fn(async () => true);
    const matched = await evaluate({ matched: { content: 'hello' }, onUnmatched });
    expect(matched).toMatchObject({ kind: 'proceed', matched: { content: 'hello' } });
    expect(onUnmatched).not.toHaveBeenCalled();
    const silent = vi.fn(async () => false);
    expect(await evaluate({ onUnmatched: silent })).toEqual({ kind: 'halt', handled: false });
    expect(silent).toHaveBeenCalledTimes(1);
  });

  it('hands over the outbound stop of the control plane', async () => {
    let blocked: boolean | undefined;
    await evaluate({
      control: { gate: () => ({ blocked: false }), outboundGate: () => stopped },
      onUnmatched: async outboundBlocked => { blocked = outboundBlocked('reset_hint'); return false; },
    });
    expect(blocked).toBe(true);
  });
});
