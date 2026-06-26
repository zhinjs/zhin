import { execSync, spawn } from 'node:child_process';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace } from '../src/workspace.js';
import { applyStableYesDefaults } from '../src/stable-yes-defaults.js';
import type { InitOptions } from '../src/types.js';
import { DEFAULT_CREATE_BOT_HTTP_PORT } from '@zhin.js/scaffold-wizard';
import generated from '../../scaffold-wizard/src/stack-versions.generated.json' with { type: 'json' };

const tmpRoots: string[] = [];
const e2eTimeoutMs = 180_000;

function stableYesOptions(): InitOptions {
  const options: InitOptions = {
    yes: true,
    config: 'yaml',
    runtime: 'node',
    httpToken: 'bootstrap-e2e-token',
    installGlobalCli: false,
  };
  applyStableYesDefaults(options);
  return options;
}

function aiEnabledOptions(): InitOptions {
  return {
    ...stableYesOptions(),
    yes: false,
    database: { dialect: 'sqlite', filename: './data/bot.db', mode: 'wal' },
    adapters: {
      packages: ['@zhin.js/adapter-sandbox'],
      plugins: ['@zhin.js/adapter-sandbox'],
      endpoints: [],
      envVars: {},
    },
    ai: {
      enabled: true,
      defaultProvider: 'ollama',
      providers: { ollama: { host: 'http://127.0.0.1:11434' } },
    },
    devSkills: false,
  };
}

async function waitForStartLog(proc: ReturnType<typeof spawn>, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`pnpm start timed out after ${timeoutMs}ms\n${output}`));
    }, timeoutMs);

    proc.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('服务端口:')) {
        clearTimeout(timer);
        resolve(output);
      }
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    proc.on('exit', (code) => {
      if (!output.includes('服务端口:')) {
        clearTimeout(timer);
        reject(new Error(`pnpm start exited ${code}\n${output}`));
      }
    });
  });
}

afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((root) => fs.remove(root)));
});

describe('create-zhin npm bootstrap', () => {
  it(
    'create -y → pnpm install → pnpm start 可启动 Host',
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-zhin-bootstrap-'));
      tmpRoots.push(root);
      const projectPath = path.join(root, 'bootstrap-bot');

      await createWorkspace(projectPath, 'bootstrap-bot', stableYesOptions());

      const config = await fs.readFile(path.join(projectPath, 'zhin.config.yml'), 'utf8');
      expect(config).toContain(`port: ${DEFAULT_CREATE_BOT_HTTP_PORT}`);

      execSync('pnpm install', { cwd: projectPath, stdio: 'inherit', timeout: e2eTimeoutMs });

      const proc = spawn('pnpm', ['start'], {
        cwd: projectPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'production' },
      });
      try {
        const log = await waitForStartLog(proc, 60_000);
        expect(log).toContain(`服务端口: ${DEFAULT_CREATE_BOT_HTTP_PORT}`);
      } finally {
        proc.kill('SIGTERM');
      }
    },
    e2eTimeoutMs,
  );

  it(
    '启用 AI 时 pnpm install 不因 peer 冲突失败',
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-zhin-ai-bootstrap-'));
      tmpRoots.push(root);
      const projectPath = path.join(root, 'ai-bootstrap-bot');

      await createWorkspace(projectPath, 'ai-bootstrap-bot', aiEnabledOptions());

      const pkg = await fs.readJson(path.join(projectPath, 'package.json'));
      expect(pkg.pnpm?.peerDependencyRules?.allowedVersions?.ai).toBe('7');
      expect(pkg.dependencies.ai).toBe(generated.aiStack.ai);
      expect(await fs.readFile(path.join(projectPath, '.npmrc'), 'utf8')).toContain('strict-peer-dependencies=false');

      execSync('pnpm install', {
        cwd: projectPath,
        stdio: 'inherit',
        timeout: e2eTimeoutMs,
      });
    },
    e2eTimeoutMs,
  );
});
