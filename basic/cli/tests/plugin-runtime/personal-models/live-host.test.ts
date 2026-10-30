import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../../../..');

describe('personal models through the built CLI and real local HTTP/SQLite Host', () => {
  it('authenticates bound users, persists encrypted credentials and rejects foreign selectors', async () => {
    const project = await realpath(await mkdtemp(join(tmpdir(), 'zhin-personal-live-')));
    let child: ReturnType<typeof spawn> | undefined;
    let output = '';
    const owner = { rootId: project, platform: 'qq', endpoint: 'test-account', adapterId: 'test-adapter', subjectId: 'test-person' };
    try {
      await mkdir(join(project, 'node_modules/@zhin.js'), { recursive: true });
      await symlink(join(repoRoot, 'packages/im/zhin'), join(project, 'node_modules/zhin.js'), 'dir');
      await symlink(join(repoRoot, 'packages/im/agent'), join(project, 'node_modules/@zhin.js/agent'), 'dir');
      await symlink(join(repoRoot, 'packages/im/tool'), join(project, 'node_modules/@zhin.js/tool'), 'dir');
      await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'personal-model-fixture', private: true, type: 'module',
        dependencies: { 'zhin.js': 'workspace:*', '@zhin.js/agent': 'workspace:*', '@zhin.js/tool': 'workspace:*' }, zhin: { protocol: 1, type: 'plugin', entry: './plugin.ts', engine: '^1.0.0', runtime: 'trusted', features: [{ package: '@zhin.js/tool', api: '^1.0.0' }], plugins: [] } }));
      await writeFile(join(project, 'plugin.ts'), "import {definePlugin} from 'zhin.js'; export default definePlugin({name:'personal-model-fixture'});\n");
      await writeFile(join(project, 'zhin.config.json'), JSON.stringify({ configVersion: 2,
        http: { host: '127.0.0.1', port: 0, token: 'synthetic-admin', tokens: [{ token: 'synthetic-user', scope: 'user', principalId: 'console-person' }] },
        ai: { providers: { local: { sdk: 'ollama', baseUrl: 'http://127.0.0.1:1', models: ['deployment'], contextWindow: 4096 } },
          agents: { zhin: { provider: 'local', model: 'deployment' } }, personalPrincipals: { 'console-person': [owner] } } }));
      child = spawn(process.execPath, [join(repoRoot, 'basic/cli/bin/zhin.js'), 'runtime', 'start'], { cwd: project, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout!.on('data', chunk => { output += String(chunk); });
      child.stderr!.on('data', chunk => { output += String(chunk); });
      const origin = await new Promise<string>((done, reject) => {
        const timer = setTimeout(() => reject(new Error(`Host did not listen: ${output}`)), 15000);
        const read = () => {
          const match = /listening (http:\/\/127\.0\.0\.1:\d+)/u.exec(output);
          if (match) { clearTimeout(timer); child!.stdout!.off('data', read); child!.stderr!.off('data', read); done(match[1]!); }
        };
        child!.stdout!.on('data', read); child!.stderr!.on('data', read);
        child!.once('exit', () => { clearTimeout(timer); reject(new Error(`Early Host exit: ${output}`)); }); read();
      });
      const request = async (path: string, token = 'synthetic-user', body?: unknown) => fetch(`${origin}/api/agent/${path}`, {
        method: body === undefined ? 'GET' : 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5000),
      });
      // Listening precedes generation activation; readiness is the existing authoritative boundary.
      const readyDeadline = Date.now() + 15000;
      for (;;) {
        if (child.exitCode !== null) throw new Error(`Host exited before readiness: ${output}`);
        const ready = await fetch(`${origin}/pub/ready`, { signal: AbortSignal.timeout(1000) })
          .catch(error => { throw new Error(`Host readiness failed: ${output}`, { cause: error }); });
        if (ready.ok) break;
        if (Date.now() >= readyDeadline) throw new Error(`Host did not become ready: ${output}`);
        await new Promise(done => setTimeout(done, 50));
      }
      const listed = await request('personal-models');
      expect(listed.status, output).toBe(200);
      const initial = await listed.json();
      expect(initial.data.owners).toHaveLength(1);
      expect((await request('personal-models', 'synthetic-admin')).status).toBe(401);
      const input = { owner, expectedRevision: 0, entry: { sdk: 'openai-compatible', baseUrl: 'https://provider.example/v1', model: 'personal-model', apiKey: 'synthetic-provider-key' } };
      const saved = await request('personal-models', 'synthetic-user', input);
      expect(saved.status).toBe(200);
      const body = await saved.json();
      expect(JSON.stringify(body)).not.toContain('synthetic-provider-key');
      expect((await request('personal-models', 'synthetic-user', { ...input, owner: { ...owner, subjectId: 'foreign-person' } })).status).toBe(403);
      const directory = new URLSearchParams({ owner: JSON.stringify(owner), limit: '50', offset: '0' });
      expect((await request(`personal-sessions?${directory}`)).status).toBe(200);
      const files = await readdir(join(project, '.zhin', 'personal-model-credentials'));
      for (const file of files) expect(await readFile(join(project, '.zhin', 'personal-model-credentials', file), 'utf8')).not.toContain('synthetic-provider-key');
    } finally {
      if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
      await rm(project, { recursive: true, force: true });
    }
  }, 40000);
});
