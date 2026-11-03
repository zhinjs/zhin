import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, symlink, cp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:net';

const repo = resolve('.'),
  tsx = pathToFileURL(join(repo, 'node_modules/tsx/dist/esm/index.mjs')).href;
function child(root: string, args: readonly string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((done, reject) => {
    const process = spawn(
      globalThis.process.execPath,
      ['--conditions=development', '--import', tsx, ...args],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let output = '';
    process.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    process.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    const timer = setTimeout(() => {
      process.kill('SIGKILL');
      reject(new Error(`Synthetic CLI timed out: ${output}`));
    }, 30_000);
    process.once('error', reject);
    process.once('close', (code) => {
      clearTimeout(timer);
      done({ code, output });
    });
  });
}
async function freePort() {
  return new Promise<number>((done, reject) => {
    const server = createServer()
      .once('error', reject)
      .listen(0, '127.0.0.1', () => {
        const address = server.address();
        server.close(() => done(typeof address === 'object' && address ? address.port : 0));
      });
  });
}
it('executes the actual offline CLI, then boots its finalized Root with authenticated model management and no provider request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inference-cli-upgrade-')),
    port = await freePort();
  try {
    await cp(join(repo, 'examples/minimal-bot/package.json'), join(root, 'package.json'));
    await writeFile(
      join(root, 'plugin.ts'),
      "import { definePlugin } from 'zhin.js'; export default definePlugin({ name: 'migration-acceptance' });\n"
    );
    await symlink(join(repo, 'examples/minimal-bot/node_modules'), join(root, 'node_modules'), 'junction');
    const original = {
      configVersion: 2,
      plugins: {},
      http: { host: '127.0.0.1', port, token: 'synthetic-migration-operator' },
      ai: {
        enabled: true,
        providers: { old: { sdk: 'openai', apiKey: '${SYNTHETIC_UNUSED_KEY}', models: ['native'] } },
        agents: { zhin: { provider: 'old', model: 'native' } },
      },
    };
    const config = join(root, 'zhin.config.json'),
      mapping = join(root, 'mapping.json'),
      preview = join(root, 'migration.json');
    await writeFile(config, JSON.stringify(original));
    await writeFile(
      mapping,
      JSON.stringify({
        version: 1,
        services: {
          deployment: {
            old: {
              driver: 'openai',
              authentication: 'api-key',
              options: {},
              models: {
                native: {
                  id: 'native',
                  protocol: 'openai-responses',
                  kinds: ['language'],
                  input: ['text'],
                  streaming: true,
                  toolCalling: true,
                },
              },
            },
          },
        },
      })
    );
    const cli = join(repo, 'basic/cli/src/cli.ts');
    for (const args of [
      ['migrate', 'inference', '--output', preview, '--mapping', mapping],
      ['migrate', 'inference', '--apply', preview, '--maintenance', '--backup-confirmed'],
      ['migrate', 'inference', '--finalize', preview, '--maintenance', '--backup-confirmed'],
    ]) {
      const result = await child(root, [cli, ...args]);
      expect(result.code, result.output).toBe(0);
      expect(result.output).not.toContain('SYNTHETIC_UNUSED_KEY=');
    }
    expect(JSON.parse(await readFile(config, 'utf8')).ai).not.toHaveProperty('providers');
    const entry = pathToFileURL(join(repo, 'basic/cli/src/plugin-runtime/start-command.ts')).href;
    const script = `
      import { runStartCommand } from ${JSON.stringify(entry)};
      const nativeFetch = globalThis.fetch; let external = 0;
      globalThis.fetch = (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') { external++; throw new Error('Synthetic startup forbids external requests'); }
        return nativeFetch(input, init);
      };
      void (async () => {
        for (;;) {
          try {
            const response = await fetch('http://127.0.0.1:${port}/api/agent/inference', { headers: { authorization: 'Bearer synthetic-migration-operator' } });
            if (response.ok) {
              const result = await response.json();
              const anonymous = await fetch('http://127.0.0.1:${port}/api/agent/inference');
              console.log(JSON.stringify({ acceptance: 'model-management', success: result.success, profiles: Object.keys(result.data.profiles).length, anonymous: anonymous.status, external }));
              process.kill(process.pid, 'SIGTERM'); return;
            }
          } catch {}
          await new Promise(done => setTimeout(done, 100).unref());
        }
      })();
      await runStartCommand({ root: ${JSON.stringify(
        root
      )}, args: ['--no-watch'], writeOutput: value => process.stdout.write(value), writeError: value => process.stderr.write(value) });
    `;
    const started = await child(root, ['--input-type=module', '-e', script]);
    expect(started.code, started.output).toBe(0);
    expect(started.output).toContain('"acceptance":"model-management","success":true');
    expect(started.output).toContain('"anonymous":401,"external":0');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
