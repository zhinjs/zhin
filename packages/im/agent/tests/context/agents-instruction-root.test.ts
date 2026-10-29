import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAgentsEnvelopeContext } from '../../src/context/agents-instruction.js';

describe('AGENTS.md envelope chain', () => {
  let root: string | undefined;
  afterEach(async () => {
    vi.restoreAllMocks();
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it('skips the root AGENTS.md when the system prompt already carries it, keeping nearer ones', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'zhin-agents-'));
    const sub = path.join(root, 'plugins', 'music');
    await mkdir(sub, { recursive: true });
    await writeFile(path.join(root, 'AGENTS.md'), 'ROOT RULES');
    await writeFile(path.join(sub, 'AGENTS.md'), 'MUSIC RULES');
    vi.spyOn(process, 'cwd').mockReturnValue(sub);

    const both = await buildAgentsEnvelopeContext(root);
    expect(both).toContain('ROOT RULES');
    expect(both).toContain('MUSIC RULES');

    const nearOnly = await buildAgentsEnvelopeContext(root, undefined, { excludeRoot: true });
    expect(nearOnly).toContain('MUSIC RULES');
    expect(nearOnly).not.toContain('ROOT RULES');
  });

  it('returns nothing when the root AGENTS.md is the only one and the system prompt has it', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'zhin-agents-'));
    await writeFile(path.join(root, 'AGENTS.md'), 'ROOT RULES');
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    expect(await buildAgentsEnvelopeContext(root, undefined, { excludeRoot: true })).toBeNull();
  });
});
