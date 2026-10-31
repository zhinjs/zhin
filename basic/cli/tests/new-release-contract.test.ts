import fs from 'fs-extra';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@zhin.js/scaffold-wizard', () => ({ scaffoldDependencyRange: () => 'latest' }));
const { newCommand } = await import('../src/commands/new.js');

afterEach(() => { vi.restoreAllMocks(); });

it('refuses unknown release metadata before creating any scaffold directory', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'zhin-new-release-'));
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('test process exit'); });
  vi.spyOn(process, 'cwd').mockReturnValue(directory);
  try {
    await expect(newCommand.parseAsync(['new-adapter', '--standalone', '--type', 'adapter', '--skip-install'], { from: 'user' }))
      .rejects.toThrow('test process exit');
    expect(exit).toHaveBeenCalledWith(1);
    expect(await fs.pathExists(path.join(directory, 'new-adapter'))).toBe(false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
