/**
 * ADR 0048 H3 — the Mail a running turn answers.
 *
 * The ingress (or any host driving turns through {@link HostMailbox}) runs a
 * `run` admission inside {@link runInMailTurn}; the turn engine reads it with
 * {@link currentMailTurn} to bind collaboration tools to the turn's Mail in
 * the long-lived harness. Isolated per async chain, so concurrent turns of
 * different lanes never see each other's Mail.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Mail } from '@zhin.js/harness';
import type { HostMailbox } from './host-mailbox.js';

export interface MailTurn {
  readonly mailbox: HostMailbox;
  /** The first mail of the batch, with the batch's intersected authority (Q2). */
  readonly mail: Mail;
  readonly batch: readonly Mail[];
}

const storage = new AsyncLocalStorage<MailTurn>();

export function runInMailTurn<T>(turn: MailTurn, fn: () => Promise<T>): Promise<T> {
  return storage.run(Object.freeze({ ...turn }), fn);
}

export function currentMailTurn(): MailTurn | undefined {
  return storage.getStore();
}
