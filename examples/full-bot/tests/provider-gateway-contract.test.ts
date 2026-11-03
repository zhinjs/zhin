/**
 * full-bot L4：Provider 网关文档与配置风格契约
 * CI：pnpm check:l4
 *
 * 正式目录合同见 packages/im/ai/tests/llm/explicit-model-directory.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const botRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const planText = fs.readFileSync(path.join(botRoot, 'ai.plan.yml'), 'utf8');
const configText = fs.readFileSync(path.join(botRoot, 'zhin.config.yml'), 'utf8');
const readme = fs.readFileSync(path.join(botRoot, 'README.md'), 'utf8');

describe('full-bot provider gateway 契约', () => {
  it('默认 provider 显式 sdk（ollama）', () => {
    expect(planText).toMatch(/services:\s*\n\s+ollama:/);
    expect(planText).toMatch(/driver:\s*ollama/);
  });

  it('standalone import proposal selects the explicit chat model', () => {
    expect(configText).not.toMatch(/plan:/);
    expect(planText).toMatch(/purposes:\s*\n\s+chat:/);
    expect(planText).toMatch(/account:\s*ollama/);
    expect(planText).toMatch(/model:\s*qwen3:8b/);
  });

  it('README 链到 AI 网关 preset 文档', () => {
    expect(readme).toContain('模型服务与订阅账号');
    expect(readme).toContain('docs/ai/providers.md');
  });

  it('未混入 OpenCode 厨房水槽配置', () => {
    expect(planText).not.toMatch(/opencode:/);
    expect(planText).not.toMatch(/mimo-v2\.5-free/);
  });
});
