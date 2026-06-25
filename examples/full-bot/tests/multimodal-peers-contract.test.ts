/**
 * full-bot multimodal optional peer 配置契约
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const botRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const configText = fs.readFileSync(path.join(botRoot, 'zhin.config.yml'), 'utf8');

describe('full-bot multimodal peers contract', () => {
  it('含 multimodal 配置注释块（speech / htmlRenderer）', () => {
    expect(configText).toMatch(/# speech:/);
    expect(configText).toMatch(/# htmlRenderer:/);
    expect(configText).toMatch(/strategy: transcribe/);
  });

  it('README 指向 ai-content-chain 文档', () => {
    const readme = fs.readFileSync(path.join(botRoot, 'README.md'), 'utf8');
    expect(readme).toMatch(/多模态|ai-content-chain|doctor --upgrade-l4/i);
  });
});
