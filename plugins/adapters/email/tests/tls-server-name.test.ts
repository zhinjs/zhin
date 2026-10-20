import nodemailer from 'nodemailer';
import { vi } from 'vitest';
import { resolveEmailConfig } from '../src/protocol.js';
import { defaultCreateImap, defaultCreateSmtp } from '../src/transport.js';
import { buildAdditionalProfile } from '../../../../examples/platform-acceptance-bot/additional-profiles.mjs';

const config = {
  id: 'test',
  smtp: { host: '127.0.0.1', port: 18465, secure: true, serverName: 'smtp.example.com', auth: { user: 'test', pass: 'fixture' } },
  imap: { host: '127.0.0.1', port: 18993, tls: true, serverName: 'imap.example.com', user: 'test', password: 'fixture' },
};

describe('Email independent TLS server name', () => {
  it('passes the original TLS identity to real SDK options without changing certificate verification', () => {
    const resolved = resolveEmailConfig(config);
    const smtpFactory = vi.spyOn(nodemailer, 'createTransport');
    try {
      const smtp = defaultCreateSmtp(resolved.smtp);
      expect(smtpFactory).toHaveBeenCalledWith(expect.objectContaining({ host: '127.0.0.1', tls: { servername: 'smtp.example.com' } }));
      const imap = defaultCreateImap(resolved.imap) as unknown as { _config: { host: string; tlsOptions: object }; end(): void };
      expect(imap._config.host).toBe('127.0.0.1');
      expect(imap._config.tlsOptions).toEqual({ servername: 'imap.example.com' });
      smtp.close(); imap.end();
    } finally { smtpFactory.mockRestore(); }
  });

  it.each(['', ' ', 'https://mail.example.com', 'mail.example.com:993'])('rejects invalid optional identity %j', serverName => {
    expect(() => resolveEmailConfig({ ...config, smtp: { ...config.smtp, serverName } })).toThrow('smtp.serverName');
    expect(() => resolveEmailConfig({ ...config, imap: { ...config.imap, serverName } })).toThrow('imap.serverName');
  });

  it('keeps normal profiles unchanged and emits references only when optional variables are configured', () => {
    const environment = { EMAIL_SMTP_HOST: 'smtp.example.com', EMAIL_SMTP_USER: 'test', EMAIL_SMTP_PASSWORD: 'fixture', EMAIL_IMAP_HOST: 'imap.example.com', EMAIL_IMAP_USER: 'test', EMAIL_IMAP_PASSWORD: 'fixture' };
    const normal = buildAdditionalProfile('email', environment).instance.endpoints[0];
    expect(normal.smtp.serverName).toBeUndefined();
    const proxied = buildAdditionalProfile('email', { ...environment, EMAIL_SMTP_SERVER_NAME: 'smtp.example.com', EMAIL_IMAP_SERVER_NAME: 'imap.example.com' }).instance.endpoints[0];
    expect(proxied.smtp.serverName).toBe('${EMAIL_SMTP_SERVER_NAME}');
    expect(proxied.imap.serverName).toBe('${EMAIL_IMAP_SERVER_NAME}');
  });
});
