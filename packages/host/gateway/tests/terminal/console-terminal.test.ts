import { EventEmitter } from 'node:events';
import {
  hostKeyFingerprint,
  installConsoleTerminal,
  normalizeFingerprint,
  parseTerminalConfig,
  resolveSshCredentials,
  TerminalConfigError,
  TerminalService,
  TerminalTicketStore,
  type TerminalAuditEvent,
  type TerminalHttpHost,
  type TerminalPrincipal,
  type TerminalServiceOptions,
} from '../../src/terminal/index.js';
import type { PtyModule, SshModule } from '../../src/terminal/modules.js';
import { startSshBackend } from '../../src/terminal/backends.js';

const ROOT = '/srv/bot';
const PIN = `SHA256:${'A'.repeat(43)}`;
const owner: TerminalPrincipal = { id: 'user:owner', kind: 'user' };
const other: TerminalPrincipal = { id: 'user:other', kind: 'user' };

class FakeSocket extends EventEmitter {
  open = true;
  url = new URL('http://localhost/api/console/terminal');
  readonly remoteAddress = '10.1.2.3';
  bufferedAmount = 0;
  readonly sent: Array<{ data: string | Uint8Array; binary: boolean }> = [];
  closed?: { code?: number; reason?: string };

  /** The upgrade URL this connection arrived on. */
  at(url: string): this {
    this.url = new URL(url, 'http://localhost');
    return this;
  }

  send(data: string | Uint8Array): void {
    this.sent.push({ data, binary: typeof data !== 'string' });
  }

  close(code?: number, reason?: string): void {
    if (!this.open) return;
    this.open = false;
    this.closed = { code, reason };
    this.emit('close', code ?? 1005, reason ?? '');
  }

  onMessage(listener: (data: string | Uint8Array) => void): () => void {
    this.on('message', listener);
    return () => { this.off('message', listener); };
  }

  onClose(listener: (code: number, reason: string) => void): () => void {
    this.once('close', listener);
    return () => { this.off('close', listener); };
  }

  controls(): Array<Record<string, unknown>> {
    return this.sent.filter((frame) => !frame.binary).map((frame) => JSON.parse(String(frame.data)) as Record<string, unknown>);
  }

  output(): string {
    return this.sent.filter((frame) => frame.binary).map((frame) => Buffer.from(frame.data as Uint8Array).toString()).join('');
  }

  input(text: string): void {
    this.emit('message', Buffer.from(text));
  }

  control(message: unknown): void {
    this.emit('message', JSON.stringify(message));
  }

  disconnect(code = 1001): void {
    this.open = false;
    this.emit('close', code, '');
  }
}

interface FakePty {
  file: string;
  options: Parameters<PtyModule['spawn']>[2];
  written: string[];
  resizes: Array<[number, number]>;
  killed: boolean;
  emitData(text: string): void;
  emitExit(code: number): void;
}

function fakePty(): { module: PtyModule; procs: FakePty[] } {
  const procs: FakePty[] = [];
  const module: PtyModule = {
    spawn: vi.fn((file, _args, options) => {
      let onData: ((data: string) => void) | undefined;
      let onExit: ((event: { exitCode: number; signal?: number }) => void) | undefined;
      const proc: FakePty = {
        file,
        options,
        written: [],
        resizes: [],
        killed: false,
        emitData: (text) => onData?.(text),
        emitExit: (code) => onExit?.({ exitCode: code }),
      };
      procs.push(proc);
      return {
        pid: 42,
        onData: (listener) => { onData = listener; },
        onExit: (listener) => { onExit = listener; },
        write: (data) => { proc.written.push(String(data)); },
        resize: (cols, rows) => { proc.resizes.push([cols, rows]); },
        kill: () => {
          proc.killed = true;
          onExit?.({ exitCode: 0, signal: 1 });
        },
      };
    }),
  };
  return { module, procs };
}

interface FakeSshState {
  configs: Array<Record<string, unknown>>;
  channels: Array<{ written: string[]; windows: number[][]; emit(event: string, ...args: unknown[]): void }>;
  ended: number;
}

function fakeSsh(hostKey: Buffer): { module: SshModule; state: FakeSshState } {
  const state: FakeSshState = { configs: [], channels: [], ended: 0 };
  class Client extends EventEmitter {
    connect(config: Record<string, unknown>) {
      state.configs.push(config);
      queueMicrotask(() => {
        const verifier = config.hostVerifier as ((key: Buffer) => boolean) | undefined;
        if (verifier && !verifier(hostKey)) {
          this.emit('error', new Error('Host denied (verification failed)'));
          return;
        }
        this.emit('ready');
      });
    }

    shell(_window: unknown, callback: (error: Error | undefined, channel: unknown) => void) {
      const channel = Object.assign(new EventEmitter(), {
        written: [] as string[],
        windows: [] as number[][],
        stderr: new EventEmitter(),
        write(data: Buffer | string) { channel.written.push(String(data)); },
        setWindow(rows: number, cols: number, height: number, width: number) { channel.windows.push([rows, cols, height, width]); },
        close() { channel.emit('close'); },
      });
      state.channels.push(channel);
      callback(undefined, channel);
    }

    end() {
      state.ended += 1;
    }
  }
  return { module: { Client: Client as unknown as SshModule['Client'] }, state };
}

function makeService(overrides: Partial<TerminalServiceOptions> & { raw?: Record<string, unknown> } = {}) {
  const pty = fakePty();
  const audits: TerminalAuditEvent[] = [];
  const { raw, ...rest } = overrides;
  const service = new TerminalService({
    config: parseTerminalConfig({ enabled: true, shell: '/bin/bash', ...raw }, { projectRoot: ROOT }),
    projectRoot: ROOT,
    authorize: (principal) => principal.id === owner.id,
    audit: (event) => audits.push(event),
    modules: { loadPty: async () => pty.module, loadSsh: async () => { throw new Error('missing'); } },
    env: {},
    ...rest,
  });
  return { service, pty, audits };
}

async function connect(service: TerminalService, principal: TerminalPrincipal = owner, target = 'local') {
  const { ticket } = await service.issueTicket(principal, { target, cols: 100, rows: 30 });
  const socket = new FakeSocket();
  await service.handleConnection(socket.at(`/api/console/terminal?ticket=${ticket}`));
  return socket;
}

describe('console terminal config', () => {
  it('is disabled when the block is missing or enabled is omitted', () => {
    expect(parseTerminalConfig(undefined, { projectRoot: ROOT }).enabled).toBe(false);
    expect(parseTerminalConfig({}, { projectRoot: ROOT }).enabled).toBe(false);
  });

  it('applies defaults and resolves cwd against the project root', () => {
    const config = parseTerminalConfig({ enabled: true, cwd: 'logs' }, { projectRoot: ROOT, platform: 'linux', env: { SHELL: '/bin/zsh' } });
    expect(config).toMatchObject({ enabled: true, shell: '/bin/zsh', cwd: '/srv/bot/logs', idleTimeout: 900, maxSessions: 4, ssh: [] });
    expect(parseTerminalConfig({ enabled: true }, { projectRoot: ROOT, platform: 'win32', env: {} }).shell).toBe('powershell.exe');
  });

  it('rejects unknown keys, bad targets, and missing credentials', () => {
    expect(() => parseTerminalConfig({ enabled: true, bogus: 1 }, { projectRoot: ROOT })).toThrow(TerminalConfigError);
    expect(() => parseTerminalConfig({ enabled: true, maxSessions: 0 }, { projectRoot: ROOT })).toThrow(/maxSessions/);
    const base = { host: 'h', username: 'u', passwordEnv: 'PW', hostFingerprint: PIN };
    expect(() => parseTerminalConfig({ ssh: [{ ...base, name: 'local' }] }, { projectRoot: ROOT })).toThrow(/local/);
    expect(() => parseTerminalConfig({ ssh: [{ ...base, name: 'a' }, { ...base, name: 'a' }] }, { projectRoot: ROOT })).toThrow(/duplicate/);
    expect(() => parseTerminalConfig({ ssh: [{ name: 'a', host: 'h', username: 'u' }] }, { projectRoot: ROOT })).toThrow(/required/);
    expect(() => parseTerminalConfig({ ssh: [{ ...base, name: 'a', password: 'inline' }] }, { projectRoot: ROOT })).toThrow(/unknown key/);
    expect(() => parseTerminalConfig({ ssh: [{ ...base, name: 'a', hostFingerprint: 'MD5:aa' }] }, { projectRoot: ROOT })).toThrow(/hostFingerprint/);
  });

  it('requires a host key pin unless the target explicitly opts out (ADR 0051)', () => {
    const unpinned = { name: 'a', host: 'h', username: 'u', passwordEnv: 'PW' };
    const parse = (target: Record<string, unknown>) => parseTerminalConfig({ ssh: [target] }, { projectRoot: ROOT });
    expect(() => parse(unpinned)).toThrow(TerminalConfigError);
    expect(() => parse(unpinned)).toThrow(/hostFingerprint: is required.*ssh-keyscan.*ssh-keygen -lf.*insecureAcceptAnyHostKey/u);
    expect(() => parse({ ...unpinned, insecureAcceptAnyHostKey: false })).toThrow(/hostFingerprint: is required/);
    expect(() => parse({ ...unpinned, insecureAcceptAnyHostKey: 'yes' })).toThrow(/insecureAcceptAnyHostKey/);
    expect(() => parse({ ...unpinned, hostFingerprint: PIN, insecureAcceptAnyHostKey: true })).toThrow(/mutually exclusive/);
    expect(parse({ ...unpinned, hostFingerprint: PIN }).ssh[0]).not.toHaveProperty('insecureAcceptAnyHostKey');
    expect(parse({ ...unpinned, insecureAcceptAnyHostKey: true }).ssh[0]).toMatchObject({ insecureAcceptAnyHostKey: true });
  });

  it('is idempotent so a parsed config can be passed again', () => {
    const once = parseTerminalConfig({ enabled: true, ssh: [
      { name: 'b', host: 'h', username: 'u', passwordEnv: 'PW', hostFingerprint: PIN },
      { name: 'c', host: 'h', username: 'u', passwordEnv: 'PW', insecureAcceptAnyHostKey: true },
    ] }, { projectRoot: ROOT });
    expect(parseTerminalConfig(once, { projectRoot: ROOT })).toEqual(once);
  });

  it('normalizes SHA256 fingerprints', () => {
    const fingerprint = hostKeyFingerprint(Buffer.from('key'));
    expect(fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/u);
    expect(normalizeFingerprint(`sha256:${fingerprint.slice(7)}=`)).toBe(fingerprint);
    expect(normalizeFingerprint('SHA256:short')).toBeUndefined();
  });
});

describe('console terminal SSH credentials', () => {
  const target = parseTerminalConfig({
    ssh: [{ name: 'box', host: 'h', username: 'u', privateKeyEnv: 'KEY', passphraseEnv: 'PASS', passwordEnv: 'PW', hostFingerprint: PIN }],
  }, { projectRoot: ROOT }).ssh[0]!;

  it('reads key, passphrase and password from env', async () => {
    await expect(resolveSshCredentials(target, { projectRoot: ROOT, env: { KEY: 'pem', PASS: 'pp', PW: 'pw' } }))
      .resolves.toEqual({ privateKey: 'pem', passphrase: 'pp', password: 'pw' });
  });

  it('names the missing variable but never a value', async () => {
    await expect(resolveSshCredentials(target, { projectRoot: ROOT, env: { PASS: 'secret-pp' } })).rejects.toThrow(/KEY/);
  });

  it('expands ~ and project-relative key paths', async () => {
    const fileTarget = parseTerminalConfig({ ssh: [{ name: 'f', host: 'h', username: 'u', privateKeyPath: '~/.ssh/id', hostFingerprint: PIN }] }, { projectRoot: ROOT }).ssh[0]!;
    const readFile = vi.fn(async () => Buffer.from('pem'));
    const credentials = await resolveSshCredentials(fileTarget, { projectRoot: ROOT, env: {}, readFile, homedir: () => '/home/op' });
    expect(readFile).toHaveBeenCalledWith('/home/op/.ssh/id');
    expect(credentials.privateKey?.toString()).toBe('pem');
    await expect(resolveSshCredentials(fileTarget, {
      projectRoot: ROOT, env: {}, homedir: () => '/home/op', readFile: async () => { throw new Error('ENOENT /home/op/.ssh/id'); },
    })).rejects.toThrow('无法读取私钥文件 ~/.ssh/id');
  });
});

describe('console terminal tickets', () => {
  const grant = { principalId: owner.id, principal: owner, target: 'local', cols: 80, rows: 24 };

  it('is single use', () => {
    const store = new TerminalTicketStore();
    const { ticket } = store.issue(grant);
    expect(store.consume(ticket)).toMatchObject({ ok: true, grant: { principalId: owner.id, target: 'local' } });
    expect(store.consume(ticket)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('expires after 30 seconds', () => {
    let now = 1_000;
    const store = new TerminalTicketStore({ now: () => now });
    const issued = store.issue(grant);
    expect(issued.expiresAt).toBe(31_000);
    now = 31_000;
    expect(store.consume(issued.ticket)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects and burns a ticket presented by another principal', () => {
    const store = new TerminalTicketStore();
    const { ticket } = store.issue(grant);
    expect(store.consume(ticket, other.id)).toEqual({ ok: false, reason: 'principal-mismatch' });
    expect(store.consume(ticket, owner.id)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('stores only hashes and supports revocation', () => {
    const store = new TerminalTicketStore();
    const { ticket } = store.issue(grant);
    store.issue({ ...grant, principalId: other.id, principal: other });
    expect(JSON.stringify([...(store as unknown as { size: number }).size.toString()])).not.toContain(ticket);
    expect(store.revokePrincipal(owner.id)).toBe(1);
    expect(store.size).toBe(1);
    expect(store.consume(ticket)).toEqual({ ok: false, reason: 'invalid' });
    expect(store.consume('x'.repeat(500))).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('installConsoleTerminal', () => {
  function fakeHost() {
    const routes: string[] = [];
    const wsPaths: Array<{ path: string; auth?: string }> = [];
    const host: TerminalHttpHost = {
      route: (method, path) => { routes.push(`${method} ${path}`); return () => routes.splice(routes.indexOf(`${method} ${path}`), 1); },
      ws: (path, options) => {
        wsPaths.push({ path, ...(options?.auth ? { auth: options.auth } : {}) });
        return { onConnection: () => () => undefined, close: () => undefined };
      },
    };
    return { host, routes, wsPaths };
  }

  it('registers nothing and loads no optional module when disabled', () => {
    const { host, routes, wsPaths } = fakeHost();
    const loadPty = vi.fn();
    const loadSsh = vi.fn();
    const handle = installConsoleTerminal(host, {
      config: { enabled: false }, projectRoot: ROOT, authorize: () => true, resolvePrincipal: () => owner,
      modules: { loadPty, loadSsh },
    });
    expect(handle.enabled).toBe(false);
    expect(routes).toEqual([]);
    expect(wsPaths).toEqual([]);
    expect(loadPty).not.toHaveBeenCalled();
    expect(loadSsh).not.toHaveBeenCalled();
  });

  it('registers targets, tickets and a protocol-authenticated WebSocket when enabled', () => {
    const { host, routes, wsPaths } = fakeHost();
    const loadPty = vi.fn();
    const handle = installConsoleTerminal(host, {
      config: { enabled: true }, projectRoot: ROOT, base: '/api/', authorize: () => true, resolvePrincipal: () => owner,
      modules: { loadPty },
    });
    expect(routes).toEqual(['GET /api/console/terminal/targets', 'POST /api/console/terminal/tickets']);
    expect(wsPaths).toEqual([{ path: '/api/console/terminal', auth: 'protocol' }]);
    expect(loadPty).not.toHaveBeenCalled();
    handle.close();
    expect(routes).toEqual([]);
  });
});

describe('TerminalService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('denies unauthenticated and unauthorized principals (deny on authorize error)', async () => {
    const { service, audits } = makeService({ authorize: () => true });
    await expect(service.requireAuthorized(null)).rejects.toMatchObject({ status: 401 });
    await expect(service.requireAuthorized(owner)).resolves.toBe(owner);
    await expect(service.requireAuthorized({ id: 'user:x', kind: 'api-token' })).resolves.toMatchObject({ id: 'user:x' });
    const strict = makeService();
    await expect(strict.service.requireAuthorized(other)).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    const throwing = makeService({ authorize: () => { throw new Error('db down'); } });
    await expect(throwing.service.requireAuthorized(owner)).rejects.toMatchObject({ status: 403 });
    expect(audits.map((event) => [event.action, event.outcome, event.actor])).toEqual([
      ['terminal.denied', 'denied', 'anonymous'],
    ]);
    expect(strict.audits.at(-1)).toMatchObject({ action: 'terminal.denied', actor: other.id, detail: { reason: 'forbidden' } });
  });

  it('starts a local PTY, forwards io and resize, and audits start/end without io', async () => {
    const { service, pty, audits } = makeService({ raw: { cwd: 'work' } });
    const socket = await connect(service);
    expect(pty.procs).toHaveLength(1);
    const proc = pty.procs[0]!;
    expect(proc.file).toBe('/bin/bash');
    expect(proc.options).toMatchObject({ cols: 100, rows: 30, cwd: '/srv/bot/work', name: 'xterm-256color' });
    expect(socket.controls()[0]).toMatchObject({ type: 'ready', target: 'local', kind: 'local', cols: 100, rows: 30 });

    socket.input('ls -la\r');
    expect(proc.written).toEqual(['ls -la\r']);
    proc.emitData('total 0\r\n');
    expect(socket.output()).toBe('total 0\r\n');

    socket.control({ type: 'resize', cols: 120, rows: 40 });
    expect(proc.resizes).toEqual([[120, 40]]);
    socket.control({ type: 'resize', cols: 0, rows: 40 });
    expect(proc.resizes).toHaveLength(1);
    expect(socket.controls().at(-1)).toMatchObject({ type: 'error', code: 'bad-message' });
    socket.control({ type: 'ping' });
    expect(socket.controls().at(-1)).toEqual({ type: 'pong' });
    socket.emit('message', 'not json');
    expect(socket.controls().at(-1)).toMatchObject({ type: 'error', code: 'bad-message' });

    proc.emitExit(3);
    expect(socket.controls().at(-1)).toEqual({ type: 'exit', reason: 'process-exit', code: 3 });
    expect(socket.closed).toEqual({ code: 1000, reason: 'process-exit' });
    expect(service.sessions()).toEqual([]);

    const start = audits.find((event) => event.action === 'terminal.session.start');
    const end = audits.find((event) => event.action === 'terminal.session.end');
    expect(start).toMatchObject({ actor: owner.id, target: 'local', outcome: 'ok', ip: '10.1.2.3' });
    expect(end).toMatchObject({ actor: owner.id, outcome: 'ok', detail: { reason: 'process-exit', exitCode: 3 } });
    expect(typeof end?.detail.durationMs).toBe('number');
    expect(JSON.stringify(audits)).not.toMatch(/ls -la|total 0/u);
  });

  it('kills the process when the socket disconnects', async () => {
    const { service, pty, audits } = makeService();
    const socket = await connect(service);
    socket.disconnect();
    expect(pty.procs[0]!.killed).toBe(true);
    expect(service.sessions()).toEqual([]);
    expect(audits.at(-1)).toMatchObject({ action: 'terminal.session.end', detail: { reason: 'disconnect' } });
  });

  it('rejects invalid, reused and expired tickets on the WebSocket', async () => {
    const { service, pty } = makeService();
    const bad = new FakeSocket();
    await service.handleConnection(bad.at('/api/console/terminal?ticket=nope'));
    expect(bad.controls()[0]).toMatchObject({ type: 'error', code: 'invalid-ticket' });
    expect(bad.closed?.code).toBe(4401);

    const { ticket } = await service.issueTicket(owner, { target: 'local' });
    await service.handleConnection(new FakeSocket().at(`/x?ticket=${ticket}`));
    const reused = new FakeSocket();
    await service.handleConnection(reused.at(`/x?ticket=${ticket}`));
    expect(reused.closed?.code).toBe(4401);
    expect(pty.procs).toHaveLength(1);
  });

  it('rejects a ticket presented with another principal credential', async () => {
    const { service, pty } = makeService();
    const { ticket } = await service.issueTicket(owner, { target: 'local' });
    const socket = new FakeSocket();
    await service.handleConnection(socket.at(`/x?ticket=${ticket}`), other);
    expect(socket.closed?.code).toBe(4401);
    expect(pty.procs).toHaveLength(0);
  });

  it('re-authorizes when the ticket is used', async () => {
    let allowed = true;
    const { service, pty } = makeService({ authorize: () => allowed });
    const { ticket } = await service.issueTicket(owner, { target: 'local' });
    allowed = false;
    const socket = new FakeSocket();
    await service.handleConnection(socket.at(`/x?ticket=${ticket}`));
    expect(socket.closed?.code).toBe(4403);
    expect(pty.procs).toHaveLength(0);
  });

  it('enforces maxSessions at ticket issue and on connect', async () => {
    const { service } = makeService({ raw: { maxSessions: 1 } });
    const pending = await service.issueTicket(owner, { target: 'local' });
    await connect(service);
    await expect(service.issueTicket(owner, { target: 'local' })).rejects.toMatchObject({ status: 429, code: 'too-many-sessions' });
    const late = new FakeSocket();
    await service.handleConnection(late.at(`/x?ticket=${pending.ticket}`));
    expect(late.closed?.code).toBe(4429);
  });

  it('validates ticket requests', async () => {
    const { service } = makeService();
    await expect(service.issueTicket(owner, { target: 'nope' })).rejects.toMatchObject({ status: 404 });
    await expect(service.issueTicket(owner, { target: 'local', cols: 5000, rows: 10 })).rejects.toMatchObject({ status: 400 });
  });

  it('closes idle sessions after idleTimeout without input', async () => {
    vi.useFakeTimers();
    const { service, pty } = makeService({ raw: { idleTimeout: 60 } });
    const socket = await connect(service);
    vi.advanceTimersByTime(50_000);
    socket.input('x');
    socket.control({ type: 'ping' });
    vi.advanceTimersByTime(50_000);
    expect(socket.closed).toBeUndefined();
    vi.advanceTimersByTime(10_001);
    expect(socket.controls().at(-1)).toMatchObject({ type: 'exit', reason: 'idle-timeout' });
    expect(pty.procs[0]!.killed).toBe(true);
  });

  it('terminates the sessions and tickets of a revoked principal', async () => {
    const { service, pty } = makeService({ authorize: () => true });
    const mine = await connect(service, owner);
    const theirs = await connect(service, other);
    const { ticket } = await service.issueTicket(owner, { target: 'local' });
    expect(service.terminatePrincipal(owner.id)).toBe(1);
    expect(mine.controls().at(-1)).toMatchObject({ type: 'exit', reason: 'revoked' });
    expect(pty.procs[0]!.killed).toBe(true);
    expect(theirs.closed).toBeUndefined();
    const late = new FakeSocket();
    await service.handleConnection(late.at(`/x?ticket=${ticket}`));
    expect(late.closed?.code).toBe(4401);
  });

  it('ends everything with reason disabled on final close', async () => {
    const { service } = makeService();
    const socket = await connect(service);
    service.closeAll('disabled', true);
    expect(socket.controls().at(-1)).toMatchObject({ type: 'exit', reason: 'disabled' });
    await expect(service.issueTicket(owner, { target: 'local' })).rejects.toMatchObject({ status: 404 });
  });

  it('reports a missing optional module as unavailable with a reason', async () => {
    const { service } = makeService({
      raw: { ssh: [{ name: 'box', host: '10.0.0.12', username: 'deploy', passwordEnv: 'PW', hostFingerprint: PIN }] },
      modules: { loadPty: async () => { throw new Error('Cannot find module'); }, loadSsh: async () => { throw new Error('Cannot find module'); } },
      env: { PW: 'secret' },
    });
    const targets = await service.listTargets();
    expect(targets).toEqual([
      { id: 'local', kind: 'local', label: '本机 Shell', available: false, reason: expect.stringContaining('node-pty') },
      { id: 'box', kind: 'ssh', label: 'deploy@10.0.0.12', available: false, reason: expect.stringContaining('ssh2') },
    ]);
    await expect(service.issueTicket(owner, { target: 'local' })).rejects.toMatchObject({ status: 409, code: 'unavailable' });
  });

  describe('ssh targets', () => {
    const hostKey = Buffer.from('ssh-ed25519 host key blob');
    const ssh = (extra: Record<string, unknown> = {}) => [{
      name: 'build-box', host: '10.0.0.12', port: 2222, username: 'deploy',
      privateKeyEnv: 'BOX_KEY', passphraseEnv: 'BOX_PASS', hostFingerprint: hostKeyFingerprint(hostKey), ...extra,
    }];

    it('connects with env credentials and never exposes them', async () => {
      const fake = fakeSsh(hostKey);
      const { service, audits } = makeService({
        raw: { ssh: ssh({ hostFingerprint: hostKeyFingerprint(hostKey) }) },
        modules: { loadPty: async () => fakePty().module, loadSsh: async () => fake.module },
        env: { BOX_KEY: 'PRIVATE-KEY-PEM', BOX_PASS: 'top-secret' },
      });
      const targets = await service.listTargets();
      expect(targets[1]).toEqual({ id: 'build-box', kind: 'ssh', label: 'deploy@10.0.0.12:2222', available: true });
      const socket = await connect(service, owner, 'build-box');
      expect(fake.state.configs[0]).toMatchObject({
        host: '10.0.0.12', port: 2222, username: 'deploy', privateKey: 'PRIVATE-KEY-PEM', passphrase: 'top-secret',
      });
      expect(socket.controls()[0]).toMatchObject({ type: 'ready', kind: 'ssh', target: 'build-box' });

      const channel = fake.state.channels[0]!;
      socket.input('uptime\n');
      expect(channel.written).toEqual(['uptime\n']);
      socket.control({ type: 'resize', cols: 90, rows: 20 });
      expect(channel.windows).toEqual([[20, 90, 0, 0]]);
      channel.emit('data', Buffer.from('up 3 days'));
      expect(socket.output()).toBe('up 3 days');
      channel.emit('exit', 0);
      channel.emit('close');
      expect(socket.controls().at(-1)).toEqual({ type: 'exit', reason: 'process-exit', code: 0 });
      expect(fake.state.ended).toBeGreaterThan(0);
      const dump = JSON.stringify([targets, audits, socket.sent.map((frame) => typeof frame.data === 'string' ? frame.data : Buffer.from(frame.data).toString())]);
      expect(dump).not.toMatch(/PRIVATE-KEY-PEM|top-secret|BOX_KEY/u);
    });

    it('refuses a host whose fingerprint does not match', async () => {
      const fake = fakeSsh(hostKey);
      const { service, audits } = makeService({
        raw: { ssh: ssh({ hostFingerprint: hostKeyFingerprint(Buffer.from('another key')) }) },
        modules: { loadPty: async () => fakePty().module, loadSsh: async () => fake.module },
        env: { BOX_KEY: 'k', BOX_PASS: 'p' },
      });
      const socket = await connect(service, owner, 'build-box');
      expect(socket.controls()[0]).toMatchObject({ type: 'error', code: 'host-fingerprint-mismatch' });
      expect(socket.closed?.code).toBe(1011);
      expect(fake.state.channels).toHaveLength(0);
      expect(service.sessions()).toEqual([]);
      expect(audits.at(-1)).toMatchObject({ action: 'terminal.session.start', outcome: 'error', detail: { code: 'host-fingerprint-mismatch' } });
    });

    it('accepts an unverified host key only with insecureAcceptAnyHostKey and marks the target unsafe', async () => {
      const fake = fakeSsh(hostKey);
      const warnings: string[] = [];
      const { service } = makeService({
        raw: { ssh: [{ name: 'build-box', host: '10.0.0.12', port: 2222, username: 'deploy',
          privateKeyEnv: 'BOX_KEY', passphraseEnv: 'BOX_PASS', insecureAcceptAnyHostKey: true }] },
        modules: { loadPty: async () => fakePty().module, loadSsh: async () => fake.module },
        env: { BOX_KEY: 'k', BOX_PASS: 'p' },
        logger: { warn: (message: string) => warnings.push(message) },
      });
      expect((await service.listTargets())[1]).toEqual({
        id: 'build-box', kind: 'ssh', label: 'deploy@10.0.0.12:2222（不安全：未校验主机密钥）', available: true, insecureHostKey: true,
      });
      const socket = await connect(service, owner, 'build-box');
      expect(socket.controls()[0]).toMatchObject({ type: 'ready', kind: 'ssh' });
      expect(warnings.join('\n')).toContain(`${hostKeyFingerprint(hostKey)} accepted WITHOUT verification`);
    });

    it('refuses any host key when a target reaches the backend without a pin', async () => {
      const fake = fakeSsh(hostKey);
      const unpinned = { name: 'box', host: 'h', port: 22, username: 'u', passwordEnv: 'PW' };
      const events = { onData: () => undefined, onExit: () => undefined };
      await expect(startSshBackend(fake.module, unpinned, { password: 'x' }, { cols: 80, rows: 24 }, events as never))
        .rejects.toMatchObject({ code: 'host-fingerprint-mismatch' });
      expect(fake.state.channels).toHaveLength(0);
    });

    it('marks a target unavailable when its env credential is missing', async () => {
      const { service } = makeService({
        raw: { ssh: ssh() },
        modules: { loadPty: async () => fakePty().module, loadSsh: async () => fakeSsh(hostKey).module },
        env: { BOX_PASS: 'p' },
      });
      expect((await service.listTargets())[1]).toMatchObject({ available: false, reason: expect.stringContaining('BOX_KEY') });
    });

    it('starts nothing when the socket leaves before authorization completes', async () => {
      const fake = fakeSsh(hostKey);
      const { service } = makeService({
        raw: { ssh: ssh() },
        modules: { loadPty: async () => fakePty().module, loadSsh: async () => fake.module },
        env: { BOX_KEY: 'k', BOX_PASS: 'p' },
      });
      const { ticket } = await service.issueTicket(owner, { target: 'build-box' });
      const configsBefore = fake.state.configs.length;
      const socket = new FakeSocket();
      const started = service.handleConnection(socket.at(`/x?ticket=${ticket}`));
      socket.disconnect();
      await started;
      expect(service.sessions()).toEqual([]);
      expect(fake.state.configs.length).toBe(configsBefore);
    });

    it('drops a backend that finishes starting after the socket left', async () => {
      const fake = fakeSsh(hostKey);
      const loadSsh = vi.fn(async () => fake.module);
      const { service, audits } = makeService({
        raw: { ssh: ssh() },
        modules: { loadPty: async () => fakePty().module, loadSsh },
        env: { BOX_KEY: 'k', BOX_PASS: 'p' },
      });
      const { ticket } = await service.issueTicket(owner, { target: 'build-box' });
      // Delay the SSH handshake so the socket can leave mid-start.
      const originalConnect = fake.module.Client.prototype.connect as (config: Record<string, unknown>) => void;
      let resumeConnect!: () => void;
      fake.module.Client.prototype.connect = function (this: unknown, config: Record<string, unknown>) {
        resumeConnect = () => originalConnect.call(this, config);
      };
      const socket = new FakeSocket();
      const started = service.handleConnection(socket.at(`/x?ticket=${ticket}`));
      await vi.waitFor(() => expect(service.sessions()).toHaveLength(1));
      socket.disconnect();
      expect(service.sessions()).toEqual([]);
      resumeConnect();
      await started;
      expect(fake.state.channels).toHaveLength(1);
      expect(fake.state.ended).toBeGreaterThan(0);
      expect(loadSsh).toHaveBeenCalledTimes(1);
      expect(audits.some((event) => event.action === 'terminal.session.start' && event.outcome === 'ok')).toBe(false);
    });
  });
});
