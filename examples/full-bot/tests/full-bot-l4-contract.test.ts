/**
 * full-bot L4 配置契约（CI：pnpm check:l4）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const botRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const configText = fs.readFileSync(path.join(botRoot, 'zhin.config.yml'), 'utf8');

describe('full-bot L4 配置契约', () => {
  it('ADR 0024 Pipeline 取代 Missions 配置开关', () => {
    expect(configText).not.toMatch(/hardMode:/);
    expect(configText).not.toMatch(/autoAdvance:/);
    expect(configText).not.toMatch(/MISSIONS_TEMPLATE/);
  });

  it('启用语义记忆 semantic', () => {
    expect(configText).toMatch(/memory:\s*\n/);
    expect(configText).toMatch(/semantic:\s*\n/);
    expect(configText).toMatch(/enabled:\s*true/);
    expect(configText).toMatch(/autoConsolidate:\s*false/);
  });

  it('三适配器 + MCP + A2A + host', () => {
    expect(configText).toContain('@zhin.js/adapter-sandbox');
    expect(configText).toContain('@zhin.js/adapter-napcat');
    expect(configText).toContain('@zhin.js/adapter-kook');
    expect(configText).toContain('@zhin.js/mcp');
    expect(configText).toContain('@zhin.js/a2a');
    expect(configText).toContain('@zhin.js/host-router');
    expect(configText).toContain('@zhin.js/host-api');
  });

  it('loopback remoteAgents 指向本机 A2A Agent Card', () => {
    expect(configText).toMatch(/remoteAgents:/);
    expect(configText).toMatch(/id:\s*local/);
    expect(configText).toMatch(/cardUrl:/);
    expect(configText).toMatch(/\/a2a\/zhin\/.well-known\/agent-card\.json/);
  });

  it('MEMORY 纲领与 memory-consolidate skill 存在', () => {
    const memory = fs.readFileSync(
      path.join(botRoot, 'data/memory/global/MEMORY.md'),
      'utf8',
    );
    expect(memory).toContain('项目总监');
    const skill = fs.readFileSync(
      path.join(botRoot, 'skills/memory-consolidate/SKILL.md'),
      'utf8',
    );
    expect(skill).toContain('memory_upsert');
    expect(skill).toContain('memory_search');
  });

  it('README 链到 ACCEPTANCE L4 段', () => {
    const readme = fs.readFileSync(path.join(botRoot, 'README.md'), 'utf8');
    expect(readme).toContain('ACCEPTANCE.md');
    expect(readme).toContain('L4');
  });
});
