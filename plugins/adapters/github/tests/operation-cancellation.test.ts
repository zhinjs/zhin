import { generateKeyPairSync } from 'node:crypto';
import { once } from 'node:events';
import { watch } from 'node:fs';
import { onTestFinished } from 'vitest';
import { GhClient } from '../src/gh-client.js';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { capabilityId, rootPluginId } from 'zhin.js';
import { adapterFeatureId } from 'zhin.js/adapter';
import { createEndpointHarness } from '../../test-utils/endpoint.js';
import { GithubEndpoint } from '../src/endpoint.js';
import { buildChannelId, resolveGithubConfig } from '../src/protocol.js';

it.each(['issue', 'pr'] as const)('cancels the actual gh subprocess for %s without stopping the account or retrying', async kind => {
  const directory = await mkdtemp(path.join(tmpdir(), 'github-gh-cancel-')), marker = path.join(directory, 'calls.jsonl');
  const command = path.join(directory, 'gh');
  await writeFile(marker, '');
  await writeFile(command, `#!${process.execPath}\nconst fs = require('node:fs');
let body = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => { body += chunk; });
process.stdin.on('end', () => { fs.appendFileSync(${JSON.stringify(marker)}, JSON.stringify(process.argv.slice(2)) + '\\n');
if (body.includes('next-message')) process.stdout.write(JSON.stringify({ id: 77 })); else setInterval(() => {}, 1000); });\n`);
  await chmod(command, 0o700); vi.stubEnv('PATH', `${directory}${path.delimiter}${process.env.PATH ?? ''}`);
  class SyntheticGithubEndpoint extends GithubEndpoint {
    override async verifyAuth() { return { ok: true, user: 'synthetic', message: 'synthetic' }; }
    override async syncInstallations() {}
  }
  const config = resolveGithubConfig({ id: 'synthetic', app_id: 1, private_key: 'synthetic-no-provider-key' });
  const f = await createEndpointHarness(() => new SyntheticGithubEndpoint({ id: capabilityId(rootPluginId(), adapterFeatureId, 'github'), config }), { name: 'github', capabilities: ['outbound'] });
  const caller = new AbortController(), watcher = watch(marker);
  // Observe the real child before starting it; process startup has no 1s readiness contract.
  const ready = once(watcher, 'change', { signal: caller.signal });
  void ready.catch(() => undefined);
  let outcome: unknown;
  const conversation = { endpoint: { adapter: 'github', id: f.canonicalId }, kind: 'channel' as const, id: buildChannelId('owner/repo', kind, 1) };
  const sending = f.start().then(() => {
    f.open();
    return f.send({ conversation, payload: 'first-message', signal: caller.signal });
  }).then(value => { outcome = { value }; }, error => { outcome = { error }; });
  onTestFinished(async () => {
    caller.abort(); watcher.close();
    try { await f.stop(); await sending; }
    finally { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); }
  });
  await Promise.race([ready, sending]);
  watcher.close();
  expect((await readFile(marker, 'utf8')).trim()).not.toBe('');
  caller.abort(); await sending;
  expect(outcome).toMatchObject({ error: { disposition: 'unknown' } });
  await expect(f.send({ conversation, payload: 'next-message' })).resolves.toBe('77');
  const calls = (await readFile(marker, 'utf8')).trim().split('\n').map(row => JSON.parse(row));
  expect(calls).toHaveLength(2); expect(calls.every(args => args.includes('/repos/owner/repo/issues/1/comments'))).toBe(true);
});

it('cancels App authentication preparation before any comment subprocess is admitted', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  let finish!: (response: Response) => void;
  const pendingResponse = new Promise<Response>(resolve => { finish = resolve; });
  const calls: RequestInit[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { calls.push(init); return pendingResponse; });
  const client = new GhClient({ appAuth: { appId: 1, privateKey } }), caller = new AbortController();
  const posting = client.createIssueComment({ repo: 'owner/repo', number: 1, body: 'synthetic', signal: caller.signal });
  const observed = posting.then(value => ({ value }), error => ({ error }));
  try {
    await vi.waitFor(() => expect(calls).toHaveLength(1)); caller.abort();
    expect(calls[0]!.signal?.aborted).toBe(true);
    await expect(observed).resolves.toMatchObject({ error: { disposition: 'not_sent' } });
    finish(new Response(JSON.stringify([{ id: 2, account: { login: 'owner', type: 'User' }, target_type: 'User' }]), { status: 200 }));
    await new Promise(resolve => setImmediate(resolve)); expect(calls).toHaveLength(1); expect(client.installations).toEqual([]);
  } finally { finish(new Response('[]', { status: 200 })); await observed; vi.unstubAllGlobals(); }
});

it('pins each concurrent repository comment to its own selected installation token', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'github-gh-identity-')), marker = path.join(directory, 'calls.jsonl');
  const command = path.join(directory, 'gh');
  await writeFile(marker, '');
  await writeFile(command, `#!${process.execPath}\nconst fs = require('node:fs');
process.stdin.resume(); process.stdin.on('end', () => {
fs.appendFileSync(${JSON.stringify(marker)}, JSON.stringify({ args: process.argv.slice(2), token: process.env.GH_TOKEN }) + '\\n');
process.stdout.write(JSON.stringify({ id: 77 })); });\n`);
  await chmod(command, 0o700); vi.stubEnv('PATH', `${directory}${path.delimiter}${process.env.PATH ?? ''}`);
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    if (url.endsWith('/app/installations')) return Response.json([{ id: 1, account: { login: 'alpha', type: 'User' }, target_type: 'User' }, { id: 2, account: { login: 'beta', type: 'User' }, target_type: 'User' }]);
    if (url.endsWith('/access_tokens')) return Response.json({ token: url.includes('/1/') ? 'synthetic-alpha' : 'synthetic-beta', expires_at: new Date(Date.now() + 3_600_000).toISOString() });
    if (url.includes('/installation/repositories')) return Response.json({ repositories: [{ full_name: headers.get('authorization') === 'Bearer synthetic-alpha' ? 'alpha/one' : 'beta/two' }] });
    throw new Error('Unexpected synthetic authentication path');
  });
  try {
    const client = new GhClient({ appAuth: { appId: 1, privateKey } }); await client.syncInstallations();
    await Promise.all([client.createIssueComment({ repo: 'alpha/one', number: 1, body: 'alpha' }), client.createPRComment({ repo: 'beta/two', number: 2, body: 'beta' })]);
    const calls: Array<{ args: string[]; token: string }> = (await readFile(marker, 'utf8')).trim().split('\n').map(row => JSON.parse(row));
    expect(calls).toHaveLength(2);
    expect(calls.find(row => row.args.includes('/repos/alpha/one/issues/1/comments'))?.token).toBe('synthetic-alpha');
    expect(calls.find(row => row.args.includes('/repos/beta/two/issues/2/comments'))?.token).toBe('synthetic-beta');
  } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); }
});
