/**
 * 配置文档与源码 DEFAULT_CONFIG / Stable 契约对齐（pnpm check:config-docs）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '../../packages/im/agent/src/config/index.js';
import { DEFAULT_CREATE_BOT_HTTP_PORT } from '../../packages/toolkit/scaffold-wizard/src/zhin-stack-deps.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const configurationMd = fs.readFileSync(
  path.join(repoRoot, 'docs/configuration/index.md'),
  'utf8',
);
const configurationEnMd = fs.readFileSync(
  path.join(repoRoot, 'docs/en/configuration/index.md'),
  'utf8',
);
const aiMd = fs.readFileSync(path.join(repoRoot, 'docs/ai/agent.md'), 'utf8');
const gettingStartedMd = fs.readFileSync(path.join(repoRoot, 'docs/getting-started/index.md'), 'utf8');
const gettingStartedEnMd = fs.readFileSync(path.join(repoRoot, 'docs/en/getting-started/index.md'), 'utf8');
const aiPathMd = fs.readFileSync(path.join(repoRoot, 'docs/paths/ai-agent.md'), 'utf8');
const aiPathEnMd = fs.readFileSync(path.join(repoRoot, 'docs/en/paths/ai-agent.md'), 'utf8');
const consolePathMd = fs.readFileSync(path.join(repoRoot, 'docs/paths/console.md'), 'utf8');
const consolePathEnMd = fs.readFileSync(path.join(repoRoot, 'docs/en/paths/console.md'), 'utf8');
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

  it('configuration.md 文档化 thinkingPreview 配置项', () => {
    expect(configurationMd).toMatch(/thinkingPreview/);
    expect(configurationMd).toMatch(/thinkingPreviewMaxLength/);
  });

  it('中英文配置参考覆盖 Runtime 配置候选与触发默认值', () => {
    for (const content of [configurationMd, configurationEnMd]) {
      expect(content).toContain('zhin.config.json');
      expect(content).toContain("['#', 'AI:', 'ai:']");
      expect(content).toContain(String(DEFAULT_CREATE_BOT_HTTP_PORT));
      expect(content).toContain('8086');
    }
  });

  it('解决方案明确 Workroom 与 GitHub Project Item 的权威边界', () => {
    for (const relativePath of [
      'docs/solutions/github-workroom.md',
      'docs/en/solutions/github-workroom.md',
    ]) {
      const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
      expect(content, relativePath).toContain('Workroom');
      expect(content, relativePath).toContain('Project Item');
      expect(content, relativePath).toMatch(/Integration Port/);
      expect(content, relativePath).toMatch(/task-key/);
    }
  });

  it('minimal-bot 与 Stable 文档契约一致', () => {
    expect(minimalConfig).not.toMatch(/toolSearch:/);
    expect(minimalConfig).toMatch(/plugins:\s*\{\}/);
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

  it('首跑与 Console 路径跟随脚手架端口而非 Runtime fallback', () => {
    for (const content of [gettingStartedMd, gettingStartedEnMd, consolePathMd, consolePathEnMd]) {
      expect(content).toContain(String(DEFAULT_CREATE_BOT_HTTP_PORT));
      expect(content).not.toContain('http://127.0.0.1:8086');
    }
  });

  it('AI 学习路径安装完整 Feature 拓扑', () => {
    for (const content of [aiPathMd, aiPathEnMd]) {
      expect(content).toContain('zhin setup --ai');
      expect(content).toContain('@zhin.js/tool');
      expect(content).toContain('@zhin.js/prompt-section');
      expect(content).not.toContain('pnpm add @zhin.js/agent zod ai');
    }
  });

  it('Console 路径把 Workroom Catalog 与 ai 配置分离', () => {
    for (const content of [consolePathMd, consolePathEnMd]) {
      expect(content).toMatch(/Runtime Catalog/);
      expect(content).toContain('ai.workrooms');
    }
  });
});
