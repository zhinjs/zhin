import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
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

  it('应检测废弃的 ai.defaultProvider 与 provider driver/api', async () => {
    await fs.writeFile(path.join(tmpDir, 'zhin.config.yml'), `
plugins:
  - "@zhin.js/adapter-sandbox"
endpoints:
  - context: sandbox
    name: bot
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
plugins:
  - "@zhin.js/adapter-sandbox"
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
      plugins: ['@zhin.js/adapter-process', '@zhin.js/host-router'],
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
    expect(fixes.some((f) => f.includes('adapter-sandbox'))).toBe(true);
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

  it('应报告 bot 缺少对应 adapter 插件', async () => {
    await fs.writeFile(path.join(tmpDir, 'zhin.config.yml'), `
plugins:
  - "@zhin.js/adapter-sandbox"
endpoints:
  - context: qq
    name: zhin
`);

    const result = await runConfigCheck(tmpDir);
    expect(result.issues.some((i) => i.code === 'endpoint.adapter_plugin_missing')).toBe(true);

    const raw = await readConfig(path.join(tmpDir, 'zhin.config.yml'));
    const { config: fixed } = applyConfigFixes(raw);
    expect((fixed.plugins as string[]).includes('@zhin.js/adapter-qq')).toBe(true);
  });

  it('inspectProjectConfig --fix 应写回配置', async () => {
    await fs.writeFile(path.join(tmpDir, 'zhin.config.yml'), `
plugins:
  - "@zhin.js/adapter-sandbox"
endpoints:
  - context: qq
    name: zhin
`);

    const before = await inspectProjectConfig(tmpDir);
    expect(before.issues.some((i) => i.code === 'endpoint.adapter_plugin_missing')).toBe(true);

    const after = await inspectProjectConfig(tmpDir, { fix: true });
    expect(after.fixesApplied.length).toBeGreaterThan(0);
    expect(after.issues.every((i) => i.code !== 'endpoint.adapter_plugin_missing')).toBe(true);
  });

  it('--fix 应将数字 log_level 规范为字符串', () => {
    const { config: fixed, fixes } = applyConfigFixes({ log_level: 1, plugins: [] });
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
