/**
 * Email SMTP/IMAP transport factories (nodemailer + imap).
 */
import nodemailer from 'nodemailer';
import Imap from 'imap';
import type { ResolvedEmailConfig } from './protocol.js';

export interface EmailSmtpTransport {
  verify(): Promise<void>;
  sendMail(options: unknown): Promise<{ messageId?: string }>;
  close(): void;
}

export interface EmailImapTransport {
  once(event: 'ready' | 'error', listener: (...args: unknown[]) => void): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  connect(): void;
  end(): void;
  openBox(
    mailbox: string,
    openReadWrite: boolean,
    callback: (error: Error | null, box?: unknown) => void,
  ): void;
  search(
    criteria: string[],
    callback: (error: Error | null, results: number[]) => void,
  ): void;
  fetch(
    results: number[],
    options: { bodies: string; markSeen?: boolean },
  ): {
    on(event: 'message', listener: (msg: EmailImapFetchMessage, seqno: number) => void): void;
    once(event: 'error' | 'end', listener: (error?: Error) => void): void;
  };
}

export interface EmailImapFetchMessage {
  on(event: 'body', listener: (stream: NodeJS.ReadableStream) => void): void;
  once(event: 'attributes', listener: (attrs: { uid?: number }) => void): void;
  once(event: 'end', listener: () => void): void;
}

export function defaultCreateSmtp(config: ResolvedEmailConfig['smtp']): EmailSmtpTransport {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.auth.user, pass: config.auth.pass },
  });
  return {
    verify: () => transporter.verify().then(() => undefined),
    sendMail: (options) => transporter.sendMail(options as nodemailer.SendMailOptions),
    close: () => transporter.close(),
  };
}

export function defaultCreateImap(config: ResolvedEmailConfig['imap']): EmailImapTransport {
  return new Imap({
    user: config.user,
    password: config.password,
    host: config.host,
    port: config.port,
    tls: config.tls,
  }) as unknown as EmailImapTransport;
}
