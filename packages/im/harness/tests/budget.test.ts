import { InMemoryBudgetLedger } from '../src/budget.js';
import { BUDGET_KEYS, type BudgetAmounts, type BudgetLedger, type GrantId } from '../src/contracts.js';

const A = (n: number): BudgetAmounts => ({ modelCalls: n, tokens: n * 100, wallMs: n * 1000, sideEffects: n });

function ok<T>(r: { ok: boolean; value?: T }): T {
  expect(r.ok).toBe(true);
  return (r as { value: T }).value;
}

type Part = Partial<Record<keyof BudgetAmounts, number>>;

function clip(want: Part, rem: BudgetAmounts): Part {
  const out: Part = {};
  for (const k of BUDGET_KEYS) if (want[k] !== undefined) out[k] = Math.max(0, Math.min(want[k]!, rem[k]));
  return out;
}

describe('InMemoryBudgetLedger', () => {
  it('uses incrementing default ids and custom idFactory', () => {
    const l = new InMemoryBudgetLedger();
    expect(l.openRoot(A(1))).toBe('g1');
    expect(l.openRoot(A(1))).toBe('g2');
    let i = 0;
    const c = new InMemoryBudgetLedger({ idFactory: () => `x${i++}` });
    expect(c.openRoot(A(1))).toBe('x0');
  });

  it('rejects invalid root amounts', () => {
    const l = new InMemoryBudgetLedger();
    expect(() => l.openRoot({ ...A(1), tokens: -1 })).toThrow(TypeError);
    expect(() => l.openRoot({ ...A(1), wallMs: NaN })).toThrow(TypeError);
    expect(() => l.openRoot({ ...A(1), modelCalls: Infinity })).toThrow(TypeError);
  });

  it('reports each error code', () => {
    const l = new InMemoryBudgetLedger();
    const root = l.openRoot(A(10));
    expect(l.grant('nope', {})).toMatchObject({ ok: false, code: 'unknown_grant' });
    expect(l.charge('nope', {})).toMatchObject({ ok: false, code: 'unknown_grant' });
    expect(l.close('nope')).toMatchObject({ ok: false, code: 'unknown_grant' });
    expect(l.snapshot('nope')).toBeUndefined();
    expect(l.grant(root, { tokens: -5 })).toMatchObject({ ok: false, code: 'invalid_amount' });
    expect(l.grant(root, { tokens: NaN })).toMatchObject({ ok: false, code: 'invalid_amount' });
    expect(l.charge(root, { wallMs: -1 })).toMatchObject({ ok: false, code: 'invalid_amount' });
    expect(l.grant(root, { tokens: 1001, modelCalls: 20 })).toMatchObject({
      ok: false,
      code: 'budget_exceeded',
      exhausted: ['modelCalls', 'tokens'],
    });
    // no partial grant happened
    expect(l.snapshot(root)!.reservedForChildren).toEqual(A(0));
    l.close(root);
    expect(l.grant(root, {})).toMatchObject({ ok: false, code: 'grant_closed' });
    expect(l.charge(root, { tokens: 1 })).toMatchObject({ ok: false, code: 'grant_closed' });
  });

  it('halves omitted keys and honours explicit ones', () => {
    const l = new InMemoryBudgetLedger();
    const root = l.openRoot({ modelCalls: 5, tokens: 1000, wallMs: 3, sideEffects: 0 });
    const child = ok(l.grant(root, { tokens: 100 }));
    expect(l.snapshot(child)!.granted).toEqual({ modelCalls: 2, tokens: 100, wallMs: 1, sideEffects: 0 });
  });

  it('reserves on grant and releases unspent on close', () => {
    const l = new InMemoryBudgetLedger();
    const root = l.openRoot(A(10));
    const child = ok(l.grant(root, A(4)));
    let r = l.snapshot(root)!;
    expect(r.reservedForChildren).toEqual(A(4));
    expect(r.remaining).toEqual(A(6));
    ok(l.charge(child, A(1)));
    const closed = ok(l.close(child));
    expect(closed.closed).toBe(true);
    expect(closed.spent).toEqual(A(1));
    r = l.snapshot(root)!;
    expect(r.reservedForChildren).toEqual(A(0));
    expect(r.spent).toEqual(A(1));
    expect(r.remaining).toEqual(A(9));
    // idempotent
    expect(l.close(child)).toEqual({ ok: true, value: closed });
    expect(l.snapshot(root)).toEqual(r);
  });

  it('handles a nested 3-level tree and closes descendants first', () => {
    const l = new InMemoryBudgetLedger();
    const root = l.openRoot(A(100));
    const mid = ok(l.grant(root, A(40)));
    const leaf = ok(l.grant(mid, A(10)));
    expect(l.snapshot(mid)!.remaining).toEqual(A(30));
    expect(l.grant(mid, A(31))).toMatchObject({ ok: false, code: 'budget_exceeded' });
    ok(l.charge(leaf, A(3)));
    ok(l.charge(mid, A(5)));
    ok(l.close(mid));
    expect(l.snapshot(leaf)!.closed).toBe(true);
    expect(l.snapshot(root)!.spent).toEqual(A(8));
    expect(l.snapshot(root)!.remaining).toEqual(A(92));
    expect(l.snapshot(root)!.reservedForChildren).toEqual(A(0));
  });

  it('records overspend and reports it without leaking to the parent', () => {
    const l = new InMemoryBudgetLedger();
    const root = l.openRoot(A(10));
    const child = ok(l.grant(root, A(2)));
    const r = l.charge(child, { tokens: 500 });
    expect(r).toMatchObject({ ok: false, code: 'budget_exceeded', exhausted: ['tokens'] });
    expect(l.snapshot(child)!.spent.tokens).toBe(500);
    expect(l.snapshot(child)!.remaining.tokens).toBe(-300);
    // halving a negative remaining never goes below zero
    const grandchild = ok(l.grant(child, {}));
    expect(l.snapshot(grandchild)!.granted.tokens).toBe(0);
    ok(l.close(child));
    expect(l.snapshot(root)!.spent.tokens).toBe(200);
    expect(l.snapshot(root)!.remaining.tokens).toBe(800);
  });

  it('returns frozen snapshots', () => {
    const l = new InMemoryBudgetLedger();
    expect(Object.isFrozen(l.snapshot(l.openRoot(A(1))))).toBe(true);
  });

  it('conserves budget under a seeded random op sequence', () => {
    let seed = 123456789;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const l: BudgetLedger = new InMemoryBudgetLedger();
    const rootAmounts = A(50);
    const root = l.openRoot(rootAmounts);
    const all: GrantId[] = [root];
    const stopped = new Set<GrantId>();
    const amountsUpTo = (max: BudgetAmounts): Part => {
      const out: Part = {};
      for (const k of BUDGET_KEYS) if (rnd() < 0.5) out[k] = Math.max(0, Math.floor(rnd() * (Math.max(0, max[k]) * 0.6 + 2)));
      return out;
    };
    const check = () => {
      for (const id of all) {
        const s = l.snapshot(id)!;
        for (const k of BUDGET_KEYS) {
          expect(s.remaining[k]).toBeCloseTo(s.granted[k] - s.spent[k] - s.reservedForChildren[k], 9);
        }
      }
      const rs = l.snapshot(root)!;
      for (const k of BUDGET_KEYS) expect(rs.spent[k]).toBeLessThanOrEqual(rootAmounts[k]);
    };

    for (let i = 0; i < 600; i++) {
      const id = all[Math.floor(rnd() * all.length)];
      const s = l.snapshot(id)!;
      const op = rnd();
      if (op < 0.35) {
        const r = l.grant(id, amountsUpTo(s.remaining));
        if (r.ok) all.push(r.value);
      } else if (op < 0.9) {
        if (stopped.has(id)) continue;
        // the root never overspends directly; others may, then that branch stops
        const want = amountsUpTo(s.remaining);
        const r = l.charge(id, id === root ? clip(want, s.remaining) : want);
        if (!r.ok && r.code === 'budget_exceeded') stopped.add(id);
      } else if (id !== root) {
        l.close(id);
      }
      check();
    }
    expect(all.length).toBeGreaterThan(20);
  });
});
