import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { validateModelRuntimeConfig } from '../../../packages/im/agent/src/config/index.js';
import { readApplicationPluginDeclaration } from '../../../packages/im/runtime/src/application-plugin-declaration.js';
import { HOST_CONFIG_SCHEMA, validatePluginConfigSchema } from '../../../packages/im/runtime/src/config-composer.js';
import { parsePackageJson } from '../../../packages/im/runtime/src/manifest.js';
import { reviewAIPlan } from '../../../tests/helpers/review-ai-plan.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.join(root, '../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const json = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const config = parse(read('zhin.config.yml')) as Record<string, unknown>;
const manifest = json(path.join(root, 'package.json'));

describe('deploy/huggingface template', () => {
  it('declares plugin instances in the configVersion 2 format', () => {
    const declaration = readApplicationPluginDeclaration(config);
    expect(declaration.instances).toEqual([
      { instanceKey: 'sandbox', package: '@zhin.js/adapter-sandbox', enabled: true },
    ]);
    expect(manifest.dependencies).toHaveProperty('@zhin.js/adapter-sandbox');
  });

  it('passes the Host schema and the Sandbox adapter schema', () => {
    const host = Object.fromEntries(Object.entries(config)
      .filter(([key]) => Object.hasOwn(HOST_CONFIG_SCHEMA.properties, key)));
    expect(validatePluginConfigSchema(HOST_CONFIG_SCHEMA, host)).toEqual([]);
    const sandboxSchema = json(path.join(repo, 'plugins/adapters/sandbox/schema.json'));
    expect(validatePluginConfigSchema(sandboxSchema, config.sandbox)).toEqual([]);
  });

  it('keeps model definitions out of the startup file and ships a reviewable plan', async () => {
    expect(validateModelRuntimeConfig(config.ai, 'host:example')).toEqual([]);
    const plan = parse(read('ai.plan.yml'));
    const reviewed = await reviewAIPlan(plan);
    const chat = reviewed.graph.profiles[reviewed.graph.purposes.defaults.chat!];
    expect(chat.model).toBe('openrouter/free');
    expect(plan.accounts.openrouter.auth).toEqual({ method: 'api-key', source: 'env://OPENROUTER_API_KEY' });
    // The startup seed does not expand ${VAR}; service options must be literal.
    expect(read('ai.plan.yml')).not.toContain('${');
  });

  it('has a valid Plugin manifest and no floating dependency pins', () => {
    const parsed = parsePackageJson(manifest, 'package.json');
    expect(parsed.zhin).toMatchObject({ protocol: 1, type: 'plugin', entry: './plugin.ts', plugins: [] });
    const ranges = Object.values({ ...manifest.dependencies, ...manifest.devDependencies });
    expect(ranges).not.toContain('latest');
    expect(ranges).not.toContain('*');
  });

  it('copies every file the runtime reads into the image', () => {
    const docker = read('Dockerfile');
    for (const file of ['zhin.config.yml', 'ai.plan.yml', 'plugin.ts', 'start.sh']) expect(docker).toContain(file);
  });

  it('never ships a public bootstrap token and starts through the gateway', () => {
    // The bootstrap token comes from the Space secret (or a random one printed to the log only).
    expect((config.http as Record<string, unknown>).token).toBe('${HTTP_TOKEN}');
    expect(read('README.md')).not.toMatch(/zhin-demo`|Token 填/u);
    expect(read('commands/playground/index.ts')).not.toMatch(/Token[：:]\s*zhin-demo/u);
    const start = read('start.sh');
    expect(start).toContain('randomBytes(32)');
    expect(start).toContain('console init --yes');
    expect(start).toContain('console user create demo --role "${DEMO_ROLE:-viewer}" --password-stdin');
    expect(start).toMatch(/exec "\$ZHIN" start --foreground --mode production --no-watch/u);
    expect(read('Dockerfile')).toContain('CMD ["sh", "./start.sh"]');
    expect(read('Dockerfile')).not.toContain('ZHIN_SUPERVISOR_PID');
    expect(manifest.scripts.start).toBe('zhin start --foreground --mode production --no-watch');
    for (const name of ['zhin.js', '@zhin.js/cli', '@zhin.js/gateway']) expect(manifest.dependencies).toHaveProperty([name]);
  });

  describe.runIf(process.platform !== 'win32')('start.sh', () => {
    /** Runs start.sh against a fake `zhin` that records its calls and the environment of `start`. */
    function run(env: Record<string, string>) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-hf-start-'));
      try {
        fs.mkdirSync(path.join(dir, 'node_modules/.bin'), { recursive: true });
        fs.copyFileSync(path.join(root, 'start.sh'), path.join(dir, 'start.sh'));
        const fake = path.join(dir, 'node_modules/.bin/zhin');
        fs.writeFileSync(fake, [
          '#!/bin/sh',
          'echo "$*" >> calls.log',
          'case "$*" in',
          '  "console init --status") echo \'{ "setupRequired": true }\' ;;',
          '  "console user list") : ;;',
          '  start*) env > start-env.log ;;',
          '  *) cat > /dev/null ;;',
          'esac',
        ].join('\n'));
        fs.chmodSync(fake, 0o755);
        const result = spawnSync('sh', ['./start.sh'], {
          cwd: dir,
          encoding: 'utf8',
          env: { PATH: process.env.PATH ?? '', ...env },
        });
        const file = (name: string) => (fs.existsSync(path.join(dir, name)) ? fs.readFileSync(path.join(dir, name), 'utf8') : '');
        return { status: result.status, output: `${result.stdout}${result.stderr}`, calls: file('calls.log'), startEnv: file('start-env.log') };
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    it('refuses to open the port without OWNER_PASSWORD or HTTP_TOKEN', () => {
      const result = run({});
      expect(result.status).toBe(1);
      expect(result.output).toContain('OWNER_PASSWORD');
      expect(result.calls).toBe('');
    });

    it('rejects a short OWNER_PASSWORD / DEMO_PASSWORD with a clear message', () => {
      for (const env of [{ OWNER_PASSWORD: 'short' }, { OWNER_PASSWORD: 'long-enough-pass', DEMO_PASSWORD: 'tiny' }]) {
        const result = run(env);
        expect(result.status).toBe(1);
        expect(result.output).toMatch(/must be at least 10 characters/u);
        expect(result.calls).toBe('');
      }
    });

    it('creates the accounts, never prints the generated token and drops the passwords before start', () => {
      const result = run({ OWNER_PASSWORD: 'long-enough-pass', DEMO_PASSWORD: 'demo-password-1' });
      expect(result.status).toBe(0);
      expect(result.calls).toContain('console init --yes --owner maintainer --password-stdin');
      expect(result.calls).toContain('console user create demo --role viewer --password-stdin');
      expect(result.calls).toContain('start --foreground --mode production --no-watch');
      const token = /^HTTP_TOKEN=(.+)$/mu.exec(result.startEnv)?.[1];
      expect(token).toMatch(/^[\w-]{43}$/u);
      expect(result.output).not.toContain(token!);
      expect(result.startEnv).not.toMatch(/^(?:OWNER|DEMO)_PASSWORD=/mu);
    });

    it('starts with the HTTP_TOKEN secret alone (setup finished in the Console)', () => {
      const result = run({ HTTP_TOKEN: 'operator-secret-token-value' });
      expect(result.status).toBe(0);
      expect(result.calls).not.toContain('console init');
      expect(result.startEnv).toContain('HTTP_TOKEN=operator-secret-token-value');
    });
  });
});
