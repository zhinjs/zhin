import type { EmailImapTransport, EmailSmtpTransport } from './transport.js';
import { defineEndpointClient } from 'zhin.js/adapter';

/** Live SMTP + IMAP client pair exposed to event handlers and plugins. */
export class EmailClient {
  constructor(
    private readonly resolveSmtp: () => EmailSmtpTransport | null,
    private readonly resolveImap: () => EmailImapTransport | null,
  ) {}

  get smtp(): EmailSmtpTransport {
    const transport = this.resolveSmtp();
    if (!transport) throw new Error('SMTP transporter not connected');
    return transport;
  }

  get imap(): EmailImapTransport {
    const transport = this.resolveImap();
    if (!transport) throw new Error('IMAP client not connected');
    return transport;
  }

  verify(): Promise<void> {
    return this.smtp.verify();
  }

  sendMail(options: unknown): Promise<{ messageId?: string }> {
    return this.smtp.sendMail(options);
  }
}

export type EmailClientEventMap = Record<string, unknown>;

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly email: { readonly client: EmailClient; readonly events: EmailClientEventMap };
  }
}

export const emailClient = defineEndpointClient<EmailClient, EmailClientEventMap>('email');
