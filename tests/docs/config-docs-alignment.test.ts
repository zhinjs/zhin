/**
 * 配置文档与源码 DEFAULT_CONFIG / Stable 契约对齐（pnpm check:config-docs）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '../../packages/im/agent/src/zhin-agent/config.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configurationMd = fs.readFileSync(
  path.join(repoRoot, 'docs/essentials/configuration.md'),
  'utf8',
);
const aiMd = fs.readFileSync(path.join(repoRoot, 'docs/advanced/ai.md'), 'utf8');
const minimalConfig = fs.readFileSync(
  path.join(repoRoot, 'examples/minimal-bot/zhin.config.yml'),
  'utf8',
);

describe('config documentation alignment', () => {
  it('configuration.md 含 Agent 默认 maxIterations', () => {
    expect(configurationMd).toContain(`maxIterations: ${DEFAULT_CONFIG.maxIterations}`);
  });

  it('configuration.md 使用 summaryThreshold 而非已废弃字段', () => {
    expect(configurationMd).toMatch(/summaryThreshold/);
    expect(configurationMd).not.toMatch(/maxMessagesBeforeSummary/);
  });

  it('advanced/ai.md 含 DEFAULT_CONFIG 关键默认值', () => {
    expect(aiMd).toContain(String(DEFAULT_CONFIG.maxIterations));
    expect(aiMd).toContain(String(DEFAULT_CONFIG.timeout));
    expect(aiMd).not.toMatch(/maxMessagesBeforeSummary/);
  });

  it('minimal-bot 与 Stable 文档契约一致', () => {
    expect(minimalConfig).not.toMatch(/toolSearch:/);
    expect(minimalConfig).toMatch(/bots:\s*\[\]/);
  });
});
