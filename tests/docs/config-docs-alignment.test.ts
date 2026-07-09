/**
 * 配置文档与源码 DEFAULT_CONFIG / Stable 契约对齐（pnpm check:config-docs）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '../../packages/im/agent/src/config/index.js';

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
const highTrafficConfigDocs = [
  'README.md',
  'packages/toolkit/create-zhin/README.md',
  'packages/im/agent/README.md',
  ...collectMarkdownFiles(path.join(repoRoot, 'docs'))
    .map((file) => path.relative(repoRoot, file))
    .filter((file) => !file.startsWith('docs/adr/') && !file.startsWith('docs/api/')),
];

function collectMarkdownFiles(dir: string, files: string[] = []): string[] {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectMarkdownFiles(full, files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

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
    expect(minimalConfig).toMatch(/endpoints:\s*\[\]/);
  });

  it('configuration.md 文档化语义记忆与弃用 memoryMcp', () => {
    expect(configurationMd).toMatch(/semantic:\s*\n\s*enabled:/);
    expect(configurationMd).toContain('memory_search');
    expect(configurationMd).toContain('memory_upsert');
    expect(configurationMd).toMatch(/memoryMcp/);
    expect(configurationMd).toMatch(/三层 Markdown/);
  });

  it('高流量配置文档不再展示旧 provider 字段', () => {
    for (const relativePath of highTrafficConfigDocs) {
      const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
      expect(content, relativePath).not.toMatch(/api:\s*ollama-chat/);
      expect(content, relativePath).not.toMatch(/driver 应迁移为 api/);
    }
  });
});
