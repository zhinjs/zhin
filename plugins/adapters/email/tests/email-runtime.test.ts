import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { capabilityId, featureId, rootPluginId } from '@zhin.js/plugin-runtime';
import type { MessageGateway } from '@zhin.js/core/runtime';
import { EmailEndpoint } from '../src/endpoint.js';
import {
  type EmailImapFetchMessage,
  type EmailImapTransport,
  type EmailSmtpTransport,
} from '../src/transport.js';
import {
  formatInboundContent,
  formatOutboundMail,
  htmlToText,
  resolveEmailConfig,
} from '../src/protocol.js';

const adapterFeature = featureId('zhin.adapter');

const baseConfig = resolveEmailConfig({
  name: 'test-endpoint',
  smtp: {
    host: 'smtp.mock',
    port: 465,
    secure: true,
    auth: { user: 'bot@mock.com', pass: 'pass' },
  },
  imap: {
    host: 'imap.mock',
    port: 993,
    tls: true,
    user: 'bot@mock.com',
    password: 'pass',
    checkInterval: 60_000,
  },
});

function createMockSmtp(): EmailSmtpTransport & { sendMail: ReturnType<typeof vi.fn> } {
  return {
    verify: vi.fn(async () => undefined),
    sendMail: vi.fn(async () => ({ messageId: '<sent@mock.com>' })),
    close: vi.fn(),
  };
}

function createMockImap(): EmailImapTransport & {
  emitReady: () => void;
  emitError: (error: Error) => void;
} {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const on = (event: string, listener: (...args: unknown[]) => void) => {
    const list = listeners.get(event) ?? [];
    list.push(listener);
    listeners.set(event, list);
  };
  return {
    once: on,
    on,
    connect: vi.fn(() => {
      queueMicrotask(() => {
        for (const listener of listeners.get('ready') ?? []) listener();
      });
    }),
    end: vi.fn(),
    openBox: vi.fn((_mailbox, _rw, callback) => callback(null, {})),
    search: vi.fn((_criteria, callback) => callback(null, [])),
    fetch: vi.fn(),
    emitReady() {
      for (const listener of listeners.get('ready') ?? []) listener();
    },
    emitError(error: Error) {
      for (const listener of listeners.get('error') ?? []) listener(error);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('email protocol helpers', () => {
  it('resolves smtp/imap from plugin config', () => {
    const resolved = resolveEmailConfig({
      name: 'mail-bot',
      smtp: baseConfig.smtp,
      imap: baseConfig.imap,
    });
    expect(resolved.name).toBe('mail-bot');
    expect(resolved.imap.mailbox).toBe('INBOX');
    expect(resolved.imap.markSeen).toBe(true);
  });

  it('formats inbound content from subject + text', () => {
    expect(formatInboundContent({
      messageId: '<1@x>',
      from: 'a@b.com',
      to: ['bot@mock.com'],
      subject: 'Hello',
      text: 'body',
      attachments: [],
      date: new Date(0),
      uid: 1,
    })).toContain('Subject: Hello');
  });

  it('falls back to html when text is empty', () => {
    expect(formatInboundContent({
      messageId: '',
      from: 'a@b.com',
      to: [],
      subject: '',
      text: '',
      html: '<p>HTML content</p>',
      attachments: [],
      date: new Date(0),
      uid: 1,
    })).toContain('HTML content');
  });

  it('marks empty mail', () => {
    expect(formatInboundContent({
      messageId: '',
      from: '',
      to: [],
      subject: '',
      attachments: [],
      date: new Date(0),
      uid: 1,
    })).toBe('(Empty email)');
  });

  it('formats outbound string payload', () => {
    expect(formatOutboundMail('pong', {
      from: 'bot@mock.com',
      to: 'user@example.com',
    })).toEqual({
      from: 'bot@mock.com',
      to: 'user@example.com',
      subject: 'Message from Bot',
      text: 'pong',
    });
  });

  it('formats outbound segment payload with attachments', () => {
    const mail = formatOutboundMail([
      { type: 'text', data: { text: 'see image' } },
      { type: 'image', data: { url: '/tmp/a.png', filename: 'a.png' } },
    ], { from: 'bot@mock.com', to: 'user@example.com' });
    expect(mail.text).toBe('see image');
    expect(mail.attachments).toEqual([{ filename: 'a.png', path: '/tmp/a.png' }]);
  });

  it('keeps htmlToText stable for common entities', () => {
    expect(htmlToText('a &amp; b<br>c')).toContain('a & b');
    expect(htmlToText('<style>.x{}</style>hello')).toBe('hello');
  });
});

describe('email plugin runtime adapter', () => {
  it('routes admitted mail through MessageGateway when open', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const smtp = createMockSmtp();
    const imap = createMockImap();
    const endpoint = new EmailEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'email'),
      gateway,
      config: baseConfig,
      createSmtp: () => smtp,
      createImap: () => imap,
    });

    await endpoint.start();
    endpoint.open();
    endpoint.admit({
      messageId: '<msg001@mock.com>',
      from: 'sender@example.com',
      to: ['bot@mock.com'],
      subject: '测试邮件',
      text: '你好',
      attachments: [],
      date: new Date(1_700_000_000_000),
      uid: 1,
    });

    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      target: 'sender@example.com',
      content: expect.stringContaining('你好'),
      sender: 'sender@example.com',
    }));

    await endpoint.stop();
    expect(smtp.close).toHaveBeenCalled();
    expect(imap.end).toHaveBeenCalled();
  });

  it('downloads inbound attachments when attachments.enabled', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zhin-email-attachments-'));
    try {
      const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
      const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
      const config = resolveEmailConfig({
        name: 'test-endpoint',
        smtp: {
          host: 'smtp.mock',
          port: 465,
          secure: true,
          auth: { user: 'bot@mock.com', pass: 'pass' },
        },
        imap: {
          host: 'imap.mock',
          port: 993,
          tls: true,
          user: 'bot@mock.com',
          password: 'pass',
        },
        attachments: { enabled: true, downloadPath: dir, maxFileSize: 16 },
      });
      const endpoint = new EmailEndpoint({
        id: capabilityId(rootPluginId(), adapterFeature, 'email'),
        gateway,
        config,
        createSmtp: () => createMockSmtp(),
        createImap: () => createMockImap(),
      });

      await endpoint.start();
      endpoint.open();
      endpoint.admit({
        messageId: '<attach@mock.com>',
        from: 'sender@example.com',
        to: ['bot@mock.com'],
        subject: '带附件',
        text: '见附件',
        attachments: [
          { filename: 'a.txt', contentType: 'text/plain', size: 5, content: Buffer.from('hello') },
          { filename: 'big.bin', contentType: 'application/octet-stream', size: 1024, content: Buffer.alloc(1024) },
        ] as unknown as import('mailparser').Attachment[],
        date: new Date(1_700_000_000_000),
        uid: 2,
      });

      await vi.waitFor(() => expect(receive).toHaveBeenCalled());
      expect(receive).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({
          attachments: [expect.objectContaining({
            filename: 'a.txt',
            path: path.join(dir, 'a.txt'),
          })],
        }),
      }));
      // 超限附件被跳过，未落盘
      await expect(readFile(path.join(dir, 'a.txt'), 'utf8')).resolves.toBe('hello');
      await expect(readFile(path.join(dir, 'big.bin'), 'utf8')).rejects.toThrow();
      await endpoint.stop();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not admit inbound while closed', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
    const endpoint = new EmailEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'email'),
      gateway,
      config: baseConfig,
      createSmtp: () => createMockSmtp(),
      createImap: () => createMockImap(),
    });
    await endpoint.start();
    endpoint.admit({
      messageId: '<1>',
      from: 'a@b.com',
      to: [],
      subject: '',
      text: 'nope',
      attachments: [],
      date: new Date(),
      uid: 1,
    });
    expect(receive).not.toHaveBeenCalled();
    await endpoint.stop();
  });

  it('sends outbound payloads via SMTP', async () => {
    const smtp = createMockSmtp();
    const endpoint = new EmailEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'email'),
      gateway: {
        receive: vi.fn(async () => Object.freeze({ matched: false })),
        send: vi.fn(async () => 'sent'),
      },
      config: baseConfig,
      createSmtp: () => smtp,
      createImap: () => createMockImap(),
    });
    await endpoint.start();
    endpoint.open();
    const messageId = await endpoint.send({
      target: 'user@example.com',
      payload: 'pong',
    });
    expect(messageId).toBe('<sent@mock.com>');
    expect(smtp.sendMail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@example.com',
      text: 'pong',
    }));
    await endpoint.stop();
  });

  it('polls IMAP UNSEEN and admits parsed bodies', async () => {
    const receive = vi.fn(async () => Object.freeze({ matched: false }));
    const smtp = createMockSmtp();
    const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const on = (event: string, listener: (...args: unknown[]) => void) => {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
    };
    const imap: EmailImapTransport = {
      once: on,
      on,
      connect: vi.fn(() => {
        queueMicrotask(() => {
          for (const listener of listeners.get('ready') ?? []) listener();
        });
      }),
      end: vi.fn(),
      openBox: vi.fn((_m, _rw, cb) => cb(null, {})),
      search: vi.fn((_c, cb) => cb(null, [1])),
      fetch: vi.fn(() => {
        const fetchListeners: {
          message?: (msg: EmailImapFetchMessage, seqno: number) => void;
          end?: () => void;
        } = {};
        queueMicrotask(() => {
          const msg: EmailImapFetchMessage = {
            on(event, listener) {
              if (event === 'body') {
                const stream = {
                  on(ev: string, dataListener: (chunk: string) => void) {
                    if (ev === 'data') dataListener([
                      'From: sender@example.com',
                      'Subject: poll',
                      'Content-Type: text/plain; charset=utf-8',
                      '',
                      'polled body',
                    ].join('\r\n'));
                  },
                } as unknown as NodeJS.ReadableStream;
                listener(stream);
              }
            },
            once(event, listener) {
              if (event === 'attributes') (listener as (attrs: { uid?: number }) => void)({ uid: 9 });
              if (event === 'end') queueMicrotask(() => (listener as () => void)());
            },
          };
          fetchListeners.message?.(msg, 1);
          fetchListeners.end?.();
        });
        return {
          on(event: 'message', listener: (msg: EmailImapFetchMessage, seqno: number) => void) {
            fetchListeners.message = listener;
          },
          once(event: 'error' | 'end', listener: (error?: Error) => void) {
            if (event === 'end') fetchListeners.end = () => listener();
          },
        };
      }),
    };

    const endpoint = new EmailEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'email'),
      gateway: { receive, send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createSmtp: () => smtp,
      createImap: () => imap,
    });
    await endpoint.start();
    endpoint.open();
    await vi.waitFor(() => expect(receive).toHaveBeenCalled());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('polled body'),
    }));
    await endpoint.stop();
  });
});
