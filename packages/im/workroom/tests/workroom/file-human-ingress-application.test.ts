import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  FileHumanIngressApplicationRepository,
  HumanIngressApplicationReplayConflictError,
  MemoryHumanIngressApplicationRepository,
  type HumanIngressApplicationEventDraft,
} from '../../src/index.js';

const sha = (character: string): string => `sha256:${character.repeat(64)}`;

const claim = (variant: string): HumanIngressApplicationEventDraft => ({
  type: 'proposal.claimed',
  eventId: 'human-ingress-application:proposal:1:1:proposal.claimed',
  proposalId: 'proposal:1',
  proposalDigest: sha('a'),
  operationId: 'human-ingress-application:proposal:1',
  occurredAt: variant.includes('two') ? 1_001 : 1_000,
  attempt: 1,
  fence: 1,
  leaseExpiresAt: variant.includes('two') ? 2_001 : 2_000,
});

describe('FileHumanIngressApplicationRepository', () => {
  let root = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'zhin-human-ingress-application-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('replays a committed lifecycle after repository restart', async () => {
    const directory = join(root, 'applications');
    const first = new FileHumanIngressApplicationRepository(directory);
    const written = await first.append('project-alpha', -1, [claim('claim:1')]);

    const restarted = new FileHumanIngressApplicationRepository(directory);
    expect(await restarted.read('project-alpha')).toEqual(written);
  });

  it('allows only one cross-instance CAS winner', async () => {
    const directory = join(root, 'applications');
    const one = new FileHumanIngressApplicationRepository(directory);
    const two = new FileHumanIngressApplicationRepository(directory);

    const results = await Promise.allSettled([
      one.append('project-alpha', -1, [claim('claim:one')]),
      two.append('project-alpha', -1, [claim('claim:two')]),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')[0]).toMatchObject({
      reason: expect.any(HumanIngressApplicationReplayConflictError),
    });
  });

  it('fails closed when durable lifecycle payload is corrupted', async () => {
    const directory = join(root, 'applications');
    const repository = new FileHumanIngressApplicationRepository(directory);
    await repository.append('project-alpha', -1, [claim('claim:1')]);
    const name = (await readdir(directory)).find(value => value.endsWith('.json'))!;
    const parsed = JSON.parse(await readFile(join(directory, name), 'utf8')) as Record<string, unknown>;
    parsed.payloadDigest = sha('f');
    await import('node:fs/promises').then(fs => fs.writeFile(join(directory, name), JSON.stringify(parsed)));

    await expect(new FileHumanIngressApplicationRepository(directory).read('project-alpha'))
      .rejects.toThrow('digest');
  });

  it('has the same replay contract as the memory adapter', async () => {
    const file = new FileHumanIngressApplicationRepository(join(root, 'applications'));
    const memory = new MemoryHumanIngressApplicationRepository();
    const draft = claim('claim:1');
    expect(await file.append('project-alpha', -1, [draft]))
      .toEqual(await memory.append('project-alpha', -1, [draft]));
    expect(await file.append('project-alpha', -1, [draft]))
      .toEqual(await memory.append('project-alpha', -1, [draft]));
  });
});
