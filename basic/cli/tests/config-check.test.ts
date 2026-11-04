import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { hostModelOwnerId } from '../src/plugin-runtime/personal-models/host-identity.js';
import { readConfig } from '../src/utils/config-file.js';
import {
  applyConfigFixes,
  inspectProjectConfig,
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

  function canonicalAi() {
    return {
      modelCatalog: {
        connections: { main: { id: 'main', ownerId: hostModelOwnerId(tmpDir), revision: 1, sdk: 'openai-compatible', baseUrl: 'https://provider.test/v1', secretRef: 'env://AI_KEY' } },
        models: { chat: { id: 'chat', connectionId: 'main', model: 'configured-model', capabilities: { input: ['text'] } } },
        presets: { main: { id: 'main', modelId: 'chat' } },
      },
      modelPolicy: { defaults: { chat: 'main', summary: 'main' } },
    };
  }

  it('validates explicit model catalog/policy without legacy providers or reading credentials', async () => {
    await fs.writeJson(path.join(tmpDir, 'zhin.config.json'), { configVersion: 2, plugins: {}, ai: canonicalAi() });
    const result = await runConfigCheck(tmpDir, {});
    expect(result.issues.filter(issue => ['config.legacy_v1', 'ai.model_config_invalid', 'ai.routing_invalid'].includes(issue.code))).toEqual([]);
  });

  it('reports explicit missing presets and forbidden lower-scope fields', async () => {
    const ai = canonicalAi();
    ai.modelPolicy.defaults.chat = 'missing';
    await fs.writeJson(path.join(tmpDir, 'zhin.config.json'), { configVersion: 2, plugins: {}, ai });
    const result = await runConfigCheck(tmpDir, {});
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'ai.model_config_invalid', severity: 'error' }));
    await fs.writeJson(path.join(tmpDir, 'zhin.config.json'), { configVersion: 2, plugins: {}, ai: { ...canonicalAi(), modelPolicy: { defaults: { chat: 'main' }, adapters: { sandbox: { summary: 'main' } } } } });
    const forbidden = await runConfigCheck(tmpDir, {});
    expect(forbidden.issues).toContainEqual(expect.objectContaining({ code: 'ai.model_config_invalid', message: expect.stringContaining('unknown field') }));
  });

  it('--fix preserves an explicit catalog and does not inject empty legacy sections', () => {
    const ai = canonicalAi();
    const { config } = applyConfigFixes({ ai });
    expect(config.ai).toEqual(ai);
    expect(config.ai).not.toHaveProperty('providers');
    expect(config.ai).not.toHaveProperty('agents');
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

  it('校验 ai.multimodal.perception（provider 必须是 ai.providers 别名）', async () => {
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
      code: 'ai.multimodal_perception_invalid',
      path: 'ai.multimodal.perception',
      message: expect.stringContaining('"gemini" is not defined in ai.providers'),
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
    expect(codes).toContain('ai.default_provider_deprecated');
    expect(codes).toContain('ai.provider_driver_deprecated');
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

  it('--fix 应迁移旧版 ai 段', async () => {
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
    expect((fixed.ai as { agents: { zhin: { provider: string; model: string } } }).agents.zhin).toEqual({
      provider: 'openai',
      model: 'gpt-4o-mini',
    });
    const fixedAi = fixed.ai as {
      defaultProvider?: string;
      providers: { openai: { sdk?: string; driver?: string } };
    };
    expect(fixedAi.defaultProvider).toBeUndefined();
    expect(fixedAi.providers.openai.sdk).toBe('openai');
    expect(fixedAi.providers.openai.driver).toBeUndefined();
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

  it('inspectProjectConfig --fix 应写回配置', async () => {
    await fs.writeFile(path.join(tmpDir, 'zhin.config.yml'), `
configVersion: 2
plugins: {sandbox: '@zhin.js/adapter-sandbox'}
sandbox: {}
database:
  dialect: postgres
log_level: 1
`);

    const before = await inspectProjectConfig(tmpDir);
    expect(before.issues.length).toBeGreaterThan(0);

    const after = await inspectProjectConfig(tmpDir, { fix: true });
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
