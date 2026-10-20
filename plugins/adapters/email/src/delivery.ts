import { EndpointDeliveryError } from '@zhin.js/im-contract';
import type { EmailSmtpResult } from './transport.js';

function address(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value : value && typeof value === 'object' && 'address' in value ? value.address : undefined;
  if (typeof raw !== 'string') return undefined;
  const enclosed = /<([^<>]+)>/.exec(raw);
  return (enclosed?.[1] ?? raw).trim().toLowerCase() || undefined;
}
/** A local Message-ID is insufficient: require complete SMTP recipient acceptance. */
export function requireSmtpAcceptance(info: EmailSmtpResult, target: string): string {
  const accepted = Array.isArray(info.accepted) ? info.accepted.map(address) : undefined;
  const requested = info.envelope?.to?.length ? info.envelope.to.map(address) : [address(target)];
  const rejected = Array.isArray(info.rejected) ? info.rejected : undefined;
  const pending = info.pending;
  if (accepted && accepted.length === 0 && rejected && rejected.length > 0 && !pending?.length && requested.every(recipient => recipient && rejected.map(address).includes(recipient)) && rejected.map(address).includes(address(target))) throw new EndpointDeliveryError('platform_rejected', 'SMTP rejected all recipients', 'rejected');
  if (!accepted?.length || accepted.some(recipient => !recipient) || !rejected || rejected.length || (pending && pending.length) || requested.some(recipient => !recipient || !accepted.includes(recipient)) || !accepted.includes(address(target)) || typeof info.messageId !== 'string' || !info.messageId.trim()) {
    throw new EndpointDeliveryError('delivery_unconfirmed', 'SMTP delivery is incomplete or unconfirmed', 'unknown');
  }
  return info.messageId;
}
/** Preserve only stable protocol evidence, never server response text or credentials. */
export function smtpDeliveryError(error: unknown): EndpointDeliveryError {
  if (error instanceof EndpointDeliveryError) return error;
  const value = error && typeof error === 'object' ? error as { responseCode?: unknown; accepted?: unknown[] } : {};
  const rejected = typeof value.responseCode === 'number' && Number.isInteger(value.responseCode) && value.responseCode >= 400 && value.responseCode <= 599 && !value.accepted?.length;
  return new EndpointDeliveryError(rejected ? 'platform_rejected' : 'delivery_unconfirmed', rejected ? `SMTP rejected request (${value.responseCode})` : 'SMTP delivery outcome is unknown', rejected ? 'rejected' : 'unknown', { cause: error });
}
