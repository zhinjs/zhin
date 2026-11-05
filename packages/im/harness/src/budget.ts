/**
 * In-memory conserved budget ledger (ADR 0048 §3.4 invariant 2).
 *
 * Semantics, per budget key:
 * - consumed(g)  = g.ownSpent + Σ rolledUp(closed child), where
 *                  rolledUp(c) = min(consumed(c), granted(c)).
 *                  Overspend beyond a grant stays visible on that grant's own
 *                  snapshot but never inflates the parent's accounting, so
 *                  a subtree can never consume more than it was granted
 *                  from above (conservation).
 * - reserved(g)  = Σ granted(c) over OPEN children c.
 * - remaining(g) = granted(g) - consumed(g) - reserved(g)  (may go negative
 *                  after an overspending charge).
 * - Snapshot: `spent` = consumed(g) (own + closed children), `reservedForChildren`
 *   = reserved(g), `remaining` as above.
 *
 * grant(): requested keys above the parent's remaining fail whole with
 * `budget_exceeded` (no partial grant, no clamping). Omitted keys default to
 * floor(parent remaining / 2), never below 0. The child's granted amount is
 * reserved on the parent immediately.
 *
 * charge(): always records the usage on an open grant; reports
 * `budget_exceeded` (with the exhausted keys) when any remaining < 0.
 *
 * close(): closes open descendants first (deepest first), then the grant.
 * The parent's reservation is released and the child's consumed amount is
 * rolled up, i.e. unspent returns to the parent. Idempotent.
 */
import {
  BUDGET_KEYS,
  type BudgetAmounts,
  type BudgetKey,
  type BudgetLedger,
  type BudgetResult,
  type BudgetSnapshot,
  type GrantId,
} from './contracts.js';

type Mutable = { -readonly [K in BudgetKey]: number };

interface Node {
  readonly id: GrantId;
  readonly parent?: Node;
  readonly granted: BudgetAmounts;
  readonly ownSpent: Mutable;
  readonly rolledUp: Mutable;
  readonly children: Node[];
  closed: boolean;
}

type FailCode = 'budget_exceeded' | 'grant_closed' | 'unknown_grant' | 'invalid_amount';

const zero = (): Mutable => ({ modelCalls: 0, tokens: 0, wallMs: 0, sideEffects: 0 });
const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

export interface InMemoryBudgetLedgerOptions {
  readonly idFactory?: () => GrantId;
}

export class InMemoryBudgetLedger implements BudgetLedger {
  private readonly nodes = new Map<GrantId, Node>();
  private readonly idFactory: () => GrantId;

  constructor(options: InMemoryBudgetLedgerOptions = {}) {
    let n = 0;
    this.idFactory = options.idFactory ?? (() => `g${++n}`);
  }

  openRoot(amounts: BudgetAmounts): GrantId {
    for (const k of BUDGET_KEYS) {
      if (!valid(amounts?.[k])) throw new TypeError(`invalid budget amount for ${k}: ${String(amounts?.[k])}`);
    }
    return this.create(undefined, { ...amounts }).id;
  }

  grant(parentId: GrantId, request: Partial<BudgetAmounts>): BudgetResult<GrantId> {
    const parent = this.nodes.get(parentId);
    if (!parent) return fail('unknown_grant', `unknown grant ${parentId}`);
    if (parent.closed) return fail('grant_closed', `grant ${parentId} is closed`);
    const bad = invalidKey(request);
    if (bad) return fail('invalid_amount', `invalid amount for ${bad}`);
    const rem = this.remaining(parent);
    const exhausted = BUDGET_KEYS.filter((k) => request[k] !== undefined && (request[k] as number) > rem[k]);
    if (exhausted.length > 0) {
      return fail('budget_exceeded', `requested more than parent remaining for: ${exhausted.join(', ')}`, exhausted);
    }
    const amounts = zero();
    for (const k of BUDGET_KEYS) amounts[k] = request[k] ?? Math.max(0, Math.floor(rem[k] / 2));
    return { ok: true, value: this.create(parent, amounts).id };
  }

  charge(grantId: GrantId, usage: Partial<BudgetAmounts>): BudgetResult<BudgetSnapshot> {
    const node = this.nodes.get(grantId);
    if (!node) return fail('unknown_grant', `unknown grant ${grantId}`);
    const bad = invalidKey(usage);
    if (bad) return fail('invalid_amount', `invalid amount for ${bad}`);
    if (node.closed) return fail('grant_closed', `grant ${grantId} is closed`);
    for (const k of BUDGET_KEYS) node.ownSpent[k] += usage[k] ?? 0;
    const rem = this.remaining(node);
    const exhausted = BUDGET_KEYS.filter((k) => rem[k] < 0);
    if (exhausted.length > 0) {
      return fail('budget_exceeded', `budget exceeded for: ${exhausted.join(', ')}`, exhausted);
    }
    return { ok: true, value: this.snap(node) };
  }

  close(grantId: GrantId): BudgetResult<BudgetSnapshot> {
    const node = this.nodes.get(grantId);
    if (!node) return fail('unknown_grant', `unknown grant ${grantId}`);
    this.closeNode(node);
    return { ok: true, value: this.snap(node) };
  }

  snapshot(grantId: GrantId): BudgetSnapshot | undefined {
    const node = this.nodes.get(grantId);
    return node ? this.snap(node) : undefined;
  }

  private create(parent: Node | undefined, granted: BudgetAmounts): Node {
    const id = this.idFactory();
    const node: Node = { id, parent, granted, ownSpent: zero(), rolledUp: zero(), children: [], closed: false };
    this.nodes.set(id, node);
    parent?.children.push(node);
    return node;
  }

  private closeNode(node: Node): void {
    if (node.closed) return;
    for (const child of node.children) this.closeNode(child);
    node.closed = true;
    if (node.parent) {
      const consumed = this.consumed(node);
      for (const k of BUDGET_KEYS) node.parent.rolledUp[k] += Math.min(consumed[k], node.granted[k]);
    }
  }

  private consumed(node: Node): Mutable {
    const out = zero();
    for (const k of BUDGET_KEYS) out[k] = node.ownSpent[k] + node.rolledUp[k];
    return out;
  }

  private reserved(node: Node): Mutable {
    const out = zero();
    for (const c of node.children) if (!c.closed) for (const k of BUDGET_KEYS) out[k] += c.granted[k];
    return out;
  }

  private remaining(node: Node): Mutable {
    const c = this.consumed(node);
    const r = this.reserved(node);
    const out = zero();
    for (const k of BUDGET_KEYS) out[k] = node.granted[k] - c[k] - r[k];
    return out;
  }

  private snap(node: Node): BudgetSnapshot {
    return Object.freeze({
      grantId: node.id,
      ...(node.parent ? { parentId: node.parent.id } : {}),
      granted: Object.freeze({ ...node.granted }),
      spent: Object.freeze(this.consumed(node)),
      reservedForChildren: Object.freeze(this.reserved(node)),
      remaining: Object.freeze(this.remaining(node)),
      closed: node.closed,
    });
  }
}

function invalidKey(amounts: Partial<BudgetAmounts>): BudgetKey | undefined {
  if (amounts === null || typeof amounts !== 'object') return BUDGET_KEYS[0];
  return BUDGET_KEYS.find((k) => amounts[k] !== undefined && !valid(amounts[k]));
}

function fail(
  code: FailCode,
  message: string,
  exhausted?: readonly BudgetKey[],
): { readonly ok: false; readonly code: FailCode; readonly exhausted?: readonly BudgetKey[]; readonly message: string } {
  return exhausted ? { ok: false, code, exhausted, message } : { ok: false, code, message };
}
