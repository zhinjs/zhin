import { describe, expect, it } from 'vitest';
import { createPeerRegistry } from '@zhin.js/adapter';
import { createInboundOriginClassifier, MESSAGE_ORIGINS } from '../../src/plugin-runtime/im/inbound-origin.js';
import { OutboundLedger } from '../../src/plugin-runtime/im/outbound-ledger.js';

const conv = (endpointId = 'e1') => ({
  endpoint: { id: endpointId, adapter: 'qq' }, kind: 'group' as const, id: 'g1',
});

function setup() {
  const registry = createPeerRegistry();
  const ledger = new OutboundLedger();
  const classifier = createInboundOriginClassifier({ registry, ledger });
  return { registry, ledger, classifier };
}

describe('inbound origin classifier', () => {
  it('exposes the origin vocabulary', () => {
    expect(MESSAGE_ORIGINS).toEqual(['self', 'member', 'peer_bot', 'human']);
  });

  it('self via selfOf, peer_bot via registry, member via membership, declared peer_bot, otherwise human', () => {
    const { registry, classifier } = setup();
    registry.registerEndpoint({}, { endpointId: 'e1' as never, adapter: 'qq', selfUserId: '100' });
    registry.registerEndpoint({}, { endpointId: 'e2' as never, adapter: 'qq', selfUserId: '200' });
    registry.declareExternal('qq', '300');
    expect(classifier.classify({ conversation: conv(), sender: { id: '100' } })).toMatchObject({ origin: 'self', basis: 'registry', ready: true });
    expect(classifier.classify({ conversation: conv(), sender: { id: '200' } }).origin).toBe('peer_bot');
    expect(classifier.classify({ conversation: conv(), sender: { id: '300' } }).origin).toBe('peer_bot');
    expect(classifier.classify({ conversation: conv(), sender: { id: '200' } }, { isMember: () => true }).origin).toBe('member');
    expect(classifier.classify({ conversation: conv(), sender: { id: '999' } })).toMatchObject({ origin: 'human', basis: 'none' });
  });

  it('reports ready=false for endpoints without a registered account and treats them as human', () => {
    const { classifier } = setup();
    expect(classifier.classify({ conversation: conv(), sender: { id: '1' } })).toMatchObject({ origin: 'human', ready: false });
  });

  it('does not throw on empty or non-string sender ids', () => {
    const { classifier } = setup();
    for (const id of [undefined, '', '  ', null, {}, 12, NaN]) {
      expect(() => classifier.classify({ conversation: conv(), sender: { id } })).not.toThrow();
    }
    expect(classifier.classify({ conversation: conv() }).origin).toBe('human');
  });

  it('fails closed to peer_bot when registry or membership throws', () => {
    const { ledger } = setup();
    const boom = () => { throw new Error('boom'); };
    const bad = createInboundOriginClassifier({ registry: { lookup: boom, isReady: boom, selfOf: boom } as never, ledger });
    expect(bad.classify({ conversation: conv(), sender: { id: '1' } })).toMatchObject({ origin: 'peer_bot', basis: 'error' });
    const { registry, classifier } = setup();
    registry.declareExternal('qq', '300');
    expect(classifier.classify({ conversation: conv(), sender: { id: '300' } }, { isMember: boom })).toMatchObject({ origin: 'peer_bot', basis: 'error' });
  });

  it('detects echoes by message id when the account does not match (multi-device)', () => {
    const { registry, ledger, classifier } = setup();
    registry.registerEndpoint({}, { endpointId: 'e1' as never, adapter: 'qq', selfUserId: '100' });
    ledger.record(conv(), { status: 'sent', message: { conversation: conv(), id: 'm1' } }, 'hello world');
    expect(classifier.classify({ conversation: conv(), sender: { id: 'other-device' }, messageId: 'm1' })).toMatchObject({ origin: 'self', basis: 'ledger' });
    expect(classifier.classify({ conversation: conv('e2'), sender: { id: 'x' }, messageId: 'm1' }).origin).toBe('peer_bot');
    expect(classifier.classify({ conversation: conv('e2'), sender: { id: 'x' }, messageId: 'm1' }, { isMember: () => true }).origin).toBe('member');
    expect(classifier.classify({ conversation: conv(), messageId: 'm1' }).origin).toBe('self');
  });

  it('digest fallback is one-shot and requires at least 4 characters', () => {
    const { ledger, classifier } = setup();
    ledger.record(conv(), { status: 'sent', message: { conversation: conv(), id: 'm1' } }, 'hello world');
    expect(classifier.classify({ conversation: conv(), sender: { id: 'x' }, content: 'hello world' })).toMatchObject({ origin: 'self', basis: 'ledger' });
    expect(classifier.classify({ conversation: conv(), sender: { id: 'x' }, content: 'hello world' }).origin).toBe('human');
    ledger.record(conv(), { status: 'sent', message: { conversation: conv(), id: 'm2' } }, 'ok');
    expect(classifier.classify({ conversation: conv(), sender: { id: 'x' }, content: 'ok' }).origin).toBe('human');
  });

  it('shares scope across endpoints of the same group', () => {
    const { ledger, classifier } = setup();
    ledger.record(conv('e1'), { status: 'sent', message: { conversation: conv('e1'), id: 'm1' } }, 'from bot one');
    expect(classifier.classify({ conversation: conv('e2'), sender: { id: 'x' }, content: 'from bot one' }).origin).toBe('peer_bot');
  });
});
