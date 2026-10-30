import { defaultCreateImap, defaultCreateSmtp, type EmailImapTransport, type EmailSmtpTransport } from './transport.js';
import type { ResolvedEmailConfig } from './protocol.js';

export interface EmailIdentityTransports {
  readonly createSmtp?: typeof defaultCreateSmtp;
  readonly createImap?: typeof defaultCreateImap;
}

/** Authenticate both configured protocol principals, without mailbox access, mail or persistence. */
export async function identifyEmailConfiguration(config: ResolvedEmailConfig, signal: AbortSignal,
  transports: EmailIdentityTransports = {}): Promise<string> {
  let smtp: EmailSmtpTransport | undefined, imap: EmailImapTransport | undefined;
  let failure: unknown, result: string | undefined;
  const cleanupErrors: unknown[] = [];
  let connectionStarted = false, cleaningUp = false;
  let closed: Promise<void> | undefined;
  try {
    signal.throwIfAborted();
    smtp = (transports.createSmtp ?? defaultCreateSmtp)(config.smtp);
    await abortableAuthentication(smtp.verify(), signal); signal.throwIfAborted();
    imap = (transports.createImap ?? defaultCreateImap)(config.imap);
    const connection = imap;
    closed = new Promise<void>(resolve => { connection.on('close', () => resolve()); });
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const complete = (error?: unknown) => {
        if (settled) return; settled = true; signal.removeEventListener('abort', aborted);
        if (error === undefined) resolve(); else reject(error);
      };
      const aborted = () => complete(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      connection.once('ready', () => complete());
      connection.on('error', error => { if (cleaningUp) cleanupErrors.push(error); else complete(error); });
      connection.on('end', () => complete(new Error('IMAP closed before authentication')));
      connection.on('close', () => complete(new Error('IMAP closed before authentication')));
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) aborted();
      else { try { connection.connect(); connectionStarted = true; } catch (error) { complete(error); } }
    });
    signal.throwIfAborted();
    result = JSON.stringify(['email', config.imap.host, config.imap.user, config.smtp.host, config.smtp.auth.user]);
  } catch (error) { failure = error; }
  finally {
    cleaningUp = true;
    let requestedClose = false;
    try {
      if (imap?.destroy) imap.destroy(); else imap?.end();
      requestedClose = true;
    } catch (error) { cleanupErrors.push(error); }
    try { smtp?.close(); } catch (error) { cleanupErrors.push(error); }
    // node-imap destroy/end requests shutdown; only its socket close event confirms release.
    if (connectionStarted && requestedClose) await closed;
  }
  if (failure !== undefined || cleanupErrors.length) {
    if (cleanupErrors.length) throw new AggregateError([...(failure === undefined ? [] : [failure]), ...cleanupErrors], 'Email identity verification or cleanup failed');
    throw failure;
  }
  if (result === undefined) throw new Error('Email identity verification returned no principal');
  return result;
}

/** Cancellation closes the caller-owned SMTP transport in finally even if verify has not settled. */
function abortableAuthentication(authentication: Promise<unknown>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const complete = (error?: unknown) => {
      if (settled) return;
      settled = true; signal.removeEventListener('abort', abort);
      if (error === undefined) resolve(); else reject(error);
    };
    const abort = () => complete(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    authentication.then(() => complete(), complete);
    if (signal.aborted) abort();
  });
}
