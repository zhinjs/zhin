import { createHttpHost, type ProcessHttpHost } from '@zhin.js/host-http/node';
import { WebSocket } from 'ws';
import {
  installConsoleTerminal,
  type ConsoleTerminalHandle,
  type TerminalAuditEvent,
  type TerminalPrincipal,
} from '../../src/terminal/index.js';
import type { PtyModule } from '../../src/terminal/modules.js';

// End-to-end over a real HttpHost and a real WebSocket client; node-pty is faked.
const TOKENS: Record<string, TerminalPrincipal> = {
  'owner-token': { id: 'user:owner', kind: 'user' },
  'viewer-token': { id: 'user:viewer', kind: 'user' },
};

function echoPty(): { module: PtyModule; killed: () => number } {
  let killed = 0;
  return {
    killed: () => killed,
    module: {
      spawn: () => {
        let onData: ((data: string) => void) | undefined;
        let onExit: ((event: { exitCode: number }) => void) | undefined;
        return {
          pid: 1,
          onData: (listener) => { onData = listener; },
          onExit: (listener) => { onExit = listener; },
          write: (data) => {
            const text = String(data);
            if (text === 'exit\r') onExit?.({ exitCode: 7 });
            else onData?.(`echo:${text}`);
          },
          resize: (cols, rows) => onData?.(`size:${cols}x${rows}`),
          kill: () => { killed += 1; onExit?.({ exitCode: 0 }); },
        };
      },
    },
  };
}

interface Frame { binary: boolean; text: string }

function openSocket(url: string): Promise<{ ws: WebSocket; frames: Frame[]; next(match: (frame: Frame) => boolean): Promise<Frame>; closed: Promise<number> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const frames: Frame[] = [];
    const waiters: Array<{ match: (frame: Frame) => boolean; resolve: (frame: Frame) => void }> = [];
    const closed = new Promise<number>((done) => ws.once('close', (code) => done(code)));
    ws.on('message', (data, isBinary) => {
      const frame = { binary: isBinary, text: data.toString() };
      frames.push(frame);
      for (const waiter of [...waiters]) {
        if (!waiter.match(frame)) continue;
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(frame);
      }
    });
    const next = (match: (frame: Frame) => boolean) => {
      const existing = frames.find(match);
      if (existing) return Promise.resolve(existing);
      return new Promise<Frame>((done) => waiters.push({ match, resolve: done }));
    };
    ws.once('open', () => resolve({ ws, frames, next, closed }));
    ws.once('error', reject);
  });
}

describe('console terminal over HttpHost', () => {
  let host: ProcessHttpHost;
  let handle: ConsoleTerminalHandle;
  let origin: string;
  let pty: ReturnType<typeof echoPty>;
  const audits: TerminalAuditEvent[] = [];

  beforeEach(async () => {
    audits.length = 0;
    pty = echoPty();
    host = createHttpHost({ host: '127.0.0.1', port: 0 });
    handle = installConsoleTerminal(host, {
      config: { enabled: true, shell: '/bin/sh', maxSessions: 2 },
      projectRoot: process.cwd(),
      authorize: (principal) => principal.id === 'user:owner',
      resolvePrincipal: (token) => TOKENS[token] ?? null,
      audit: (event) => audits.push(event),
      modules: { loadPty: async () => pty.module },
    });
    origin = (await host.listen()).origin;
  });

  afterEach(async () => {
    handle.close();
    await host.close();
  });

  const call = (method: string, path: string, token?: string, body?: unknown) => fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  it('requires a principal with ops.terminal', async () => {
    expect((await call('GET', '/api/console/terminal/targets')).status).toBe(401);
    expect((await call('GET', '/api/console/terminal/targets', 'viewer-token')).status).toBe(403);
    expect((await call('POST', '/api/console/terminal/tickets', 'viewer-token', { target: 'local' })).status).toBe(403);
    const ok = await call('GET', '/api/console/terminal/targets', 'owner-token');
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      success: true,
      data: [{ id: 'local', kind: 'local', label: '本机 Shell', available: true }],
    });
  });

  it('runs a session: ready, io, resize, exit propagation', async () => {
    const response = await call('POST', '/api/console/terminal/tickets', 'owner-token', { target: 'local', cols: 80, rows: 24 });
    expect(response.status).toBe(200);
    const { data } = await response.json() as { data: { ticket: string; expiresAt: number } };
    expect(data.expiresAt).toBeGreaterThan(Date.now());

    const wsUrl = `${origin.replace('http', 'ws')}/api/console/terminal?ticket=${encodeURIComponent(data.ticket)}`;
    const client = await openSocket(wsUrl);
    const ready = await client.next((frame) => !frame.binary);
    expect(JSON.parse(ready.text)).toMatchObject({ type: 'ready', target: 'local', kind: 'local' });

    client.ws.send(Buffer.from('ls\r'), { binary: true });
    expect((await client.next((frame) => frame.binary && frame.text.startsWith('echo'))).text).toBe('echo:ls\r');
    client.ws.send(JSON.stringify({ type: 'resize', cols: 132, rows: 43 }));
    expect((await client.next((frame) => frame.binary && frame.text.startsWith('size'))).text).toBe('size:132x43');

    client.ws.send(Buffer.from('exit\r'), { binary: true });
    const exit = await client.next((frame) => !frame.binary && frame.text.includes('"exit"'));
    expect(JSON.parse(exit.text)).toEqual({ type: 'exit', reason: 'process-exit', code: 7 });
    expect(await client.closed).toBe(1000);
    expect(audits.map((event) => event.action)).toEqual(['terminal.ticket.issue', 'terminal.session.start', 'terminal.session.end']);

    // The ticket was consumed.
    const replay = await openSocket(wsUrl);
    expect(JSON.parse((await replay.next((frame) => !frame.binary)).text)).toMatchObject({ type: 'error', code: 'invalid-ticket' });
    expect(await replay.closed).toBe(4401);
  });

  it('kills the shell when the browser disconnects and supports revocation', async () => {
    const issue = async () => ((await (await call('POST', '/api/console/terminal/tickets', 'owner-token', { target: 'local' })).json()) as { data: { ticket: string } }).data.ticket;
    const wsBase = `${origin.replace('http', 'ws')}/api/console/terminal?ticket=`;
    const first = await openSocket(wsBase + await issue());
    await first.next((frame) => !frame.binary);
    first.ws.close();
    await first.closed;
    await vi.waitFor(() => expect(pty.killed()).toBe(1));

    const second = await openSocket(wsBase + await issue());
    await second.next((frame) => !frame.binary);
    expect(handle.sessions()).toHaveLength(1);
    expect(handle.terminatePrincipal('user:owner')).toBe(1);
    const exit = await second.next((frame) => !frame.binary && frame.text.includes('"exit"'));
    expect(JSON.parse(exit.text)).toMatchObject({ type: 'exit', reason: 'revoked' });
    expect(await second.closed).toBe(1000);
  });

  it('removes the routes when closed', async () => {
    handle.close();
    expect((await call('GET', '/api/console/terminal/targets', 'owner-token')).status).toBe(404);
  });
});

const realPty = await import('node-pty' as string).catch(() => undefined);

describe.skipIf(!realPty || process.platform === 'win32')('console terminal real node-pty smoke', () => {
  it('spawns /bin/sh and echoes', async () => {
    const host = createHttpHost({ host: '127.0.0.1', port: 0 });
    const handle = installConsoleTerminal(host, {
      config: { enabled: true, shell: '/bin/sh' },
      projectRoot: process.cwd(),
      authorize: () => true,
      resolvePrincipal: () => ({ id: 'user:smoke' }),
    });
    try {
      const origin = (await host.listen()).origin;
      const response = await fetch(`${origin}/api/console/terminal/tickets`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target: 'local' }),
      });
      const { data } = await response.json() as { data: { ticket: string } };
      const client = await openSocket(`${origin.replace('http', 'ws')}/api/console/terminal?ticket=${data.ticket}`);
      await client.next((frame) => !frame.binary);
      client.ws.send(Buffer.from('echo zhin-$((40+2))\n'), { binary: true });
      await vi.waitFor(() => expect(client.frames.filter((f) => f.binary).map((f) => f.text).join('')).toContain('zhin-42'), { timeout: 5000 });
      client.ws.close();
    } finally {
      handle.close();
      await host.close();
    }
  });
});
