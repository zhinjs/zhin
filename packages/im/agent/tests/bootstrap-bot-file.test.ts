import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOT_BOOTSTRAP_FILENAMES,
  BOOTSTRAP_FILENAMES,
  botBootstrapFilenames,
  buildContextFiles,
  hasBotBootstrapFile,
  loadAgentsMemory,
  loadBootstrapFiles,
} from '../src/bootstrap.js';
import { buildAgentsEnvelopeContext, collectAgentsInstructionChain } from '../src/context/agents-instruction.js';
import { loadBootstrapWithProfile } from '../src/assistant/profile-loader.js';

// #1250 bootstrap-dev-vs-bot: BOT.md, when present, is the only instruction file the bot reads.
describe('BOT.md bootstrap', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'zhin-bot-md-'));
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    await writeFile(join(root, 'SOUL.md'), 'soul');
    await writeFile(join(root, 'AGENTS.md'), 'developer notes: run pnpm build');
    await writeFile(join(root, 'TOOLS.md'), 'tools');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it('lists BOT.md instead of AGENTS.md as a bootstrap file only when it exists', async () => {
    expect(botBootstrapFilenames(false)).toEqual(BOOTSTRAP_FILENAMES);
    expect(botBootstrapFilenames(true)).toEqual(['SOUL.md', 'BOT.md', 'TOOLS.md']);
    expect(BOT_BOOTSTRAP_FILENAMES).toContain('BOT.md');
    expect(await hasBotBootstrapFile(root)).toBe(false);
    expect((await loadBootstrapFiles(root)).map(file => file.name)).toEqual(['SOUL.md', 'AGENTS.md', 'TOOLS.md']);

    await writeFile(join(root, 'BOT.md'), 'bot instructions');
    expect(await hasBotBootstrapFile(root)).toBe(true);
    const files = await loadBootstrapFiles(root);
    expect(files.map(file => file.name)).toEqual(['SOUL.md', 'BOT.md', 'TOOLS.md']);
    const context = buildContextFiles(files).map(file => file.content).join('\n');
    expect(context).toContain('bot instructions');
    expect(context).not.toContain('developer notes');
    expect(await loadAgentsMemory(root)).toBe('bot instructions');
  });

  it('ignores an empty BOT.md and finds one under data/', async () => {
    await writeFile(join(root, 'BOT.md'), '  \n');
    expect(await hasBotBootstrapFile(root)).toBe(false);
    await rm(join(root, 'BOT.md'));
    await mkdir(join(root, 'data'));
    await writeFile(join(root, 'data', 'BOT.md'), 'data bot');
    expect(await loadAgentsMemory(root)).toBe('data bot');
  });

  it('replaces the AGENTS.md chain in the turn envelope', async () => {
    await mkdir(join(root, 'sub'));
    await writeFile(join(root, 'sub', 'AGENTS.md'), 'nested developer notes');
    expect((await buildAgentsEnvelopeContext(root)) ?? '').toContain('developer notes');

    await writeFile(join(root, 'BOT.md'), 'bot instructions');
    const chain = await collectAgentsInstructionChain(root);
    expect(chain).toEqual([{ path: 'BOT.md', content: 'bot instructions' }]);
    const envelope = await buildAgentsEnvelopeContext(root) ?? '';
    expect(envelope).toContain('## BOT.md');
    expect(envelope).not.toContain('developer notes');
    // The system prompt already carries the root file: nothing is sent twice.
    expect(await collectAgentsInstructionChain(root, { excludeRoot: true })).toEqual([]);
  });

  it('puts BOT.md in the AGENTS slot of a profile merge', async () => {
    await writeFile(join(root, 'BOT.md'), 'bot instructions');
    await writeFile(join(root, 'assistant.profile.yml'), 'version: 1\n');
    const { files, profile } = await loadBootstrapWithProfile(root, { enabled: true });
    expect(profile).not.toBeNull();
    expect(files.map(file => file.name)).toContain('BOT.md');
    expect(files.map(file => file.name)).not.toContain('AGENTS.md');
  });
});
