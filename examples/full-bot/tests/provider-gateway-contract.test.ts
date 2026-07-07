/**
 * full-bot L4：Provider 网关文档与配置风格契约
 * CI：pnpm check:l4
 *
 * 运行时 normalize / getLlmTransportModel 见 packages/im/ai/tests/llm/provider-gateway-presets.test.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const botRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const configText = fs.readFileSync(path.join(botRoot, 'zhin.config.yml'), 'utf8');
const readme = fs.readFileSync(path.join(botRoot, 'README.md'), 'utf8');

describe('full-bot provider gateway 契约', () => {
  it('默认 provider 显式 sdk（ollama）', () => {
    expect(configText).toMatch(/providers:\s*\n\s+ollama:/);
    expect(configText).toMatch(/sdk:\s*ollama/);
  });

  it('agents.zhin 绑定 ollama 与显式 model', () => {
    expect(configText).toMatch(/agents:\s*\n\s+zhin:/);
    expect(configText).toMatch(/provider:\s*ollama/);
    expect(configText).toMatch(/model:\s*qwen3:8b/);
  });

  it('README 链到 AI 网关 preset 文档', () => {
    expect(readme).toContain('已知 LLM 网关预设');
    expect(readme).toContain('docs/advanced/ai.md');
  });

  it('未混入 OpenCode 厨房水槽配置', () => {
    expect(configText).not.toMatch(/opencode:/);
    expect(configText).not.toMatch(/mimo-v2\.5-free/);
  });
});
