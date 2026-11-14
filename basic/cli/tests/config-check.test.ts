import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { readConfig, saveConfig } from '../../../packages/host/gateway/src/project/config-file.js';
import {
  applyConfigFixes,
  runConfigCheck,
  summarizeIssues,
} from '../src/utils/config-check.js';

describe('config check', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-config-check-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  /** Mirrors `zhin config check --fix`: check, apply the safe fixes, write back, re-check. */
  async function checkAndFix(env: Record<string, string | undefined> = process.env) {
    const before = await runConfigCheck(tmpDir, env);
    const { config: fixed, fixes } = applyConfigFixes(before.config, tmpDir);
    if (fixes.length > 0) await saveConfig(path.join(tmpDir, before.configFile!), fixed, before.config);
    return { fixesApplied: fixes, issues: (await runConfigCheck(tmpDir, env)).issues };
  }

  function canonicalAi() {
    return { agent: { maxIterations: 8 } };
  }

  it('validates startup runtime settings without model authorities or credential reads', async () => {
    await fs.writeJson(path.join(tmpDir, 'zhin.config.json'), { configVersion: 2, plugins: {}, ai: canonicalAi() });
    const result = await runConfigCheck(tmpDir, {});
    expect(result.issues.filter(issue => ['ai.model_config_invalid', 'ai.inference_migration_required', 'ai.agent_missing'].includes(issue.code))).toEqual([]);
  });

  it.each([
    { modelCatalog: { connections: {}, models: {}, presets: {} } },
    { modelPolicy: { defaults: { chat: 'missing' } } },
    { modelPolicy: { adapters: { sandbox: { summary: 'main' } } } },
  ])('requires an explicit migration for retired startup model authority %j', async legacy => {
    await fs.writeJson(path.join(tmpDir, 'zhin.config.json'), { configVersion: 2, plugins: {}, ai: { ...canonicalAi(), ...legacy } });
    const result = await runConfigCheck(tmpDir, {});
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'ai.inference_migration_required', severity: 'error' }));
  });

  it('rejects an embedded plan instead of installing startup model resources', async () => {
    await fs.writeJson(path.join(tmpDir, 'zhin.config.json'), { configVersion: 2, plugins: {}, ai: { ...canonicalAi(), plan: { version: 1 } } });
    const result = await runConfigCheck(tmpDir, {});
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'ai.model_config_invalid', severity: 'error' }));
  });

  it('--fix preserves runtime settings without injecting retired model authorities', () => {
    const ai = canonicalAi();
    const { config } = applyConfigFixes({ ai });
    expect(config.ai).toEqual(ai);
    expect(config.ai).not.toHaveProperty('providers');
    expect(config.ai).not.toHaveProperty('agents');
    expect(config.ai).not.toHaveProperty('plan');
  });

  it('数据库连接变量缺失时应阻止启动并给出向导修复命令', async () => {
    await fs.writeFile(path.join(tmpDir, 'zhin.config.yml'), `
configVersion: 2
plugins: {}
database:
  dialect: pg
  host: \${DB_HOST}
  port: \${DB_PORT}
  user: \${DB_USER}
  password: \${DB_PASSWORD}
  database: \${DB_DATABASE}
`);

    const result = await runConfigCheck(tmpDir, {
      DB_HOST: '127.0.0.1',
      DB_USER: 'postgres',
      DB_PASSWORD: '',
      DB_DATABASE: 'zhin_bot',
    });
    expect(summarizeIssues(result.issues).exitCode).toBe(1);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'database.env_unresolved',
      path: 'database.port',
      fixHint: expect.stringContaining('zhin setup --database'),
    }));
  });

  it('检查 schema 外的数据库连接串环境引用', async () => {
    await fs.writeFile(path.join(tmpDir, 'zhin.config.yml'), `
configVersion: 2
database:
  dialect: pg
  connectionString: postgresql://\${DB_USER}:\${DB_PASSWORD}@localhost/zhin
`);
    const result = await runConfigCheck(tmpDir, { DB_USER: 'postgres' });
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'database.env_unresolved',
      path: 'database.connectionString',
      message: expect.stringContaining('DB_PASSWORD'),
    }));
  });

  it('requires migration of the entire old perception/provider authority', async () => {
    await fs.writeFile(path.join(tmpDir, 'zhin.config.yml'), `
configVersion: 2
ai:
  providers:
    groq:
      sdk: openai-compatible
      apiKey: test
      baseUrl: https://api.groq.com/openai/v1
  agents:
    zhin:
      provider: groq
      model: openai/gpt-oss-120b
  multimodal:
    perception:
      provider: gemini
      model: gemini-flash-lite
`);
    const result = await runConfigCheck(tmpDir, {});
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'ai.inference_migration_required',
      path: 'ai',
      message: expect.stringContaining('providers'),
    }));
  });

  it('应检测废弃的 ai.defaultProvider 与 provider driver/api', async () => {
    await fs.writeFile(path.join(tmpDir, 'zhin.config.yml'), `
configVersion: 2
plugins: {sandbox: '@zhin.js/adapter-sandbox'}
sandbox: {}
ai:
  defaultProvider: openai
  agent:
    chatModel: gpt-4o-mini
  providers:
    openai:
      driver: openai
      apiKey: test
    ollama:
      api: ollama-chat
      host: http://127.0.0.1:11434
`);

    const result = await runConfigCheck(tmpDir, { OPENAI_API_KEY: 'x' });
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain('ai.inference_migration_required');
  });

  it('AI 已启用时应报告缺少 agent 栈依赖', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'bot',
      dependencies: { 'zhin.js': '^4.0.0' },
    }));
    await fs.writeFile(path.join(tmpDir, 'zhin.config.yml'), `
configVersion: 2
plugins: {sandbox: '@zhin.js/adapter-sandbox'}
sandbox: {}
ai:
  enabled: true
  agents:
    zhin:
      provider: openai
      model: gpt-4o
  providers:
    openai:
      sdk: openai
`);

    const result = await runConfigCheck(tmpDir);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain('ai.deps_missing');
  });

  it('--fix preserves old model resources and credentials for explicit migration', async () => {
    const config = {
      plugins: { sandbox: {} },
      endpoints: [{ context: 'sandbox', name: 'bot' }],
      database: { dialect: 'postgres' },
      ai: {
        defaultProvider: 'openai',
        agent: { chatModel: 'gpt-4o-mini' },
        providers: {
          openai: { driver: 'openai', apiKey: 'test' },
        },
      },
    };

    const { config: fixed, fixes } = applyConfigFixes(config);
    expect(fixes.some((f) => f.includes('adapter-sandbox'))).toBe(false);
    expect((fixed.database as { dialect: string }).dialect).toBe('pg');
    expect(fixed.ai).toEqual(config.ai);
    expect(fixes.every(fix => !fix.includes('ai.'))).toBe(true);
  });

  it('legacy plugins 数组与顶层 endpoints 报整体迁移错误', async () => {
    await fs.writeFile(path.join(tmpDir, 'zhin.config.yml'), `
configVersion: 2
plugins:
  - "@zhin.js/adapter-sandbox"
endpoints:
  - context: qq
    name: zhin
`);

    const result = await runConfigCheck(tmpDir);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain('config.parse_error');
    expect(result.issues[0]?.message).toMatch(/plugins|configVersion/);
  });

  it('新形态 plugins.<instanceKey> 的键与形态校验', async () => {
    await fs.writeFile(path.join(tmpDir, 'zhin.config.yml'), `
configVersion: 2
plugins:
  "1bad-key": {}
  sandbox: "not-an-object"
`);

    const result = await runConfigCheck(tmpDir);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain('config.parse_error');
  });

  it('新形态 plugins.<instanceKey> 合法配置不误报', async () => {
    await fs.writeFile(path.join(tmpDir, 'zhin.config.yml'), `
configVersion: 2
plugins: {sandbox: '@zhin.js/adapter-sandbox'}
sandbox: {}
`);

    const result = await runConfigCheck(tmpDir);
    expect(result.issues.some((i) => i.code.startsWith('plugins.'))).toBe(false);
    expect(result.issues.some((i) => i.code.startsWith('endpoints.'))).toBe(false);
  });

  it('unset ${VAR} in the block of a plugin listed in disable_plugins is info, not a warning (#1250)', async () => {
    await fs.writeFile(path.join(tmpDir, 'zhin.config.yml'), `
configVersion: 2
plugins: {qq: '@zhin.js/adapter-qq', rss: 'rss-plugin'}
disable_plugins: [qq]
qq:
  appid: \${QQ_APPID}
  endpoints:
    - secret: \${QQ_SECRET}
rss:
  key: \${RSS_KEY}
`);

    const { issues } = await runConfigCheck(tmpDir, {});
    const env = issues.filter(issue => issue.code.startsWith('env.'));
    expect(env.filter(issue => issue.severity === 'warn').map(issue => issue.path)).toEqual(['rss.key']);
    expect(env.filter(issue => issue.severity === 'info').map(issue => issue.path).sort()).toEqual(['qq.appid', 'qq.endpoints[0].secret']);
    expect(env.find(issue => issue.path === 'qq.appid')!.message).toContain('插件实例 qq 已停用');
    expect(summarizeIssues(issues, true).warnings).toBe(issues.filter(issue => issue.severity === 'warn').length);
  });

  it('config check --fix 应写回配置', async () => {
    await fs.writeFile(path.join(tmpDir, 'zhin.config.yml'), `
configVersion: 2
plugins: {sandbox: '@zhin.js/adapter-sandbox'}
sandbox: {}
database:
  dialect: postgres
log_level: 1
`);

    const before = await runConfigCheck(tmpDir);
    expect(before.issues.length).toBeGreaterThan(0);

    const after = await checkAndFix();
    expect(after.fixesApplied.length).toBeGreaterThan(0);
    const raw = await readConfig(path.join(tmpDir, 'zhin.config.yml'));
    expect((raw.database as { dialect: string }).dialect).toBe('pg');
    expect(raw.log_level).toBe('info');
  });

  it('--fix 应将数字 log_level 规范为字符串', () => {
    const { config: fixed, fixes } = applyConfigFixes({ log_level: 1, plugins: {} });
    expect(fixed.log_level).toBe('info');
    expect(fixes.some((f) => f.includes('log_level'))).toBe(true);
  });

  it('fixes only nonfunctional switches in a runtime configuration through the actual CLI file path', async () => {
    await fs.writeJson(path.join(tmpDir, 'zhin.config.json'), { configVersion: 2, plugins: {},
      ai: { ...canonicalAi(), agent: { ...canonicalAi().agent, maxSkills: 3 }, allowedTools: ['old-tool'] } });
    const before = await runConfigCheck(tmpDir, {});
    expect(before.issues).toContainEqual(expect.objectContaining({ code: 'ai.agent_maxSkills_deprecated', severity: 'warn', fixable: true }));
    expect(before.issues).toContainEqual(expect.objectContaining({ code: 'ai.allowedTools_deprecated', severity: 'warn', fixable: true }));
    await checkAndFix({});
    const after = await readConfig(path.join(tmpDir, 'zhin.config.json'));
    expect(after.ai).toEqual(canonicalAi());
    expect(after.ai).not.toHaveProperty('providers');
  });

  it('preserves legacy model identity and credential input during CLI switch maintenance', async () => {
    const ai = { agent: { chatModel: 'original-model', maxSkills: 3 },
      providers: { original: { sdk: 'openai', apiKey: 'synthetic-config-only-key' } } };
    await fs.writeJson(path.join(tmpDir, 'zhin.config.json'), { configVersion: 2, plugins: {}, ai });
    const result = await checkAndFix({});
    const after = await readConfig(path.join(tmpDir, 'zhin.config.json'));
    expect(after.ai).toEqual({ ...ai, agent: { chatModel: 'original-model' } });
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'ai.inference_migration_required', severity: 'error' }));
    expect(result.fixesApplied).toContain('removed deprecated ai.agent.maxSkills');
    expect(after.ai).not.toHaveProperty('plan');
  });

  it('strict 模式应将警告计为失败', () => {
    const summary = summarizeIssues([
      { severity: 'warn', code: 'x', message: 'warn' },
    ], true);
    expect(summary.exitCode).toBe(1);
  });
});

describe('config check: deprecated ai.agent keys (#735)', () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-config-check-735-'));
  });
  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('报告可修复的弃用警告', async () => {
    await fs.writeFile(path.join(tmpDir, 'zhin.config.yml'), `
configVersion: 2
plugins: {}
ai:
  enabled: true
  agent:
    maxSkills: 3
`);
    const result = await runConfigCheck(tmpDir, {});
    const issue = result.issues.find((i) => i.code === 'ai.agent_maxSkills_deprecated');
    expect(issue?.severity).toBe('warn');
    expect(issue?.fixable).toBe(true);
  });
});

describe('config check: deprecated ai.agents.<name>.priority/match', () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'zhin-config-check-routing-'));
  });
  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('报告可修复的弃用警告，不再报路由错误', async () => {
    await fs.writeFile(path.join(tmpDir, 'zhin.config.yml'), `
configVersion: 2
plugins: {}
ai:
  enabled: true
  providers:
    p: { sdk: openai, apiKey: k }
  agents:
    zhin: { provider: p, model: m, priority: 1 }
    vision:
      provider: p
      model: v
      match: { hasMedia: [image] }
`);
    const result = await runConfigCheck(tmpDir, {});
    const routing = result.issues.filter((i) => i.code === 'ai.agent_routing_deprecated');
    expect(routing.map((i) => i.path)).toEqual(['ai.agents.zhin.priority', 'ai.agents.vision.match']);
    expect(routing.every((i) => i.severity === 'warn' && i.fixable)).toBe(true);
    expect(result.issues.some((i) => i.code === 'ai.routing_invalid')).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'ai.inference_migration_required', severity: 'error' }));
  });

  it('--fix 删除 priority/match', () => {
    const { config: fixed, fixes } = applyConfigFixes({
      plugins: {},
      ai: {
        providers: { p: { sdk: 'openai', apiKey: 'k' } },
        agents: {
          zhin: { provider: 'p', model: 'm' },
          vision: { provider: 'p', model: 'v', priority: 10, match: { hasMedia: ['image'] } },
        },
      },
    });
    expect((fixed.ai as { agents: unknown }).agents).toEqual({
      zhin: { provider: 'p', model: 'm' },
      vision: { provider: 'p', model: 'v' },
    });
    expect(fixes).toContain('removed deprecated ai.agents.vision.priority');
    expect(fixes).toContain('removed deprecated ai.agents.vision.match');
  });
});
