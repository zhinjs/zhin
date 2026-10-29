import { describe, expect, it, vi } from 'vitest';
import { deliverReaction, ReactionPacer, resolveReactionPacing } from '../../../../src/plugin-runtime/agent/turn/reaction-pacer.js';

function seeded(values: number[]) {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe('resolveReactionPacing', () => {
  it('defaults and clamps', () => {
    expect(resolveReactionPacing()).toEqual({ cooldownMs: 600_000, probability: 0.35 });
    expect(resolveReactionPacing({ probability: 0 }).probability).toBe(0);
    expect(resolveReactionPacing({ probability: 7, cooldownMs: -1 })).toEqual({ cooldownMs: 600_000, probability: 1 });
    expect(resolveReactionPacing({ probability: Number.NaN }).probability).toBe(0.35);
  });
});

describe('ReactionPacer', () => {
  it('honours probability with a seeded RNG', () => {
    const pacer = new ReactionPacer({ random: seeded([0.1, 0.9, 0.34, 0.35]) });
    expect([pacer.allow('a'), pacer.allow('a'), pacer.allow('a'), pacer.allow('a')]).toEqual([true, false, true, false]);
  });

  it('enforces the cooldown after an applied reaction only', () => {
    let now = 1_000;
    const pacer = new ReactionPacer({ now: () => now, random: () => 0, config: () => ({ cooldownMs: 1000 }) });
    expect(pacer.allow('s')).toBe(true);
    expect(pacer.allow('s')).toBe(true); // nothing applied yet
    pacer.markApplied('s');
    now += 999;
    expect(pacer.allow('s')).toBe(false);
    now += 1;
    expect(pacer.allow('s')).toBe(true);
  });

  it('keeps sessions independent', () => {
    const pacer = new ReactionPacer({ now: () => 0, random: () => 0 });
    pacer.markApplied('a');
    expect(pacer.allow('a')).toBe(false);
    expect(pacer.allow('b')).toBe(true);
  });

  it('probability 0 disables reactions', () => {
    const pacer = new ReactionPacer({ random: () => 0, config: () => ({ probability: 0 }) });
    expect(pacer.allow('a')).toBe(false);
  });

  it('evicts the oldest sessions beyond 1024', () => {
    const pacer = new ReactionPacer({ now: () => 0, random: () => 0 });
    for (let i = 0; i < 1030; i++) pacer.markApplied(`s${i}`);
    expect(pacer.size).toBe(1024);
    expect(pacer.allow('s0')).toBe(true); // evicted, cooldown forgotten
    expect(pacer.allow('s1029')).toBe(false);
  });
});

describe('deliverReaction', () => {
  it('does not call add when paced out', async () => {
    const add = vi.fn(async () => ({}));
    const pacer = new ReactionPacer({ random: () => 0.99 });
    expect(await deliverReaction({ pacer, sessionKey: 's', add })).toEqual({ applied: false, paced: true });
    expect(add).not.toHaveBeenCalled();
  });

  it('applies and records, and a failed add does not start a cooldown', async () => {
    const pacer = new ReactionPacer({ now: () => 0, random: () => 0 });
    expect(await deliverReaction({ pacer, sessionKey: 's', add: async () => null })).toEqual({ applied: false, paced: false });
    expect(pacer.allow('s')).toBe(true);
    expect(await deliverReaction({ pacer, sessionKey: 's', add: async () => ({}) })).toEqual({ applied: true, paced: false });
    expect(pacer.allow('s')).toBe(false);
  });
});
