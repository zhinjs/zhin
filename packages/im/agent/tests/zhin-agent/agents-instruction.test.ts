import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  collectAgentsInstructionChain,
  buildAgentsEnvelopeContext,
  clearAgentsInstructionCache,
} from '../../src/context/agents-instruction.js';
import { clearBootstrapCache } from '../../src/bootstrap.js';

describe('agents-instruction', () => {
  let tmpDir: string;
  let prevCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-agents-'));
    prevCwd = process.cwd();
    clearAgentsInstructionCache();
    clearBootstrapCache();
  });

  afterEach(() => {
    process.chdir(prevCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    clearAgentsInstructionCache();
    clearBootstrapCache();
  });

  it('缺文件时返回空链', async () => {
    process.chdir(tmpDir);
    const chain = await collectAgentsInstructionChain(tmpDir);
    expect(chain).toEqual([]);
    expect(await buildAgentsEnvelopeContext(tmpDir)).toBeNull();
  });

  it('子目录近、root 远合并顺序', async () => {
    const sub = path.join(tmpDir, 'packages', 'foo');
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'AGENTS.md'), 'root agents');
    fs.writeFileSync(path.join(sub, 'AGENTS.md'), 'near agents');

    process.chdir(sub);
    const chain = await collectAgentsInstructionChain(tmpDir);
    expect(chain.map(e => e.content)).toEqual(['near agents', 'root agents']);
    expect(chain[0].path).toContain('packages/foo/AGENTS.md');

    const envelope = await buildAgentsEnvelopeContext(tmpDir);
    expect(envelope).toContain('[Agents instructions]');
    expect(envelope).toContain('near agents');
    expect(envelope).toContain('root agents');
    expect(envelope!.indexOf('near agents')).toBeLessThan(envelope!.indexOf('root agents'));
  });

  it('data/AGENTS.md 作为 root fallback', async () => {
    const dataDir = path.join(tmpDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'AGENTS.md'), 'data agents');
    process.chdir(tmpDir);
    const chain = await collectAgentsInstructionChain(tmpDir);
    expect(chain).toHaveLength(1);
    expect(chain[0].content).toBe('data agents');
  });
});
