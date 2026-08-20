import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import type { MessageGateway } from '@zhin.js/core/runtime';
import { EmailEndpoint } from '../src/endpoint.js';
import {
  type EmailImapFetchMessage,
  type EmailImapTransport,
  type EmailSmtpTransport,
} from '../src/transport.js';
import {
  formatInboundContent,
  formatInboundSegments,
  formatOutboundMail,
  htmlToText,
  resolveEmailConfig,
} from '../src/protocol.js';

const adapterFeature = featureId('zhin.adapter');

const baseConfig = resolveEmailConfig({
  id: 'test-endpoint',
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
  emit: (event: string, ...args: unknown[]) => void;
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
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
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
      id: 'mail-bot',
      smtp: baseConfig.smtp,
      imap: baseConfig.imap,
    });
    expect(resolved.id).toBe('mail-bot');
    expect(resolved.imap.mailbox).toBe('INBOX');
    expect(resolved.imap.markSeen).toBe(true);
  });

  it('clamps checkInterval/reconnectInterval to a minimum to avoid setInterval storms', () => {
    const resolved = resolveEmailConfig({
      smtp: baseConfig.smtp,
      imap: { ...baseConfig.imap, checkInterval: 0, reconnectInterval: -5 },
    });
    expect(resolved.imap.checkInterval).toBe(1_000);
    expect(resolved.imap.reconnectInterval).toBe(1_000);
  });

  it('defaults reconnectInterval when not configured', () => {
    const resolved = resolveEmailConfig({
      smtp: baseConfig.smtp,
      imap: baseConfig.imap,
    });
    expect(resolved.imap.reconnectInterval).toBe(5_000);
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
      { type: 'image', data: { media: { kind: 'path', value: '/tmp/a.png', file_name: 'a.png' } } },
    ], { from: 'bot@mock.com', to: 'user@example.com' });
    expect(mail.text).toBe('see image');
    expect(mail.attachments).toEqual([{ filename: 'a.png', path: '/tmp/a.png' }]);
  });

  it('maps canonical media (url/path) to nodemailer attachments', () => {
    const mail = formatOutboundMail([
      { type: 'text', data: { text: 'see' } },
      { type: 'image', data: { media: { kind: 'path', value: '/tmp/a.png' }, name: 'a.png' } },
      { type: 'file', data: { media: { kind: 'url', value: 'https://x/b.pdf' }, name: 'b.pdf' } },
    ], { from: 'bot@mock.com', to: 'user@example.com' });
    expect(mail.attachments).toEqual([
      { filename: 'a.png', path: '/tmp/a.png' },
      { filename: 'b.pdf', path: 'https://x/b.pdf' },
    ]);
  });

  it('sends base64 media inline via nodemailer content + encoding', () => {
    const mail = formatOutboundMail([
      { type: 'image', data: { media: { kind: 'base64', value: 'aGVsbG8=', file_name: 'c.png' } } },
      { type: 'image', data: { media: { kind: 'base64', value: 'data:image/png;base64,d29ybGQ=' }, alt: 'd.png' } },
    ], { from: 'bot@mock.com', to: 'user@example.com' });
    expect(mail.attachments).toEqual([
      { filename: 'c.png', content: 'aGVsbG8=', encoding: 'base64' },
      { filename: 'd.png', content: 'd29ybGQ=', encoding: 'base64' },
    ]);
  });

  it('drops media segments without a deliverable MediaRef', () => {
    const mail = formatOutboundMail([
      { type: 'text', data: { text: 'body' } },
      { type: 'image', data: { url: '/tmp/a.png' } },
      { type: 'file', data: { media: { kind: 'file', value: 'opaque-id' } } },
    ], { from: 'bot@mock.com', to: 'user@example.com' });
    expect(mail.text).toBe('body');
    expect(mail.attachments).toBeUndefined();
  });

  it('maps saved inbound attachments to canonical segments (MediaRef kind=path)', () => {
    const email = {
      messageId: '<1@x>',
      from: 'a@b.com',
      to: ['bot@mock.com'],
      subject: 'S',
      text: 'body',
      attachments: [],
      date: new Date(0),
      uid: 1,
    };
    expect(formatInboundSegments(email)).toEqual([
      { type: 'text', data: { text: formatInboundContent(email) } },
    ]);
    expect(formatInboundSegments(email, [
      { filename: 'a.png', path: '/dl/a.png', contentType: 'image/png' },
      { filename: 'b.pdf', path: '/dl/b.pdf', contentType: 'application/pdf' },
    ])).toEqual([
      { type: 'text', data: { text: formatInboundContent(email) } },
      {
        type: 'image',
        data: {
          media: { kind: 'path', value: '/dl/a.png', mime_type: 'image/png' },
          name: 'a.png',
          alt: 'a.png',
        },
      },
      {
        type: 'file',
        data: {
          media: { kind: 'path', value: '/dl/b.pdf', mime_type: 'application/pdf' },
          name: 'b.pdf',
        },
      },
    ]);
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
      conversation: expect.objectContaining({
        kind: 'private',
        id: 'sender@example.com',
      }),
      message: expect.objectContaining({ id: '<msg001@mock.com>' }),
      content: expect.stringContaining('你好'),
      sender: expect.objectContaining({ id: 'sender@example.com' }),
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
        id: 'test-endpoint',
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

  it('admits canonical segments: downloaded attachments as image/file (kind=path)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zhin-email-segments-'));
    try {
      const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
      const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
      const config = resolveEmailConfig({
        id: 'test-endpoint',
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
        attachments: { enabled: true, downloadPath: dir },
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
        messageId: '<seg@mock.com>',
        from: 'sender@example.com',
        to: ['bot@mock.com'],
        subject: '图',
        text: '看图',
        attachments: [
          { filename: 'pic.png', contentType: 'image/png', size: 3, content: Buffer.from('png') },
        ] as unknown as import('mailparser').Attachment[],
        date: new Date(1_700_000_000_000),
        uid: 4,
      });

      await vi.waitFor(() => expect(receive).toHaveBeenCalled());
      expect(receive).toHaveBeenCalledWith(expect.objectContaining({
        segments: [
          { type: 'text', data: { text: expect.stringContaining('[image: pic.png]') } },
          {
            type: 'image',
            data: {
              media: { kind: 'path', value: path.join(dir, 'pic.png'), mime_type: 'image/png' },
              name: 'pic.png',
              alt: 'pic.png',
            },
          },
        ],
      }));
      await endpoint.stop();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('neutralizes attachment filename path traversal', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'zhin-email-traversal-'));
    try {
      const receive = vi.fn(async () => Object.freeze({ matched: true, value: 'ok' }));
      const gateway: MessageGateway = { receive, send: vi.fn(async () => 'sent') };
      const config = resolveEmailConfig({
        id: 'test-endpoint',
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
        attachments: { enabled: true, downloadPath: dir },
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
        messageId: '<evil@mock.com>',
        from: 'attacker@example.com',
        to: ['bot@mock.com'],
        subject: '穿越',
        text: 'x',
        attachments: [
          { filename: '../../evil.txt', contentType: 'text/plain', size: 4, content: Buffer.from('evil') },
          { filename: '..', contentType: 'text/plain', size: 4, content: Buffer.from('evil') },
        ] as unknown as import('mailparser').Attachment[],
        date: new Date(1_700_000_000_000),
        uid: 3,
      });

      await vi.waitFor(() => expect(receive).toHaveBeenCalled());
      // 穿越文件名被 basename 化后落进 downloadPath；目录外不落盘
      await expect(readFile(path.resolve(dir, '../evil.txt'), 'utf8')).rejects.toThrow();
      await expect(readFile(path.join(dir, 'evil.txt'), 'utf8')).resolves.toBe('evil');
      const metadata = receive.mock.calls[0]?.[0]?.metadata as {
        attachments?: Array<{ filename: string; path: string }>;
      };
      expect(metadata.attachments).toHaveLength(1);
      expect(metadata.attachments?.[0]?.path).toBe(path.join(dir, 'evil.txt'));
      await endpoint.stop();
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(path.resolve(dir, '../evil.txt'), { force: true });
    }
  });

  it('reconnects IMAP after end with backoff and resumes listening', async () => {
    const imaps: Array<ReturnType<typeof createMockImap>> = [];
    const endpoint = new EmailEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'email'),
      gateway: { receive: vi.fn(async () => Object.freeze({ matched: false })), send: vi.fn(async () => 'sent') },
      config: {
        ...baseConfig,
        imap: { ...baseConfig.imap, reconnectInterval: 50 },
      },
      createSmtp: () => createMockSmtp(),
      createImap: () => {
        const imap = createMockImap();
        imaps.push(imap);
        return imap;
      },
    });

    await endpoint.start();
    expect(imaps).toHaveLength(1);
    imaps[0]!.emit('end');
    await vi.waitFor(() => expect(imaps.length).toBe(2));
    await endpoint.stop();

    // stop 之后再 end 不再触发重连
    imaps[1]!.emit('end');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(imaps).toHaveLength(2);
  });

  it('disarms pending reconnect when stop runs before the backoff fires', async () => {
    const imaps: Array<ReturnType<typeof createMockImap>> = [];
    const endpoint = new EmailEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'email'),
      gateway: { receive: vi.fn(async () => Object.freeze({ matched: false })), send: vi.fn(async () => 'sent') },
      config: {
        ...baseConfig,
        imap: { ...baseConfig.imap, reconnectInterval: 60 },
      },
      createSmtp: () => createMockSmtp(),
      createImap: () => {
        const imap = createMockImap();
        imaps.push(imap);
        return imap;
      },
    });

    await endpoint.start();
    imaps[0]!.emit('end');
    await endpoint.stop();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(imaps).toHaveLength(1);
  });

  it('serializes concurrent new-mail checks with an in-flight guard', async () => {
    let releaseSearch: (() => void) | null = null;
    const imap = createMockImap();
    imap.openBox = vi.fn((_mailbox, _rw, callback) => callback(null, {}));
    imap.search = vi.fn((_criteria, callback) => {
      releaseSearch = () => callback(null, []);
    });

    const endpoint = new EmailEndpoint({
      id: capabilityId(rootPluginId(), adapterFeature, 'email'),
      gateway: { receive: vi.fn(async () => Object.freeze({ matched: false })), send: vi.fn(async () => 'sent') },
      config: baseConfig,
      createSmtp: () => createMockSmtp(),
      createImap: () => imap,
    });

    await endpoint.start();
    // start 触发的首次 check 卡在 search 上；mail 事件触发的第二次必须被在飞锁跳过
    await vi.waitFor(() => expect(imap.search).toHaveBeenCalledTimes(1));
    imap.emit('mail');
    expect(imap.search).toHaveBeenCalledTimes(1);
    releaseSearch!();
    await endpoint.stop();
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
    const endpointKey = capabilityId(rootPluginId(), adapterFeature, 'email');
    const messageId = await endpoint.send({
      conversation: {
        endpoint: { id: String(endpointKey), adapter: String(endpointKey).split('\0')[0]! },
        kind: 'private',
        id: 'user@example.com',
      },
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
