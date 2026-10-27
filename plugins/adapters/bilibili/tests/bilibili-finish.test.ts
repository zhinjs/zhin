import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capabilityId, featureId, rootPluginId, PluginConsoleRpcError } from 'zhin.js';
import { bindTestEndpoint } from '../../test-utils/endpoint.js';
import { BilibiliDraftQueue } from '../src/drafts.js';
import { BilibiliEndpoint, type BilibiliNotice } from '../src/endpoint.js';
import { resolveBilibiliConfig, BILIBILI_DEFAULT_DATA_DIR } from '../src/protocol.js';
import { credentialsFromLoginUrl } from '../src/login.js';
import { BilibiliStateFiles, endpointDirectoryName } from '../src/storage.js';
import { createBilibiliConsoleRpc } from '../src/console.js';
import { formatNotice } from '../src/review.js';
import { loginStatusText, startLoginForChat } from '../src/login-text.js';
import type { BilibiliFetch } from '../src/client.js';

const endpointId = capabilityId(rootPluginId(), featureId('zhin.adapter'), 'bilibili-finish');
const AID = 170001;
const thread = { endpoint: { id: 'e', adapter: 'bilibili' }, kind: 'channel' as const, id: `video:${AID}:1` };
const SIGNAL = { signal: new AbortController().signal };

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bili-finish-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const loginUrl = (sessdata = 'qr%2Csess', jct = 'qr-jct') =>
  `https://passport.biligame.com/x/passport-login/web/crossDomain?DedeUserID=4242&DedeUserID__ckMd5=x&Expires=${Math.floor(Date.now() / 1000) + 86400 * 30}&SESSDATA=${sessdata}&bili_jct=${jct}&gourl=https%3A%2F%2Fwww.bilibili.com`;

interface FakeState {
  /** SESSDATA → nav result. Unknown cookies are logged out. */
  valid: Set<string>;
  pollCodes: number[];
  addCode?: number;
  cookies: string[];
  posts: Array<Record<string, string>>;
  generated: number;
}

function fake(state: Partial<FakeState> = {}) {
  const s: FakeState = { valid: new Set(['config-sess', 'qr,sess']), pollCodes: [86101, 86090, 0], cookies: [], posts: [], generated: 0, ...state };
  let poll = 0;
  const fetch: BilibiliFetch = vi.fn(async (url: string, init) => {
    const ok = (data: unknown, code = 0) => ({ ok: true, status: 200, json: async () => ({ code, data }) });
    const cookie = init?.headers?.Cookie ?? '';
    s.cookies.push(cookie);
    const sess = /SESSDATA=([^;]+)/.exec(cookie)?.[1];
    if (url.includes('/qrcode/generate')) { s.generated += 1; return ok({ url: 'https://account.bilibili.com/h5/account-h5/auth/scan-web?qrcode_key=k1', qrcode_key: 'k1' }); }
    if (url.includes('/qrcode/poll')) {
      const code = s.pollCodes[Math.min(poll++, s.pollCodes.length - 1)]!;
      return ok({ code, url: code === 0 ? loginUrl() : '' });
    }
    if (url.includes('/x/web-interface/nav')) {
      return sess && s.valid.has(sess) ? ok({ isLogin: true, mid: sess === 'config-sess' ? 99 : 4242, uname: sess === 'config-sess' ? 'cfg' : 'qr-user' }) : ok({ isLogin: false }, -101);
    }
    if (url.includes('/x/v2/reply/add')) {
      s.posts.push(Object.fromEntries(new URLSearchParams(init?.body ?? '')));
      if (s.addCode) return ok(null, s.addCode);
      return ok({ rpid_str: '9001' });
    }
    if (url.includes('/x/v2/reply?')) return ok({ replies: [] });
    if (url.includes('/x/web-interface/view')) return ok({ aid: AID });
    throw new Error(`unexpected ${url}`);
  });
  return { fetch, state: s };
}

function endpointFor(fetch: BilibiliFetch, config: Record<string, unknown> = {}, notify?: (notice: BilibiliNotice) => void) {
  const registry = new Map<string, BilibiliEndpoint>();
  const endpoint = bindTestEndpoint(new BilibiliEndpoint({
    id: endpointId, autoPoll: false, fetch, registry, stateDir: dir,
    config: resolveBilibiliConfig({ id: 'bili', videos: ['BV1xx411c7mD'], passportBaseUrl: 'https://passport.test', ...config }),
    ...(notify ? { notify } : {}),
  }), { receive: vi.fn(async () => undefined) });
  registry.set('bili', endpoint);
  return { endpoint, registry };
}

async function queue(endpoint: BilibiliEndpoint, text = '感谢支持'): Promise<string> {
  await endpoint.send({ conversation: thread, payload: text }).catch(() => undefined);
  return endpoint.drafts.list().at(-1)!.id;
}

describe('draft persistence', () => {
  it('survives a restart, keeps ids unique and marks interrupted sends', () => {
    const file = join(dir, 'drafts.json');
    const first = new BilibiliDraftQueue({ file });
    const a = first.add({ oid: '1', root: '2', parent: '2', message: 'a', context: { author: 'x', text: 'y' } }, 1000);
    const b = first.add({ oid: '1', root: '2', parent: '3', message: 'b' }, 1000);
    first.update(b.id, { status: 'sending' });
    expect(statSync(file).mode & 0o777).toBe(0o600);

    const second = new BilibiliDraftQueue({ file });
    expect(second.list().map(d => d.id)).toEqual([a.id, b.id]);
    expect(second.get(a.id)).toMatchObject({ message: 'a', context: { author: 'x', text: 'y' }, status: 'pending' });
    expect(second.get(a.id)?.interrupted).toBeUndefined();
    expect(second.get(b.id)).toMatchObject({ status: 'pending', interrupted: true });
    const c = second.add({ oid: '1', root: '2', parent: '2', message: 'c' }, 1000);
    expect([a.id, b.id]).not.toContain(c.id);
    expect(second.update(b.id, { message: 'checked' })?.interrupted).toBeUndefined();
    second.discard(a.id);

    const third = new BilibiliDraftQueue({ file });
    expect(third.list().map(d => d.id)).toEqual([b.id, c.id]);
  });

  it('evicts the oldest drafts beyond capacity and ignores corrupt files', () => {
    const file = join(dir, 'drafts.json');
    const queue = new BilibiliDraftQueue({ file, capacity: 2 });
    const ids = ['a', 'b', 'c'].map(message => queue.add({ oid: '1', root: '1', parent: '1', message }).id);
    expect(new BilibiliDraftQueue({ file, capacity: 2 }).list().map(d => d.id)).toEqual(ids.slice(1));
    writeFileSync(file, '{not json');
    expect(new BilibiliDraftQueue({ file }).size).toBe(0);
    writeFileSync(file, JSON.stringify({ version: 1, seq: 3, drafts: [{ id: '../x', oid: 'a' }, { id: 'ok1', oid: '1', root: '1', parent: '1', message: 'm', createdAt: 1 }] }));
    expect(new BilibiliDraftQueue({ file }).list().map(d => d.id)).toEqual(['ok1']);
  });

  it('restores endpoint drafts from the data directory', async () => {
    const { fetch } = fake();
    const first = endpointFor(fetch, { sessdata: 'config-sess', biliJct: 'c' }).endpoint;
    const id = await queue(first, '重启后还在');
    first.stop();
    const files = new BilibiliStateFiles(dir, 'bili');
    expect(existsSync(files.draftsFile)).toBe(true);
    const second = endpointFor(fetch, { sessdata: 'config-sess', biliJct: 'c' }).endpoint;
    expect(second.persistent).toBe(true);
    expect(second.drafts.get(id)?.message).toBe('重启后还在');
    await second.approveDraft(id);
    expect(endpointFor(fetch).endpoint.drafts.size).toBe(0);
  });

  it('uses data/bilibili by default and safe directory names', () => {
    expect(resolveBilibiliConfig({ id: 'x' }).dataDir).toBe(BILIBILI_DEFAULT_DATA_DIR);
    expect(endpointDirectoryName('我的 账号/1')).toBe('______1');
    expect(() => endpointDirectoryName('..')).toThrow();
  });
});

describe('QR login and cookie persistence', () => {
  it('parses cookies from the login redirect without the rest of the URL', () => {
    const credentials = credentialsFromLoginUrl(loginUrl(), 1_000);
    expect(credentials).toMatchObject({ sessdata: 'qr,sess', biliJct: 'qr-jct', mid: '4242', obtainedAt: 1_000 });
    expect(credentials?.expiresAt).toBeGreaterThan(Date.now());
    expect(credentialsFromLoginUrl(loginUrl(), 1_000, ' rt-token ')).toMatchObject({ refreshToken: 'rt-token' });
    expect(credentialsFromLoginUrl(loginUrl(), 1_000)).not.toHaveProperty('refreshToken');
    expect(credentialsFromLoginUrl('https://x.test/?SESSDATA=a')).toBeUndefined();
    expect(credentialsFromLoginUrl('not a url')).toBeUndefined();
  });

  it('logs in by QR, persists credentials 0600 and reuses them after restart', async () => {
    const { fetch, state } = fake();
    const notices: BilibiliNotice[] = [];
    const { endpoint, registry } = endpointFor(fetch, {}, notice => { notices.push(notice); });
    await endpoint.start();
    expect(endpoint.login.state).toBe('none');

    const qr = await endpoint.startQrLogin();
    expect(qr.state).toBe('waiting');
    expect(qr.image).toMatch(/^data:image\/png;base64,/);
    expect(await endpoint.startQrLogin()).toBe(qr); // reuse a live QR code
    expect(state.generated).toBe(1);
    expect((await endpoint.pollQrLoginOnce()).state).toBe('waiting');
    expect((await endpoint.pollQrLoginOnce()).state).toBe('scanned');
    expect((await endpoint.pollQrLoginOnce()).state).toBe('confirmed');
    expect(endpoint.login).toMatchObject({ state: 'ok', source: 'qr', mid: '4242', uname: 'qr-user' });
    await vi.waitFor(() => expect(notices.map(n => n.kind)).toContain('login_ok'));

    const files = new BilibiliStateFiles(dir, 'bili');
    expect(statSync(files.credentialsFile).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(files.credentialsFile, 'utf8'))).toMatchObject({ sessdata: 'qr,sess', biliJct: 'qr-jct', mid: '4242' });
    expect(loginStatusText(registry)).toContain('qr-user');

    const id = await queue(endpoint);
    await endpoint.approveDraft(id);
    expect(state.posts[0]?.csrf).toBe('qr-jct');
    endpoint.stop();

    const restarted = endpointFor(fetch).endpoint;
    await restarted.start();
    expect(restarted.login).toMatchObject({ state: 'ok', source: 'qr', mid: '4242' });
    expect(state.cookies.at(-1)).toContain('SESSDATA=qr,sess');
    expect(await restarted.logout()).toBe(true);
    expect(existsSync(files.credentialsFile)).toBe(false);
    expect(restarted.login.state).toBe('none');
    restarted.stop();
  });

  it('prefers configured cookies, and falls back to the stored QR login when they expire', async () => {
    const { fetch } = fake();
    const files = new BilibiliStateFiles(dir, 'bili');
    mkdirSync(files.directory, { recursive: true });
    writeFileSync(files.credentialsFile, JSON.stringify({ sessdata: 'qr,sess', biliJct: 'qr-jct' }));

    const configured = endpointFor(fetch, { sessdata: 'config-sess', biliJct: 'c' }).endpoint;
    await configured.start();
    expect(configured.login).toMatchObject({ state: 'ok', source: 'config', uname: 'cfg' });
    expect(await configured.logout()).toBe(false);
    configured.stop();

    const stale = endpointFor(fetch, { sessdata: 'stale', biliJct: 'c' }).endpoint;
    await stale.start();
    expect(stale.login).toMatchObject({ state: 'ok', source: 'qr' });
    stale.stop();
  });

  it('clears an expired stored login and tells the master to scan again', async () => {
    const { fetch, state } = fake();
    const files = new BilibiliStateFiles(dir, 'bili');
    mkdirSync(files.directory, { recursive: true });
    writeFileSync(files.credentialsFile, JSON.stringify({ sessdata: 'gone', biliJct: 'x' }));
    const expiredAtStart = endpointFor(fetch).endpoint;
    await expiredAtStart.start();
    expect(expiredAtStart.login).toMatchObject({ state: 'expired', source: 'qr' });
    expect(existsSync(files.credentialsFile)).toBe(false);
    expiredAtStart.stop();

    // Valid at start, then the platform answers -101 when sending.
    writeFileSync(files.credentialsFile, JSON.stringify({ sessdata: 'qr,sess', biliJct: 'qr-jct' }));
    const notices: BilibiliNotice[] = [];
    const { endpoint } = endpointFor(fetch, {}, notice => { notices.push(notice); });
    await endpoint.start();
    const id = await queue(endpoint);
    state.addCode = -101;
    await expect(endpoint.approveDraft(id)).rejects.toMatchObject({ code: 'no_cookie' });
    expect(endpoint.login).toMatchObject({ state: 'expired', source: 'qr' });
    expect(endpoint.drafts.get(id)?.status).toBe('pending');
    expect(existsSync(files.credentialsFile)).toBe(false);
    await vi.waitFor(() => expect(notices.map(n => n.kind)).toEqual(['draft', 'login_expired']));
    expect(formatNotice(notices[1]!)).toContain('扫码重新登录');
    await expect(endpoint.approveDraft(id)).rejects.toMatchObject({ code: 'no_cookie' });
    endpoint.stop();
  });

  it('reports expired and failed QR codes', async () => {
    const { fetch } = fake({ pollCodes: [86038] });
    const { endpoint } = endpointFor(fetch);
    await endpoint.startQrLogin();
    expect((await endpoint.pollQrLoginOnce()).state).toBe('expired');
    endpoint.cancelQrLogin();
    expect(endpoint.qrLogin.state).toBe('idle');
    const broken = fake({ pollCodes: [-412] });
    const other = endpointFor(broken.fetch).endpoint;
    await other.startQrLogin();
    expect(await other.pollQrLoginOnce()).toMatchObject({ state: 'failed' });
  });

  it('only sends the login QR code in private chats', async () => {
    const { fetch } = fake();
    const { registry } = endpointFor(fetch);
    expect(await startLoginForChat(registry, { isPrivate: false })).toMatchObject({ kind: 'text' });
    const result = await startLoginForChat(registry, { isPrivate: true, statusCommand: 'bili-login status' });
    expect(result).toMatchObject({ kind: 'qr', hint: expect.stringContaining('bili-login status') });
  });
});

describe('new draft notices', () => {
  it('pushes each new draft with the review hint', async () => {
    const { fetch } = fake();
    const notices: BilibiliNotice[] = [];
    const { endpoint } = endpointFor(fetch, { sessdata: 'config-sess', biliJct: 'c' }, notice => { notices.push(notice); });
    const id = await queue(endpoint, '谢谢喜欢');
    await vi.waitFor(() => expect(notices).toHaveLength(1));
    const text = formatNotice(notices[0]!, { formatCommand: path => path });
    expect(text).toContain(`[${id}]`);
    expect(text).toContain('谢谢喜欢');
    expect(text).toContain(`bili-draft send ${id}`);
    expect(formatNotice(notices[0]!, { locale: 'en' })).toContain('Comment review');
  });

  it('a failing notifier never loses the draft', async () => {
    const { fetch } = fake();
    const { endpoint } = endpointFor(fetch, {}, () => { throw new Error('offline'); });
    const id = await queue(endpoint);
    expect(endpoint.drafts.get(id)).toBeDefined();
  });

  it('validates the notify target', () => {
    expect(resolveBilibiliConfig({ id: 'x', notify: { adapter: 'icqq', endpoint: 'bot', id: 10001 } }).notify)
      .toEqual({ adapter: 'icqq', endpoint: 'bot', kind: 'private', id: '10001' });
    expect(() => resolveBilibiliConfig({ id: 'x', notify: { adapter: 'icqq', endpoint: '', id: 1 } })).toThrow(/notify/);
  });
});

describe('Console review RPC', () => {
  it('shows status without secrets and runs send / edit / drop / login', async () => {
    const { fetch, state } = fake();
    const { endpoint, registry } = endpointFor(fetch, { sessdata: 'config-sess', biliJct: 'secret-jct' });
    await endpoint.start();
    const rpc = createBilibiliConsoleRpc(registry);
    const run = (name: string, input: Record<string, unknown> = {}) => rpc.methods.get(name)!.handler(input as never, SIGNAL);

    expect(rpc.methods.get('status')!.requiredPermissions).toEqual(['bilibili:read']);
    for (const name of ['send', 'edit', 'drop']) expect(rpc.methods.get(name)!.requiredPermissions).toEqual(['bilibili:review']);
    for (const name of ['login', 'login-cancel', 'logout']) expect(rpc.methods.get(name)!.requiredPermissions).toEqual(['bilibili:login']);

    const first = await queue(endpoint, '初稿');
    const second = await queue(endpoint, '丢掉');
    const status = await run('status') as { endpoints: Array<Record<string, unknown>> };
    const json = JSON.stringify(status);
    expect(json).not.toContain('config-sess');
    expect(json).not.toContain('secret-jct');
    expect(status.endpoints[0]).toMatchObject({
      id: 'bili', sendMode: 'review', persistent: true, pendingCount: 2,
      login: { state: 'ok', source: 'config', uname: 'cfg' },
      videos: [{ ref: 'BV1xx411c7mD', url: 'https://www.bilibili.com/video/BV1xx411c7mD', aid: String(AID) }],
    });
    expect((status.endpoints[0]!.drafts as Array<{ id: string }>).map(d => d.id)).toEqual([second, first]);

    expect(await run('edit', { id: first, message: '  终稿 ' })).toEqual({ id: first, message: '终稿' });
    await expect(run('edit', { id: first, message: '' })).rejects.toBeInstanceOf(PluginConsoleRpcError);
    expect(await run('send', { id: first })).toEqual({ id: first, url: `https://www.bilibili.com/video/av${AID}#reply9001` });
    expect(state.posts[0]).toMatchObject({ message: '终稿', csrf: 'secret-jct' });
    await expect(run('send', { id: second })).rejects.toMatchObject({ code: 'conflict' });
    expect(await run('drop', { id: second })).toEqual({ id: second, dropped: true });
    await expect(run('send', { id: second })).rejects.toMatchObject({ code: 'not_found' });
    await expect(run('send', {})).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(run('logout', {})).rejects.toMatchObject({ code: 'unsupported' });

    const login = await run('login', { endpoint: 'bili' }) as { state: string; image: string };
    expect(login.state).toBe('waiting');
    expect(login.image).toMatch(/^data:image\/png;base64,/);
    expect(await run('login-cancel', {})).toEqual({ state: 'idle' });
    await expect(run('login', { endpoint: 'nope' })).rejects.toMatchObject({ code: 'not_found' });
    endpoint.stop();
  });

  it('reports a missing adapter plainly', async () => {
    const rpc = createBilibiliConsoleRpc(new Map());
    expect(await rpc.methods.get('status')!.handler({}, SIGNAL)).toMatchObject({ endpoints: [] });
    await expect(rpc.methods.get('login')!.handler({}, SIGNAL)).rejects.toMatchObject({ code: 'unavailable' });
  });
});

it('ships the Console page with the page feature', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(manifest.files).toContain('pages');
  expect(manifest.zhin.features).toContainEqual({ package: '@zhin.js/page', api: '^1.0.0' });
});
