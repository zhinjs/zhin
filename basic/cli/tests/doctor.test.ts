import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyConsoleConfigFixes, diagnoseConsoleConfig } from '@zhin.js/scaffold-wizard';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findMissingEndpointFields, loadPluginSchemaJson } from '../src/utils/adapter-endpoints-check.js';

vi.mock('child_process', async importOriginal => ({
  ...await importOriginal<typeof import('child_process')>(),
  exec: (_command: string, callback: (error: null, result: { stdout: string; stderr: string }) => void) => callback(null, { stdout: '9.0.0', stderr: '' }),
}));

// The project's running gateway, as `zhin doctor` sees it over .zhin/gateway.sock (none by default).
const runningGateway = vi.hoisted(() => ({ current: undefined as undefined | Record<string, unknown> }));
vi.mock('../src/utils/gateway.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/utils/gateway.js')>(),
  probeGateway: async () => runningGateway.current,
}));

async function runDoctor(setup: (directory: string) => void, flags: string[] = []): Promise<{ output: string; directory: string }> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-run-'));
  const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('doctor exited'); });
  const previous = process.env.HTTP_TOKEN;
  delete process.env.HTTP_TOKEN;
  try {
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'doctor-run', private: true, dependencies: { 'zhin.js': '^1.0.0' } }));
    setup(directory);
    const { doctorCommand } = await import('../src/commands/doctor.js');
    await doctorCommand.parseAsync(['node', 'zhin', ...flags]).catch(() => {});
    return { output: log.mock.calls.map(args => args.join(' ')).join('\n'), directory };
  } finally {
    if (previous === undefined) delete process.env.HTTP_TOKEN;
    else process.env.HTTP_TOKEN = previous;
    cwd.mockRestore();
    log.mockRestore();
    exit.mockRestore();
  }
}

const gatewayInfo = (consoleInitialized: boolean) => ({
  gateway: { pid: 4242, ports: [8086], origins: ['http://127.0.0.1:8086'], socket: '.zhin/gateway.sock', startedAt: Date.now(), version: '1.2.0', mode: 'daemon', args: [] },
  instance: { state: 'running' },
  consoleInitialized,
});

describe('doctor with the project gateway running (#1250)', () => {
  afterEach(() => { runningGateway.current = undefined; });

  it('reports the HTTP port held by this project\'s gateway as ok, not as a conflict to kill', async () => {
    runningGateway.current = gatewayInfo(true);
    const { output, directory } = await runDoctor(() => {});
    try {
      expect(output).toContain('端口 8086: 由本项目的管理网关监听（pid 4242）');
      expect(output).not.toContain('kill <pid>');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });

  it('still warns when the port is taken but the gateway listens elsewhere', async () => {
    runningGateway.current = { ...gatewayInfo(true), gateway: { ...gatewayInfo(true).gateway, ports: [9000] } };
    const { output, directory } = await runDoctor(() => {});
    try {
      expect(output).toContain('端口 8086: 已被占用');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });

  it.each([
    ['running gateway', () => { runningGateway.current = gatewayInfo(true); }],
    ['offline marker', (directory: string) => {
      fs.mkdirSync(path.join(directory, '.zhin'), { recursive: true });
      fs.writeFileSync(path.join(directory, '.zhin', 'console-iam.initialized'), '1\n');
    }],
  ])('only notes a weak HTTP_TOKEN once the Console is initialized (%s), and --fix leaves it alone', async (_label, arrange) => {
    const env = 'HTTP_TOKEN=change-me\n';
    const { output, directory } = await runDoctor(dir => { arrange(dir); fs.writeFileSync(path.join(dir, '.env'), env); });
    try {
      expect(output).toContain('HTTP_TOKEN: Console 已初始化：初始化后此令牌一律被拒绝，可从 .env 删除 HTTP_TOKEN');
      expect(output).not.toContain('弱值');
      await runDoctor(dir => { arrange(dir); fs.writeFileSync(path.join(dir, '.env'), env); }, ['--fix']).then(run => {
        expect(fs.readFileSync(path.join(run.directory, '.env'), 'utf8')).toBe(env);
        fs.rmSync(run.directory, { recursive: true, force: true });
      });
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });

  it('keeps warning about a weak HTTP_TOKEN while the Console is not initialized', async () => {
    runningGateway.current = gatewayInfo(false);
    const { output, directory } = await runDoctor(dir => fs.writeFileSync(path.join(dir, '.env'), 'HTTP_TOKEN=change-me\n'));
    try {
      expect(output).toContain('弱值');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
});

describe('doctor console diagnostics', () => {
  it.each([
    ['--upgrade-l4 --fix', ['--upgrade-l4', '--fix']],
    ['--fix', ['--fix']],
  ])('writes release ranges, not latest, for missing AI dependencies (%s)', async (_label, flags) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-fix-ranges-'));
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('doctor exited'); });
    try {
      fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
        name: 'doctor-fix-ranges', private: true, dependencies: { 'zhin.js': '^1.0.0' },
      }));
      fs.writeFileSync(path.join(directory, 'zhin.config.json'), JSON.stringify({
        configVersion: 2, plugins: { sandbox: '@zhin.js/adapter-sandbox' }, sandbox: {},
        http: { token: 'test-token', corsOrigins: ['https://console.zhin.dev'] },
        ai: { enabled: true, providers: { ollama: { sdk: 'ollama', host: 'http://127.0.0.1:11434' } } },
      }));
      const { doctorCommand } = await import('../src/commands/doctor.js');
      await doctorCommand.parseAsync(['node', 'zhin', ...flags]).catch(() => {});

      const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
      const written = Object.entries(pkg.dependencies as Record<string, string>);
      expect(written.some(([name]) => name === '@zhin.js/agent')).toBe(true);
      expect(pkg.dependencies['@zhin.js/agent']).toMatch(/^\^\d+\.\d+\.\d+/u);
      expect(written.filter(([, range]) => range === 'latest')).toEqual([]);
    } finally {
      cwd.mockRestore();
      log.mockRestore();
      exit.mockRestore();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it.each([false, true])('keeps Console and Sandbox diagnostics when package.json is malformed (decisions: %s)', async decisions => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-malformed-package-'));
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('doctor exited'); });
    try {
      fs.writeFileSync(path.join(directory, 'package.json'), '{ invalid json');
      fs.writeFileSync(path.join(directory, 'zhin.config.json'), JSON.stringify({
        configVersion: 2, plugins: {sandbox: '@zhin.js/adapter-sandbox'}, sandbox: {},
        http: { token: 'test-token', corsOrigins: ['https://console.zhin.dev'] },
        ...(decisions ? { ai: { decisions: { provider: 'root/typesafe', skills: { mode: 'off' } } } } : {}),
      }));
      const { doctorCommand } = await import('../src/commands/doctor.js');
      await expect(doctorCommand.parseAsync(['node', 'zhin'])).rejects.toThrow('doctor exited');
      const output = log.mock.calls.map(args => args.join(' ')).join('\n');
      expect(output).toContain('Sandbox 插件已启用');
      expect(output).toContain('CORS 已配置');
      expect(output).toContain('package.json');
      expect(output).not.toContain('无法读取配置以检查 Console');
      if (decisions) expect(output).toContain('无法读取 package.json 以检查决策插件绑定');
    } finally {
      cwd.mockRestore();
      log.mockRestore();
      exit.mockRestore();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('--fix writes a random bootstrap token, never a fixed one', async () => {
    const tokens: string[] = [];
    for (const existingEnv of [undefined, '# keep me\nOTHER=1']) {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-fix-token-'));
      const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('doctor exited'); });
      const previous = process.env.HTTP_TOKEN;
      delete process.env.HTTP_TOKEN;
      try {
        fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'doctor-fix-token', private: true, dependencies: { 'zhin.js': '^1.0.0' } }));
        if (existingEnv !== undefined) fs.writeFileSync(path.join(directory, '.env'), existingEnv);
        const { doctorCommand } = await import('../src/commands/doctor.js');
        await doctorCommand.parseAsync(['node', 'zhin', '--fix']).catch(() => {});
        const env = fs.readFileSync(path.join(directory, '.env'), 'utf8');
        if (existingEnv !== undefined) expect(env.startsWith(existingEnv)).toBe(true);
        const token = /^HTTP_TOKEN=(\S+)$/mu.exec(env)?.[1];
        expect(token).toMatch(/^[\w-]{43}$/u);
        expect(env).not.toContain('zhin-local-token');
        tokens.push(token!);
        const output = log.mock.calls.map(args => args.join(' ')).join('\n');
        expect(output).toContain('仅在创建首个所有者之前有效');
        expect(output).not.toContain('Console/API 无法鉴权');
      } finally {
        if (previous === undefined) delete process.env.HTTP_TOKEN;
        else process.env.HTTP_TOKEN = previous;
        cwd.mockRestore();
        log.mockRestore();
        exit.mockRestore();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
    expect(tokens[0]).not.toBe(tokens[1]);
  });

  it('reads HTTP_TOKEN per line only, flags weak values, and --fix replaces them with mode 0600', async () => {
    const { isWeakBootstrapToken, readEnvValue } = await import('../src/commands/doctor.js');
    // An empty value never borrows the next line.
    expect(readEnvValue('HTTP_TOKEN=\nOTHER=x\n', 'HTTP_TOKEN')).toBeUndefined();
    expect(readEnvValue('HTTP_TOKEN=   \nOTHER=x', 'HTTP_TOKEN')).toBeUndefined();
    expect(readEnvValue('export HTTP_TOKEN="abc def"', 'HTTP_TOKEN')).toBe('abc def');
    expect(readEnvValue('HTTP_TOKEN=abc # note', 'HTTP_TOKEN')).toBe('abc');
    for (const value of ['change-me', 'change-me-please-now-1234', 'zhin-local-token', 'zhin-demo', 'short']) {
      expect(isWeakBootstrapToken(value), value).toBe(true);
    }
    expect(isWeakBootstrapToken('Hk3m9x_QwZr7Lp2V5tYb8NcA')).toBe(false);

    for (const existingEnv of ['HTTP_TOKEN=\nOTHER=1\n', '# keep\nHTTP_TOKEN=change-me\nOTHER=1\n', 'HTTP_TOKEN=zhin-local-token\n']) {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-weak-token-'));
      const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('doctor exited'); });
      const previous = process.env.HTTP_TOKEN;
      delete process.env.HTTP_TOKEN;
      try {
        fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'doctor-weak-token', private: true, dependencies: { 'zhin.js': '^1.0.0' } }));
        fs.writeFileSync(path.join(directory, '.env'), existingEnv, { mode: 0o644 });
        const { doctorCommand } = await import('../src/commands/doctor.js');
        // Without --fix: warned, nothing written.
        await doctorCommand.parseAsync(['node', 'zhin']).catch(() => {});
        expect(fs.readFileSync(path.join(directory, '.env'), 'utf8')).toBe(existingEnv);
        if (existingEnv.includes('change-me') || existingEnv.includes('zhin-local')) {
          expect(log.mock.calls.map(args => args.join(' ')).join('\n')).toContain('弱值');
        }
        await doctorCommand.parseAsync(['node', 'zhin', '--fix']).catch(() => {});
        const env = fs.readFileSync(path.join(directory, '.env'), 'utf8');
        const token = readEnvValue(env, 'HTTP_TOKEN');
        expect(token, existingEnv).toMatch(/^[\w-]{43}$/u);
        expect(env).toContain('OTHER=1'.repeat(existingEnv.includes('OTHER') ? 1 : 0));
        expect(env).not.toMatch(/change-me|zhin-local-token/u);
        if (process.platform !== 'win32') expect(fs.statSync(path.join(directory, '.env')).mode & 0o777).toBe(0o600);
      } finally {
        if (previous === undefined) delete process.env.HTTP_TOKEN;
        else process.env.HTTP_TOKEN = previous;
        cwd.mockRestore();
        log.mockRestore();
        exit.mockRestore();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  it('reports literal secrets by path and --fix moves them into .env as ${ZHIN_…} references (ADR 0057)', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-literal-secrets-'));
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(directory);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('doctor exited'); });
    try {
      fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'doctor-literal-secrets', private: true, dependencies: { 'zhin.js': '^1.0.0' } }));
      fs.writeFileSync(path.join(directory, '.env'), 'HTTP_TOKEN=Hk3m9x_QwZr7Lp2V5tYb8NcAqq11zz\n');
      fs.writeFileSync(path.join(directory, 'zhin.config.yml'), [
        'configVersion: 2', 'plugins:', '  sandbox: "@zhin.js/adapter-sandbox"', 'sandbox: {}',
        'http:', '  token: ${HTTP_TOKEN}', '  corsOrigins:', '    - https://console.zhin.dev',
        'database:', '  dialect: pg', '  password: literal-db-password', '',
      ].join('\n'));
      const { doctorCommand } = await import('../src/commands/doctor.js');
      await doctorCommand.parseAsync(['node', 'zhin']).catch(() => {});
      const report = log.mock.calls.map(args => args.join(' ')).join('\n');
      expect(report).toContain('database.password');
      expect(report).not.toContain('literal-db-password');
      expect(fs.readFileSync(path.join(directory, 'zhin.config.yml'), 'utf8')).toContain('literal-db-password');

      log.mockClear();
      await doctorCommand.parseAsync(['node', 'zhin', '--fix']).catch(() => {});
      const config = fs.readFileSync(path.join(directory, 'zhin.config.yml'), 'utf8');
      expect(config).toContain('password: ${ZHIN_DATABASE_PASSWORD}');
      expect(config).not.toContain('literal-db-password');
      const env = fs.readFileSync(path.join(directory, '.env'), 'utf8');
      expect(env).toContain("ZHIN_DATABASE_PASSWORD='literal-db-password'");
      expect(env).toContain('HTTP_TOKEN=Hk3m9x_QwZr7Lp2V5tYb8NcAqq11zz');
      expect(log.mock.calls.map(args => args.join(' ')).join('\n')).not.toContain('literal-db-password');

      await doctorCommand.parseAsync(['node', 'zhin', '--fix']).catch(() => {});
      expect(fs.readFileSync(path.join(directory, '.env'), 'utf8')).toBe(env);
    } finally {
      cwd.mockRestore();
      log.mockRestore();
      exit.mockRestore();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('detects missing Sandbox, CORS, and token config', () => {
    const diagnosis = diagnoseConsoleConfig({ configVersion: 2, plugins: {example: 'example'}, example: {}, http: {} });

    expect(diagnosis.missingSandboxPlugin).toBe(true);
    expect(diagnosis.missingConsoleOrigin).toBe(true);
    expect(diagnosis.missingHttpToken).toBe(true);
  });

  it('fills first-run Console and Sandbox config without dropping existing plugins', () => {
    const config: Record<string, unknown> = {
      configVersion: 2, plugins: {example: 'example'}, example: {},
      http: { port: 8086 },
    };

    const changed = applyConsoleConfigFixes(config);
    const diagnosis = diagnoseConsoleConfig(config);

    expect(changed).toBe(true);
    expect(config.plugins).toEqual({example: 'example', sandbox: '@zhin.js/adapter-sandbox'});
    expect(config.http).toMatchObject({
      port: 8086,
      token: '${HTTP_TOKEN}',
      corsOrigins: ['https://console.zhin.dev'],
    });
    expect(diagnosis).toEqual({
      missingSandboxPlugin: false,
      missingConsoleOrigin: false,
      missingHttpToken: false,
    });
  });

  it('does not rewrite already healthy config', () => {
    const config: Record<string, unknown> = {
      configVersion: 2, plugins: {sandbox: '@zhin.js/adapter-sandbox'}, sandbox: {},
      http: { token: '${HTTP_TOKEN}', corsOrigins: ['https://console.zhin.dev'] },
    };

    expect(applyConsoleConfigFixes(config)).toBe(false);
  });

  it('does not repair legacy list-form plugins in the normal doctor path', () => {
    const config: Record<string, unknown> = { plugins: ['@zhin.js/adapter-sandbox'] };
    expect(() => applyConsoleConfigFixes(config))
      .toThrow(/configVersion/);
  });
});

describe('doctor adapter endpoints check', () => {
  const qqSchema = {
    properties: {
      endpoints: {
        items: { required: ['name', 'appid', 'secret'] },
      },
    },
  };

  it('指出 endpoint 缺少的必填字段（如 QQ 缺 appid）', () => {
    const issues = findMissingEndpointFields(qqSchema, {
      endpoints: [{ name: 'zhin', secret: 's' }],
    });

    expect(issues).toEqual([{ endpoint: 'zhin', missing: ['appid'] }]);
  });

  it('顶层字段可被 endpoint 继承', () => {
    const issues = findMissingEndpointFields(qqSchema, {
      appid: 'a',
      secret: 's',
      endpoints: [{ name: 'zhin' }],
    });

    expect(issues).toEqual([]);
  });

  it('schema 无 endpoints.required 或未声明 endpoints 时不检查', () => {
    expect(findMissingEndpointFields(null, { endpoints: [{ name: 'x' }] })).toEqual([]);
    expect(findMissingEndpointFields({ properties: {} }, { endpoints: [{}] })).toEqual([]);
    expect(findMissingEndpointFields(qqSchema, {})).toEqual([]);
  });

  it('loadPluginSchemaJson 从 node_modules 读取 @zhin.js/adapter-<key>/schema.json', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-schema-'));
    try {
      const pkgDir = path.join(cwd, 'node_modules', '@zhin.js', 'adapter-qq');
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, 'schema.json'), JSON.stringify(qqSchema));

      expect(loadPluginSchemaJson(cwd, 'qq')).toEqual(qqSchema);
      expect(loadPluginSchemaJson(cwd, 'not-installed')).toBeNull();
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe('doctor: gateway native dependency node-pty (#1250)', () => {
  /** The project's gateway (ESM-only, like the real package) with node-pty installed next to it. */
  const installGateway = (directory: string, nodePty: 'loads' | 'broken') => {
    const gateway = path.join(directory, 'node_modules', '@zhin.js', 'gateway');
    fs.mkdirSync(path.join(gateway, 'lib'), { recursive: true });
    fs.writeFileSync(path.join(gateway, 'package.json'), JSON.stringify({ name: '@zhin.js/gateway', type: 'module', exports: { '.': { import: './lib/index.js' } } }));
    fs.writeFileSync(path.join(gateway, 'lib', 'index.js'), 'export {};\n');
    const pty = path.join(gateway, 'node_modules', 'node-pty');
    fs.mkdirSync(pty, { recursive: true });
    fs.writeFileSync(path.join(pty, 'package.json'), JSON.stringify({ name: 'node-pty', main: 'index.js' }));
    fs.writeFileSync(path.join(pty, 'index.js'), nodePty === 'loads'
      ? 'module.exports = { spawn() {} };\n'
      : "throw new Error(\"Cannot find module '../build/Release/pty.node'\");\n");
  };

  it('warns with the repair command when node-pty does not load', async () => {
    const { output, directory } = await runDoctor(dir => {
      installGateway(dir, 'broken');
      fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n");
    });
    try {
      expect(output).toContain('终端依赖 node-pty: 无法加载');
      expect(output).toContain('pty.node');
      expect(output).toContain('Console 的本地终端不可用');
      expect(output).toContain('pnpm rebuild node-pty');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });

  it('reports ok when node-pty loads', async () => {
    const { output, directory } = await runDoctor(dir => installGateway(dir, 'loads'));
    try {
      expect(output).toContain('终端依赖 node-pty: 可加载');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });

  it('skips the check when the project has no gateway', async () => {
    const { output, directory } = await runDoctor(dir => fs.mkdirSync(path.join(dir, 'node_modules')));
    try {
      expect(output).not.toContain('node-pty');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
});
