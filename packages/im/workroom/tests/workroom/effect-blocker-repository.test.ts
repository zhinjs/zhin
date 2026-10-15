import { mkdtemp, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DurableWorkroomEffectBlockerControl,
  FileWorkroomEffectBlockerRepository,
} from '../../src/workroom/effect-blocker-repository.js';

describe('File Workroom Effect blocker repository', () => {
  it('persists one blocker without tick churn and records exact recovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhin-effect-blocker-'));
    const directory = join(root, 'blockers');
    await mkdir(root, { recursive: true });
    const repository = new FileWorkroomEffectBlockerRepository(directory);
    const control = new DurableWorkroomEffectBlockerControl(repository, () => 100);
    const blocker = {
      projectId: 'project-1', effectId: 'effect:1', owner: 'github-capability' as const,
      policy: { kind: 'root_emergency_fallback' as const, ref: 'root-emergency:1', digest: sha('1') },
      reason: 'Generation-owned GitHub capability is unavailable', deadline: 1_000,
      allowedSuccessors: ['retry', 'cancel'] as const,
    };
    await control.block(blocker);
    await control.block({ ...blocker, deadline: 2_000 });
    expect(await readdir(directory)).toHaveLength(1);
    expect(await repository.read('project-1', 'effect:1')).toMatchObject({
      revision: 1, status: 'blocked', deadline: 1_000,
    });
    await control.recover('project-1', 'effect:1');
    await control.recover('project-1', 'effect:1');
    expect(await readdir(directory)).toHaveLength(2);
    expect(await repository.read('project-1', 'effect:1')).toMatchObject({
      revision: 2, status: 'resolved', resolvedAt: 100,
    });
    const disk = (await Promise.all((await readdir(directory)).map(name =>
      readFile(join(directory, name), 'utf8')))).join('');
    expect(disk).not.toMatch(/credential|private.?key|token/iu);
  });
});

function sha(char: string): string { return `sha256:${char.repeat(64)}`; }
