import { createHash, randomBytes } from 'node:crypto';

export const TERMINAL_TICKET_TTL_MS = 30_000;
const MAX_PENDING_PER_PRINCIPAL = 16;

export interface TerminalTicketGrant {
  readonly principalId: string;
  /** The full principal the session will run as; `principal.id === principalId`. */
  readonly principal: { readonly id: string; readonly kind?: string };
  readonly target: string;
  readonly cols: number;
  readonly rows: number;
}

export interface IssuedTerminalTicket {
  readonly ticket: string;
  /** Unix epoch milliseconds. */
  readonly expiresAt: number;
}

export type TicketConsumeResult =
  | { readonly ok: true; readonly grant: TerminalTicketGrant }
  | { readonly ok: false; readonly reason: 'invalid' | 'expired' | 'principal-mismatch' };

interface StoredTicket extends TerminalTicketGrant {
  readonly expiresAt: number;
}

/**
 * One-time WebSocket tickets. Only the SHA-256 of a ticket is stored; lookup is a
 * map access on that hash, so response timing does not depend on how much of a
 * guessed ticket matches.
 */
export class TerminalTicketStore {
  readonly #tickets = new Map<string, StoredTicket>();
  readonly #now: () => number;
  readonly #ttlMs: number;

  constructor(options: { now?: () => number; ttlMs?: number } = {}) {
    this.#now = options.now ?? Date.now;
    this.#ttlMs = options.ttlMs ?? TERMINAL_TICKET_TTL_MS;
  }

  issue(grant: TerminalTicketGrant): IssuedTerminalTicket {
    this.sweep();
    const pending = [...this.#tickets.entries()].filter(([, entry]) => entry.principalId === grant.principalId);
    // Bound memory per principal: drop the oldest pending ticket.
    if (pending.length >= MAX_PENDING_PER_PRINCIPAL) {
      pending.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
      this.#tickets.delete(pending[0]![0]);
    }
    const ticket = randomBytes(32).toString('base64url');
    const expiresAt = this.#now() + this.#ttlMs;
    this.#tickets.set(hashTicket(ticket), Object.freeze({ ...grant, expiresAt }));
    return Object.freeze({ ticket, expiresAt });
  }

  /**
   * Consumes a ticket. Any presented ticket is removed on first use, even when the
   * caller's principal does not match, so a leaked ticket cannot be probed twice.
   */
  consume(ticket: string | null | undefined, expectedPrincipalId?: string): TicketConsumeResult {
    if (!ticket || ticket.length > 128) return { ok: false, reason: 'invalid' };
    const key = hashTicket(ticket);
    const entry = this.#tickets.get(key);
    if (!entry) return { ok: false, reason: 'invalid' };
    this.#tickets.delete(key);
    if (entry.expiresAt <= this.#now()) return { ok: false, reason: 'expired' };
    if (expectedPrincipalId !== undefined && expectedPrincipalId !== entry.principalId) {
      return { ok: false, reason: 'principal-mismatch' };
    }
    const { expiresAt: _expiresAt, ...grant } = entry;
    return { ok: true, grant: Object.freeze(grant) };
  }

  revokePrincipal(principalId: string): number {
    let removed = 0;
    for (const [key, entry] of this.#tickets) {
      if (entry.principalId !== principalId) continue;
      this.#tickets.delete(key);
      removed += 1;
    }
    return removed;
  }

  sweep(): void {
    const now = this.#now();
    for (const [key, entry] of this.#tickets) {
      if (entry.expiresAt <= now) this.#tickets.delete(key);
    }
  }

  clear(): void {
    this.#tickets.clear();
  }

  get size(): number {
    return this.#tickets.size;
  }
}

function hashTicket(ticket: string): string {
  return createHash('sha256').update(ticket).digest('hex');
}
