import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { identifyEmailConfiguration } from '../src/identity.js';
import { resolveEmailConfig } from '../src/protocol.js';
import type { EmailImapTransport, EmailSmtpTransport } from '../src/transport.js';

const config = resolveEmailConfig({ id: 'label', smtp: { host: 'smtp.fixture', port: 465, secure: true, auth: { user: 'sender', pass: 'synthetic-smtp' } }, imap: { host: 'imap.fixture', port: 993, tls: true, user: 'reader', password: 'synthetic-imap' } });
function transports(failure?: 'smtp' | 'imap' | 'smtp-close' | 'imap-close') {
  let active = 0;
  const smtp: EmailSmtpTransport = { verify: vi.fn(async () => { if (failure === 'smtp') throw new Error('smtp authentication failed'); }), sendMail: vi.fn(async () => { throw new Error('must not send mail'); }), close: vi.fn(() => { --active; if (failure === 'smtp-close') throw new Error('smtp close failed'); }) };
  const events = new EventEmitter();
  const imap: EmailImapTransport = { once: (name, listener) => { events.once(name, listener); }, on: (name, listener) => { events.on(name, listener); }, connect: vi.fn(() => queueMicrotask(() => events.emit(failure === 'imap' ? 'error' : 'ready', ...(failure === 'imap' ? [new Error('imap authentication failed')] : [])))), end: vi.fn(() => { --active; if (failure === 'imap-close') throw new Error('imap close failed'); events.emit('close'); }), openBox: vi.fn(() => { throw new Error('must not open mailbox'); }), search: vi.fn(() => { throw new Error('must not search mail'); }), fetch: vi.fn(() => { throw new Error('must not fetch mail'); }) };
  return { smtp, imap, active: () => active, createSmtp: () => { ++active; return smtp; }, createImap: () => { ++active; return imap; } };
}
describe('readonly composite email identity', () => {
  it('authenticates both true principals without mailbox/mail/file effects and releases both resources', async () => {
    const ports = transports(); const id = await identifyEmailConfiguration(config, new AbortController().signal, ports);
    expect(id).toBe(JSON.stringify(['email', 'imap.fixture', 'reader', 'smtp.fixture', 'sender']));
    expect(ports.active()).toBe(0); expect(ports.smtp.sendMail).not.toHaveBeenCalled(); expect(ports.imap.openBox).not.toHaveBeenCalled(); expect(ports.imap.search).not.toHaveBeenCalled(); expect(ports.imap.fetch).not.toHaveBeenCalled();
    const other = transports(); expect(await identifyEmailConfiguration({ ...config, id: 'different-label', smtp: { ...config.smtp, port: 587, secure: false } }, new AbortController().signal, other)).toBe(id); expect(other.active()).toBe(0);
  });
  it.each(['smtp', 'imap', 'smtp-close', 'imap-close'] as const)('keeps %s failures as errors and releases every acquired transport', async failure => {
    const ports = transports(failure); await expect(identifyEmailConfiguration(config, new AbortController().signal, ports)).rejects.toThrow(); expect(ports.active()).toBe(0); expect(ports.smtp.close).toHaveBeenCalledTimes(1); expect(ports.smtp.sendMail).not.toHaveBeenCalled();
  });
  it('aborts readiness and closes both transports without returning a principal', async () => {
    const ports = transports(), abort = new AbortController(); vi.mocked(ports.imap.connect).mockImplementation(() => { abort.abort(new Error('cancel identity')); });
    await expect(identifyEmailConfiguration(config, abort.signal, ports)).rejects.toThrow('cancel identity'); expect(ports.active()).toBe(0); expect(ports.imap.end).toHaveBeenCalledTimes(1);
  });
});

it('does not report a verified principal until the authenticated IMAP connection actually closes', async () => {
  const ports = transports(), closed = new EventEmitter(); let close!: () => void;
  const imap = Object.assign(new EventEmitter(), ports.imap);
  imap.once = (event: string | symbol, listener: (...args: unknown[]) => void) => { closed.once(event, listener); return imap; };
  imap.on = (event: string | symbol, listener: (...args: unknown[]) => void) => { closed.on(event, listener); return imap; };
  imap.connect = vi.fn(() => queueMicrotask(() => closed.emit('ready')));
  imap.end = vi.fn(() => { close = () => closed.emit('close'); });
  let settled = false;
  const result = identifyEmailConfiguration(config, new AbortController().signal, { createSmtp: ports.createSmtp, createImap: () => imap }).finally(() => { settled = true; });
  await vi.waitFor(() => expect(imap.end).toHaveBeenCalledTimes(1));
  expect(ports.smtp.close).toHaveBeenCalledTimes(1); expect(settled).toBe(false);
  close(); await expect(result).resolves.toBe(JSON.stringify(['email', 'imap.fixture', 'reader', 'smtp.fixture', 'sender']));
});

it('cancels a pending SMTP authentication before opening IMAP and releases the SMTP transport immediately', async () => {
  const ports = transports(), controller = new AbortController(); let release!: () => void;
  vi.mocked(ports.smtp.verify).mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
  const result = identifyEmailConfiguration(config, controller.signal, ports).then(value => value, error => error);
  const reason = new Error('synthetic identity cancelled'); controller.abort(reason);
  try {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(ports.smtp.close).toHaveBeenCalledTimes(1); expect(ports.active()).toBe(0); expect(ports.imap.connect).not.toHaveBeenCalled();
  } finally { release(); await result; }
  expect(await result).toBe(reason);
});
