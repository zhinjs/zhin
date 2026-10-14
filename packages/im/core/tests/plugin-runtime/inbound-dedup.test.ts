import { describe, expect, it } from 'vitest';
import { InboundDeduper } from '../../src/plugin-runtime/im/inbound-dedup.js';

const conv = (over: Record<string, unknown> = {}, endpointId = 'e1') => ({
  endpoint: { id: endpointId, adapter: 'qq' }, kind: 'group' as const, id: 'g1', ...over,
}) as never;

function setup() {
  let t = 1_000;
  const deduper = new InboundDeduper(() => t);
  return { deduper, advance: (ms: number) => { t += ms; } };
}

describe('InboundDeduper', () => {
  it('first wins across endpoints, others are duplicates', () => {
    const { deduper } = setup();
    expect(deduper.claim(conv(), 'u1', 'm1')).toBe('first');
    expect(deduper.claim(conv({}, 'e2'), 'u1', 'm1')).toBe('duplicate');
    expect(deduper.claim(conv({}, 'e3'), 'u1', 'm1')).toBe('duplicate');
  });

  it('same endpoint repeat is same_endpoint and does not replace the winner', () => {
    const { deduper } = setup();
    deduper.claim(conv(), 'u1', 'm1');
    expect(deduper.claim(conv(), 'u1', 'm1')).toBe('same_endpoint');
    expect(deduper.claim(conv({}, 'e2'), 'u1', 'm1')).toBe('duplicate');
  });

  it('does not merge different id, sender, group, adapter, thread or channel kind', () => {
    const { deduper } = setup();
    deduper.claim(conv(), 'u1', 'm1');
    expect(deduper.claim(conv({}, 'e2'), 'u1', 'm2')).toBe('first');
    expect(deduper.claim(conv({}, 'e2'), 'u2', 'm1')).toBe('first');
    expect(deduper.claim(conv({ id: 'g2' }, 'e2'), 'u1', 'm1')).toBe('first');
    expect(deduper.claim(conv({ endpoint: { id: 'e2', adapter: 'discord' } }), 'u1', 'm1')).toBe('first');
    expect(deduper.claim(conv({ threadId: 't1' }, 'e2'), 'u1', 'm1')).toBe('first');
    expect(deduper.claim(conv({ kind: 'channel' }, 'e2'), 'u1', 'm1')).toBe('first');
  });

  it('is unkeyed for private chats and missing sender or id', () => {
    const { deduper } = setup();
    expect(deduper.claim(conv({ kind: 'private' }), 'u1', 'm1')).toBe('unkeyed');
    expect(deduper.claim(conv({ kind: 'private' }, 'e2'), 'u1', 'm1')).toBe('unkeyed');
    expect(deduper.claim(conv(), '', 'm1')).toBe('unkeyed');
    expect(deduper.claim(conv(), 'u1', undefined)).toBe('unkeyed');
    expect(deduper.claim(conv(), 'u1', '')).toBe('unkeyed');
    expect(deduper.claim(conv(), 'u1', { id: 1 })).toBe('unkeyed');
    expect(deduper.size).toBe(0);
  });

  it('treats numeric and string ids as equal', () => {
    const { deduper } = setup();
    expect(deduper.claim(conv(), 'u1', 42)).toBe('first');
    expect(deduper.claim(conv({}, 'e2'), 'u1', '42')).toBe('duplicate');
  });

  it('expires entries after the TTL', () => {
    const { deduper, advance } = setup();
    deduper.claim(conv(), 'u1', 'm1');
    advance(59_000);
    expect(deduper.claim(conv({}, 'e2'), 'u1', 'm1')).toBe('duplicate');
    advance(61_000);
    expect(deduper.claim(conv({}, 'e2'), 'u1', 'm1')).toBe('first');
  });

  it('bounds the map by evicting the oldest entries', () => {
    const { deduper } = setup();
    for (let i = 0; i < 2100; i++) deduper.claim(conv(), 'u1', `m${i}`);
    expect(deduper.size).toBe(2000);
    expect(deduper.claim(conv({}, 'e2'), 'u1', 'm0')).toBe('first');
    expect(deduper.claim(conv({}, 'e2'), 'u1', 'm2099')).toBe('duplicate');
  });
});
