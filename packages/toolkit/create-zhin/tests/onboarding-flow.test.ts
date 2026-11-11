import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { DEFAULT_CREATE_BOT_HTTP_PORT, scaffoldDependencyRange, type InitOptions } from '@zhin.js/scaffold-wizard';
import { parseCreateArgs } from '../src/args.js';
import {
  buildConsoleSetupLink,
  databaseDefaults,
  renderCreateSummary,
  resolveConsoleApiBaseUrl,
  resolveCreateOptions,
  type CreateFlowDeps,
} from '../src/flow.js';
import { createWorkspace } from '../src/workspace.js';
import { createText } from '../src/messages.js';
import { HOST_CONFIG_SCHEMA, configurationValidator } from '../../../im/runtime/src/config-composer.js';

const tmpRoots: string[] = [];
afterEach(async () => {
  await Promise.all(tmpRoots.splice(0).map((root) => fs.remove(root)));
});

function recordingDeps(answers: Record<string, unknown> = {}) {
  const questions: string[] = [];
  const deps: CreateFlowDeps = {
    prompt: vi.fn(async (list) => {
      const result: Record<string, unknown> = {};
      for (const question of list) {
        questions.push(question.name);
        result[question.name] = answers[question.name] ?? question.default;
      }
      return result;
    }),
    configureDatabase: vi.fn(async () => ({ dialect: 'mysql' as const, host: 'db', port: 3306 })),
    configureAdapters: vi.fn(async () => ({
      packages: ['@zhin.js/adapter-sandbox'], plugins: ['@zhin.js/adapter-sandbox'],
      instances: [{ package: '@zhin.js/adapter-sandbox', instanceKey: 'sandbox', config: {} }], envVars: {},
    })),
    configureAI: vi.fn(async () => ({
      enabled: true,
      agentProvider: 'ollama',
      providers: { ollama: { host: 'http://127.0.0.1:11434', models: ['m'] } },
      sessions: { useDatabase: true, maxHistory: 10, expireMs: 1000 },
    })),
    generateToken: () => 'generated-token',
  };
  return { deps, questions };
}

async function generate(options: InitOptions) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-zhin-onboarding-'));
  tmpRoots.push(root);
  const projectPath = path.join(root, 'bot');
  await createWorkspace(projectPath, 'bot', options);
  return projectPath;
}

describe('parseCreateArgs', () => {
  it('defaults to no optional steps', () => {
    expect(parseCreateArgs(['my-bot'])).toEqual({
      projectName: 'my-bot', yes: false, skipInstall: false, template: undefined, configFormat: undefined,
      devSkills: undefined, database: undefined, adapters: undefined, ai: false,
    });
  });

  it('reads template, config format, dev skills, database, adapters and AI flags', () => {
    const args = parseCreateArgs([
      '-y', '--skip-install', '--template', 'life-assistant', '--config-format=json', '--dev-skills',
      '--database', 'pg', '--adapter', 'sandbox,telegram', '--adapter=sandbox', '--ai', 'bot',
    ]);
    expect(args).toMatchObject({
      projectName: 'bot', yes: true, skipInstall: true, template: 'life-assistant', configFormat: 'json',
      devSkills: true, database: 'pg', adapters: ['sandbox', 'telegram'], ai: true,
    });
    expect(parseCreateArgs(['--no-dev-skills']).devSkills).toBe(false);
  });

  it('treats a bare --database / --adapters as a request for the wizard step', () => {
    expect(parseCreateArgs(['--database', 'my-bot'])).toMatchObject({ database: 'interactive', projectName: 'my-bot' });
    expect(parseCreateArgs(['--adapters']).adapters).toBe('interactive');
    expect(parseCreateArgs(['--adapters=discord']).adapters).toEqual(['discord']);
  });

  it('rejects unknown options and invalid values', () => {
    expect(() => parseCreateArgs(['--frobnicate'])).toThrow('--frobnicate');
    expect(() => parseCreateArgs(['--template', 'nope'])).toThrow('--template');
    expect(() => parseCreateArgs(['--config-format', 'toml'], 'en')).toThrow('--config-format must be one of yaml | json');
    expect(() => parseCreateArgs(['--adapter'])).toThrow('--adapter');
    expect(() => parseCreateArgs(['--adapter', 'no-such-platform'])).toThrow('--adapter');
    expect(() => parseCreateArgs(['--ai', '--ai'])).toThrow('--ai');
    expect(() => parseCreateArgs(['a', 'b'])).toThrow();
  });
});

describe('resolveCreateOptions', () => {
  it('asks only for the project name and the bootstrap token', async () => {
    const { deps, questions } = recordingDeps({ projectName: 'chat-bot', token: '  chosen  ' });
    const { name, options } = await resolveCreateOptions(parseCreateArgs([]), 'zh-CN', deps);
    expect(questions).toEqual(['projectName', 'token']);
    expect(name).toBe('chat-bot');
    expect(options).toMatchObject({ httpToken: 'chosen', template: 'default', config: 'yaml', devSkills: false });
    expect(options.database).toBeUndefined();
    expect(options.adapters).toBeUndefined();
    expect(options.ai).toBeUndefined();
    expect(deps.configureDatabase).not.toHaveBeenCalled();
    expect(deps.configureAdapters).not.toHaveBeenCalled();
    expect(deps.configureAI).not.toHaveBeenCalled();
  });

  it('defaults the token prompt to a random value and skips the name prompt when given', async () => {
    const { deps, questions } = recordingDeps();
    const { name, options } = await resolveCreateOptions(parseCreateArgs(['given']), 'en', deps);
    expect(questions).toEqual(['token']);
    expect(name).toBe('given');
    expect(options.httpToken).toBe('generated-token');
  });

  it('-y confirms the defaults without asking and installs no adapters or AI', async () => {
    const { deps, questions } = recordingDeps();
    const { name, options } = await resolveCreateOptions(parseCreateArgs(['-y']), 'zh-CN', deps);
    expect(questions).toEqual([]);
    expect(name).toBe('my-zhin-bot');
    expect(options).toMatchObject({ yes: true, httpToken: 'generated-token', template: 'default', config: 'yaml', devSkills: false });
    expect(options.adapters).toBeUndefined();
    expect(options.ai).toBeUndefined();
    expect(options.database).toBeUndefined();
  });

  it('honours the non-interactive flags exactly as passed', async () => {
    const { deps, questions } = recordingDeps();
    const { options } = await resolveCreateOptions(parseCreateArgs([
      'bot', '-y', '--template', 'life-assistant', '--config-format', 'json', '--dev-skills',
      '--database', 'pg', '--adapter', 'sandbox', '--ai',
    ]), 'zh-CN', deps);
    expect(questions).toEqual([]);
    expect(options).toMatchObject({ template: 'life-assistant', config: 'json', devSkills: true });
    expect(options.database).toEqual({ dialect: 'pg', host: '127.0.0.1', port: 5432, user: 'postgres', password: '', database: 'zhin_bot' });
    expect(options.adapters?.instances).toEqual([{
      package: '@zhin.js/adapter-sandbox', instanceKey: 'sandbox',
      config: { commandPrefix: '/', endpoints: [{ id: 'sandbox-bot', owner: 'sandbox-user' }] },
    }]);
    expect(deps.configureAI).toHaveBeenCalledOnce();
    expect(options.ai?.enabled).toBe(true);
  });

  it('runs the shared wizard steps for bare --database / --adapters', async () => {
    const { deps } = recordingDeps();
    const { options } = await resolveCreateOptions(parseCreateArgs(['bot', '--database', '--adapters']), 'zh-CN', deps);
    expect(deps.configureDatabase).toHaveBeenCalledWith('zh-CN');
    expect(deps.configureAdapters).toHaveBeenCalledWith('zh-CN');
    expect(options.database?.dialect).toBe('mysql');
  });

  it('adds an explicit SQLite database for AI sessions only when --ai was passed', async () => {
    const withAI = await resolveCreateOptions(parseCreateArgs(['bot', '--ai']), 'zh-CN', recordingDeps().deps);
    expect(withAI.options.database).toEqual({ dialect: 'sqlite', filename: './data/bot.db', mode: 'wal' });
    const without = await resolveCreateOptions(parseCreateArgs(['bot']), 'zh-CN', recordingDeps().deps);
    expect(without.options.database).toBeUndefined();
  });

  it('writes field-based adapter secrets as environment references', async () => {
    const { options } = await resolveCreateOptions(parseCreateArgs(['bot', '-y', '--adapter', 'kook']), 'zh-CN', recordingDeps().deps);
    expect(options.adapters?.instances[0]?.config).toEqual({ endpoints: [{ token: '${KOOK_TOKEN}', id: 'kook-bot' }] });
    expect(options.adapters?.envVars).toEqual({ KOOK_TOKEN: '' });
  });

  it('builds sqlite and memory defaults from the dialect definitions', () => {
    expect(databaseDefaults('sqlite')).toEqual({ dialect: 'sqlite', filename: './data/bot.db', mode: 'wal' });
    expect(databaseDefaults('memory')).toEqual({ dialect: 'memory' });
  });
});

describe('generated minimal project', () => {
  it('contains IM core and Console features only, with a valid default config', async () => {
    const { options } = await resolveCreateOptions(parseCreateArgs(['-y']), 'zh-CN', recordingDeps().deps);
    const projectPath = await generate(options);
    const pkg = await fs.readJson(path.join(projectPath, 'package.json'));
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      '@zhin.js/components', '@zhin.js/console-contract', '@zhin.js/layout', '@zhin.js/page', '@zhin.js/skill', 'zhin.js',
    ]);
    expect(pkg.dependencies['zhin.js']).toBe(scaffoldDependencyRange('zhin.js'));
    expect(Object.keys(pkg.devDependencies)).toContain('@zhin.js/cli');

    const config = parse(await fs.readFile(path.join(projectPath, 'zhin.config.yml'), 'utf8'));
    expect(config.plugins).toEqual({});
    expect(config.database).toBeUndefined();
    expect(config.http).toEqual({
      token: '${HTTP_TOKEN}', port: DEFAULT_CREATE_BOT_HTTP_PORT, base: '/api', corsOrigins: ['https://console.zhin.dev'],
    });
    expect(config.http.tokens).toBeUndefined();
    const { configVersion, plugins, ...hostConfig } = config;
    expect(configVersion).toBe(2);
    expect(plugins).toEqual({});
    const validate = configurationValidator().compile(HOST_CONFIG_SCHEMA);
    expect(validate(hostConfig), JSON.stringify(validate.errors)).toBe(true);

    const env = await fs.readFile(path.join(projectPath, '.env'), 'utf8');
    expect(env).toMatch(/^HTTP_TOKEN=generated-token$/mu);
  });

  it('adds driver, adapter and AI dependencies only when flags request them', async () => {
    const { options } = await resolveCreateOptions(
      parseCreateArgs(['bot', '-y', '--database', 'mysql', '--adapter', 'sandbox']), 'zh-CN', recordingDeps().deps);
    const pkg = await fs.readJson(path.join(await generate(options), 'package.json'));
    expect(pkg.dependencies.mysql2).toBeDefined();
    expect(pkg.dependencies['@zhin.js/adapter-sandbox']).toBeDefined();
    expect(pkg.dependencies['@zhin.js/agent']).toBeUndefined();
  });
});

describe('Console setup link', () => {
  it('URL-encodes apiBaseUrl from the generated config and keeps the token after #', async () => {
    const options: InitOptions = { config: 'yaml', httpToken: 'a b&c#d' };
    const apiBaseUrl = resolveConsoleApiBaseUrl(options);
    // The Console appends `/api/...` itself, so the default `http.base: /api` maps to the origin.
    expect(apiBaseUrl).toBe(`http://127.0.0.1:${DEFAULT_CREATE_BOT_HTTP_PORT}`);
    const link = buildConsoleSetupLink(apiBaseUrl, options.httpToken);
    expect(link).toBe(`https://console.zhin.dev/?apiBaseUrl=http%3A%2F%2F127.0.0.1%3A${DEFAULT_CREATE_BOT_HTTP_PORT}#token=a%20b%26c%23d`);
    const [beforeHash, fragment] = [link.slice(0, link.indexOf('#')), link.slice(link.indexOf('#') + 1)];
    expect(beforeHash).not.toContain('token');
    expect(new URL(link).searchParams.get('apiBaseUrl')).toBe(apiBaseUrl);
    expect(new URLSearchParams(fragment).get('token')).toBe('a b&c#d');
  });

  it('matches the port and base written to the project config', async () => {
    const { options } = await resolveCreateOptions(parseCreateArgs(['-y']), 'en', recordingDeps().deps);
    const config = parse(await fs.readFile(path.join(await generate(options), 'zhin.config.yml'), 'utf8'));
    expect(config.http.base).toBe('/api');
    expect(resolveConsoleApiBaseUrl(options)).toBe(`http://127.0.0.1:${config.http.port}`);
  });

  it.each(['zh-CN', 'en'] as const)('prints start instructions and the link in %s', (locale) => {
    const options: InitOptions = { config: 'yaml', httpToken: 'secret-token' };
    const lines = renderCreateSummary({ locale, projectName: 'my-bot', skipInstall: false, options, interactiveTerminal: true });
    expect(lines[0]).toBe(createText(locale, 'create.done.created', ['my-bot']));
    expect(lines[1]).toContain('cd my-bot && pnpm dev');
    expect(lines[3]).toBe(`  ${buildConsoleSetupLink(resolveConsoleApiBaseUrl(options), 'secret-token')}`);
    const tokenLines = lines.filter((line) => line.includes('secret-token'));
    expect(tokenLines).toHaveLength(1);
    expect(tokenLines[0]!.indexOf('secret-token')).toBeGreaterThan(tokenLines[0]!.indexOf('#token='));
    if (locale === 'en') expect(lines.join('\n')).not.toMatch(/[一-鿿]/u);
    else expect(lines[0]).toContain('项目已创建');
  });

  it('leaves the token out when output is not a terminal', () => {
    const options: InitOptions = { config: 'yaml', httpToken: 'secret-token' };
    const lines = renderCreateSummary({ locale: 'en', projectName: 'my-bot', skipInstall: true, options, interactiveTerminal: false });
    expect(lines.join('\n')).not.toContain('secret-token');
    expect(lines[3]).toBe(`  ${buildConsoleSetupLink(resolveConsoleApiBaseUrl(options))}`);
    expect(lines.join('\n')).toContain('HTTP_TOKEN');
    expect(lines[1]).toContain('cd my-bot && pnpm install && pnpm dev');
  });
});
