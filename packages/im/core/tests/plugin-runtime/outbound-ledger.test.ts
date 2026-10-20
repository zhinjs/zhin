import { describe, expect, it } from 'vitest';
import { OutboundLedger, ledgerScopeOf } from '../../src/plugin-runtime/im/outbound-ledger.js';

const conv = (endpointId = 'e1') => ({
  endpoint: { id: endpointId, adapter: 'qq' }, kind: 'group' as const, id: 'g1',
});
const sent = (id?: string) => ({ status: 'sent' as const, message: { conversation: conv(), id: id as string } });

describe('OutboundLedger', () => {
  it('scope ignores endpoint id', () => {
    expect(ledgerScopeOf(conv('a'))).toBe(ledgerScopeOf(conv('b')));
  });

  it('bounds capacity', () => {
    const ledger = new OutboundLedger();
    for (let i = 0; i < 2100; i++) ledger.record(conv(), sent(`m${i}`), 'hello world');
    expect(ledger.size).toBe(2000);
    expect(ledger.matchById(ledgerScopeOf(conv()), 'm0')).toBeUndefined();
    expect(ledger.matchById(ledgerScopeOf(conv()), 'm2099')).toEqual({ endpointId: 'e1' });
  });

  it('expires entries after the ttl', () => {
    let now = 1000;
    const ledger = new OutboundLedger(() => now);
    ledger.record(conv(), sent('m1'), 'hello world');
    now += 11 * 60_000;
    expect(ledger.matchById(ledgerScopeOf(conv()), 'm1')).toBeUndefined();
    ledger.record(conv(), sent('m2'), 'hello world');
    expect(ledger.size).toBe(1);
  });

  it('does not record digest for image-only or short text', () => {
    const ledger = new OutboundLedger();
    ledger.record(conv(), sent('m1'), [{ type: 'image', data: { url: 'x' } }]);
    ledger.record(conv(), sent('m2'), 'abc');
    expect(ledger.matchByDigest(ledgerScopeOf(conv()), 'abc')).toBeUndefined();
    expect(ledger.matchById(ledgerScopeOf(conv()), 'm1')).toEqual({ endpointId: 'e1' });
  });

  it('ignores non-sent receipts', () => {
    const ledger = new OutboundLedger();
    ledger.record(conv(), { status: 'failed' } as never, 'hello world');
    ledger.record(conv(), { status: 'suppressed' } as never, 'hello world');
    expect(ledger.size).toBe(0);
  });

  it('digest match is one-shot, whitespace-normalized and windowed', () => {
    const now = 0;
    const ledger = new OutboundLedger(() => now);
    const scope = ledgerScopeOf(conv());
    ledger.record(conv(), sent('m1'), [{ type: 'text', data: { text: 'hello   world' } }]);
    expect(ledger.matchByDigest(scope, ' hello world ', 1000)).toEqual({ endpointId: 'e1' });
    expect(ledger.matchByDigest(scope, 'hello world', 1000)).toBeUndefined();
    ledger.record(conv(), sent('m2'), 'second message');
    expect(ledger.matchByDigest(scope, 'second message', 31_000)).toBeUndefined();
  });
});
