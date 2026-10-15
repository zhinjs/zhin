import {
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { conversationRefKey, type ConversationRef } from '@zhin.js/im-contract';
import { digestCanonicalWorkroomValue as digest } from '../../src/workroom/canonical-value.js';
import {
  FileHumanIngressProposalRepository,
  type HumanIngressFileSystem,
} from '../../src/workroom/file-human-ingress.js';
import {
  HumanIngressProposalService,
  MemoryHumanIngressProposalRepository,
  type HumanIngressProposalEvent,
  type HumanIngressProposalEventDraft,
  type HumanIngressProposalInput,
  type HumanIngressProposalRepository,
  type HumanIngressTargetResolverPort,
  type HumanPrincipalSnapshot,
} from '../../src/workroom/human-ingress.js';
import {
  InteractionSpaceRouter,
  MemoryInteractionSpaceBindingRepository,
  createInteractionSpaceBinding,
  type InteractionSpaceDecision,
} from '../../src/workroom/interaction-space-router.js';

const SHA_A = `sha256:${'a'.repeat(64)}`;
const SHA_B = `sha256:${'b'.repeat(64)}`;
const SHA_C = `sha256:${'c'.repeat(64)}`;
const cleanupDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

humanIngressRepositoryContract(
  'Memory Human Ingress repository',
  async () => new MemoryHumanIngressProposalRepository(),
);
humanIngressRepositoryContract(
  'File Human Ingress repository',
  async () => new FileHumanIngressProposalRepository(temporaryDirectory('contract')),
);

function humanIngressRepositoryContract(
  name: string,
  createRepository: () => Promise<HumanIngressProposalRepository>,
): void {
  describe(`${name} contract`, () => {
    it('allows exact replay but rejects same-position payload drift', async () => {
      const repository = await createRepository();
      const first = await fixtureEvent('conversation-event:first');
      await expect(repository.append('project:zhin', -1, [eventDraft(first)]))
        .resolves.toEqual([first]);
      await expect(repository.append('project:zhin', -1, [eventDraft(first)]))
        .resolves.toEqual([first]);

      const other = await fixtureEvent('conversation-event:other');
      await expect(repository.append('project:zhin', -1, [eventDraft(other)]))
        .rejects.toThrow(/replay payload drift/iu);
    });

    it('uses expected-sequence CAS and rejects duplicate proposal ids', async () => {
      const repository = await createRepository();
      const first = await fixtureEvent('conversation-event:first');
      await repository.append('project:zhin', -1, [eventDraft(first)]);

      await expect(repository.append('project:zhin', 0, [eventDraft(first)]))
        .rejects.toThrow(/event id is duplicated/iu);
      await expect(repository.append('project:zhin', 1, [eventDraft(await fixtureEvent('conversation-event:next'))]))
        .rejects.toThrow(/sequence conflict/iu);
      await expect(repository.read('project:zhin')).resolves.toEqual([first]);
    });

    it('snapshots caller-owned drafts before awaiting storage', async () => {
      const repository = await createRepository();
      const first = await fixtureEvent('conversation-event:snapshot');
      const mutable = structuredClone(eventDraft(first));

      const pending = repository.append('project:zhin', -1, [mutable]);
      (mutable as { eventId: string }).eventId = 'human-ingress:mutated';
      await expect(pending).resolves.toEqual([first]);
      await expect(repository.read('project:zhin')).resolves.toEqual([first]);
    });
  });
}

describe('FileHumanIngressProposalRepository durability', () => {
  it('preserves canonical proposal history across a real restart', async () => {
    const directory = temporaryDirectory('restart');
    const repository = new FileHumanIngressProposalRepository(directory);
    const first = await fixtureEvent('conversation-event:first');
    const second = await fixtureEvent('conversation-event:second', 1);

    await repository.append('project:zhin', -1, [eventDraft(first)]);
    await repository.append('project:zhin', 0, [eventDraft(second)]);

    const restarted = new FileHumanIngressProposalRepository(directory);
    const events = await restarted.read('project:zhin');
    expect(events).toEqual([first, second]);
    expect(Object.isFrozen(events)).toBe(true);
    expect(Object.isFrozen(events[0]?.proposal)).toBe(true);
  });

  it('allows one cross-instance hard-link CAS winner and only exact replay', async () => {
    const directory = temporaryDirectory('cross-instance');
    const left = new FileHumanIngressProposalRepository(directory);
    const right = new FileHumanIngressProposalRepository(directory);
    const leftEvent = await fixtureEvent('conversation-event:left');
    const rightEvent = await fixtureEvent('conversation-event:right');

    const outcomes = await Promise.allSettled([
      left.append('project:zhin', -1, [eventDraft(leftEvent)]),
      right.append('project:zhin', -1, [eventDraft(rightEvent)]),
    ]);

    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
    const [persisted] = await left.read('project:zhin');
    await expect(right.append('project:zhin', -1, [eventDraft(persisted!)]))
      .resolves.toEqual([persisted]);
    await expect(left.read('project:zhin')).resolves.toHaveLength(1);
  });

  it('never treats a hard-link collision without a persisted winner as success', async () => {
    const directory = temporaryDirectory('phantom-winner');
    const real = tracingFileSystem([]);
    const faulty: HumanIngressFileSystem = {
      ...real,
      async link() {
        const error = new Error('injected path collision') as NodeJS.ErrnoException;
        error.code = 'EEXIST';
        throw error;
      },
    };
    const repository = new FileHumanIngressProposalRepository(directory, faulty);

    await expect(repository.append(
      'project:zhin',
      -1,
      [eventDraft(await fixtureEvent('conversation-event:first'))],
    )).rejects.toThrow(/sequence conflict/iu);
    await expect(repository.read('project:zhin')).resolves.toEqual([]);
    expect(await readdir(directory)).toEqual([]);
  });

  it('fails closed on payload corruption, segment gaps, and filename position drift', async () => {
    const corruptDirectory = temporaryDirectory('corrupt');
    const first = await fixtureEvent('conversation-event:first');
    await new FileHumanIngressProposalRepository(corruptDirectory)
      .append('project:zhin', -1, [eventDraft(first)]);
    const [corruptName] = await readdir(corruptDirectory);
    const corrupt = JSON.parse(await readFile(join(corruptDirectory, corruptName!), 'utf8')) as {
      events: Array<{ eventId: string }>;
    };
    corrupt.events[0]!.eventId = 'human-ingress:corrupted';
    await writeFile(join(corruptDirectory, corruptName!), JSON.stringify(corrupt), 'utf8');
    await expect(new FileHumanIngressProposalRepository(corruptDirectory).read('project:zhin'))
      .rejects.toThrow(/digest/iu);

    const gapDirectory = temporaryDirectory('gap');
    const gapRepository = new FileHumanIngressProposalRepository(gapDirectory);
    await gapRepository.append('project:zhin', -1, [eventDraft(first)]);
    await gapRepository.append('project:zhin', 0, [eventDraft(await fixtureEvent('conversation-event:second', 1))]);
    const gapNames = (await readdir(gapDirectory)).sort();
    await unlink(join(gapDirectory, gapNames[0]!));
    await expect(new FileHumanIngressProposalRepository(gapDirectory).read('project:zhin'))
      .rejects.toThrow(/gap/iu);

    const nameDirectory = temporaryDirectory('filename');
    await new FileHumanIngressProposalRepository(nameDirectory)
      .append('project:zhin', -1, [eventDraft(first)]);
    const [name] = await readdir(nameDirectory);
    const drifted = name!.replace(/\.\d{16}\.json$/u, '.0000000000000001.json');
    await rename(join(nameDirectory, name!), join(nameDirectory, drifted));
    await expect(new FileHumanIngressProposalRepository(nameDirectory).read('project:zhin'))
      .rejects.toThrow(/name binding/iu);
  });

  it('binds every segment filename to the canonical Project id hash', async () => {
    const directory = temporaryDirectory('project-name');
    await new FileHumanIngressProposalRepository(directory)
      .append('project:zhin', -1, [eventDraft(await fixtureEvent('conversation-event:first'))]);
    const [name] = await readdir(directory);
    const drifted = name!.replace(/^[a-f0-9]{64}/u, 'f'.repeat(64));
    await rename(join(directory, name!), join(directory, drifted));

    await expect(new FileHumanIngressProposalRepository(directory).read('project:zhin'))
      .rejects.toThrow(/name binding/iu);
  });

  it('rejects digest-valid semantic corruption through the Memory contract validator', async () => {
    const directory = temporaryDirectory('semantic-corruption');
    const first = await fixtureEvent('conversation-event:control', 0, 'control', 'sponsor_room');
    await new FileHumanIngressProposalRepository(directory)
      .append('project:zhin', -1, [eventDraft(first)]);
    const [name] = await readdir(directory);
    const segment = JSON.parse(await readFile(join(directory, name!), 'utf8')) as {
      payloadDigest: string;
      events: Array<Record<string, unknown> & { proposal: Record<string, unknown> }>;
      [key: string]: unknown;
    };
    const event = segment.events[0]!;
    const proposal = event.proposal;
    proposal.authorityRequirement = 'none';
    const { digest: _proposalDigest, ...proposalContent } = proposal;
    proposal.digest = digest(proposalContent);
    const { digest: _eventDigest, ...eventContent } = event;
    event.digest = digest(eventContent);
    const { payloadDigest: _payloadDigest, ...segmentPayload } = segment;
    segment.payloadDigest = digest(segmentPayload);
    await writeFile(join(directory, name!), JSON.stringify(segment), 'utf8');

    await expect(new FileHumanIngressProposalRepository(directory).read('project:zhin'))
      .rejects.toThrow(/authority requirement/iu);
  });

  it('syncs parent, file, and leaf directory before confirming append', async () => {
    const directory = temporaryDirectory('durability-order');
    const trace: string[] = [];
    await new FileHumanIngressProposalRepository(directory, tracingFileSystem(trace))
      .append('project:zhin', -1, [eventDraft(await fixtureEvent('conversation-event:first'))]);

    const parentSync = trace.indexOf(`sync:r:${dirname(directory)}`);
    const fileSync = trace.findIndex(entry => entry.startsWith('sync:wx:'));
    const publish = trace.indexOf('link');
    const leafSync = trace.indexOf(`sync:r:${directory}`);
    expect(parentSync).toBeGreaterThan(-1);
    expect(fileSync).toBeGreaterThan(parentSync);
    expect(publish).toBeGreaterThan(fileSync);
    expect(leafSync).toBeGreaterThan(publish);
  });

  it('requires a pre-existing durable parent instead of recursively creating it', async () => {
    const root = temporaryDirectory('missing-parent');
    await mkdir(root);
    const directory = join(root, 'missing', 'human-ingress');

    await expect(new FileHumanIngressProposalRepository(directory).append(
      'project:zhin',
      -1,
      [eventDraft(await fixtureEvent('conversation-event:first'))],
    )).rejects.toThrow(/pre-existing durable parent/iu);
    await expect(readdir(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails before publication when the durable parent sync fails', async () => {
    const directory = temporaryDirectory('parent-sync-failure');
    const trace: string[] = [];
    const real = tracingFileSystem(trace);
    const faulty: HumanIngressFileSystem = {
      ...real,
      async open(path, flags) {
        const handle = await real.open(path, flags);
        if (flags !== 'r' || path !== dirname(directory)) return handle;
        return { ...handle, async sync() { throw new Error('injected parent sync failure'); } };
      },
    };

    await expect(new FileHumanIngressProposalRepository(directory, faulty).append(
      'project:zhin',
      -1,
      [eventDraft(await fixtureEvent('conversation-event:first'))],
    )).rejects.toThrow('parent sync failure');
    expect(trace.some(entry => entry.startsWith('open:wx:'))).toBe(false);
    expect(trace).not.toContain('link');
    expect(await readdir(directory)).toEqual([]);
  });

  it('does not publish or retain staging data when file sync fails', async () => {
    const directory = temporaryDirectory('file-sync-failure');
    const trace: string[] = [];
    const real = tracingFileSystem(trace);
    const faulty: HumanIngressFileSystem = {
      ...real,
      async open(path, flags) {
        const handle = await real.open(path, flags);
        if (flags !== 'wx') return handle;
        return { ...handle, async sync() { throw new Error('injected file sync failure'); } };
      },
    };

    await expect(new FileHumanIngressProposalRepository(directory, faulty).append(
      'project:zhin',
      -1,
      [eventDraft(await fixtureEvent('conversation-event:first'))],
    )).rejects.toThrow('file sync failure');
    expect(trace).not.toContain('link');
    expect(await readdir(directory)).toEqual([]);
  });

  it('never confirms a linked segment until retry successfully syncs the leaf', async () => {
    const directory = temporaryDirectory('leaf-sync-retry');
    const real = tracingFileSystem([]);
    let leafFailures = 2;
    const faulty: HumanIngressFileSystem = {
      ...real,
      async open(path, flags) {
        const handle = await real.open(path, flags);
        if (flags !== 'r' || path !== directory || leafFailures === 0) return handle;
        return {
          ...handle,
          async sync() {
            leafFailures -= 1;
            throw new Error('injected leaf sync failure');
          },
        };
      },
    };
    const event = await fixtureEvent('conversation-event:first');
    const repository = new FileHumanIngressProposalRepository(directory, faulty);

    await expect(repository.append('project:zhin', -1, [eventDraft(event)]))
      .rejects.toThrow('leaf sync failure');
    expect((await readdir(directory)).filter(name => name.endsWith('.tmp'))).toEqual([]);
    await expect(repository.append('project:zhin', -1, [eventDraft(event)]))
      .rejects.toThrow('leaf sync failure');
    await expect(repository.append('project:zhin', -1, [eventDraft(event)]))
      .resolves.toEqual([event]);
  });

  it('keeps staging randomness and filesystem time out of durable facts', async () => {
    const left = temporaryDirectory('deterministic-left');
    const right = temporaryDirectory('deterministic-right');
    const event = await fixtureEvent('conversation-event:first');
    await new FileHumanIngressProposalRepository(left)
      .append('project:zhin', -1, [eventDraft(event)]);
    await new FileHumanIngressProposalRepository(right)
      .append('project:zhin', -1, [eventDraft(event)]);
    const [leftName] = await readdir(left);
    const [rightName] = await readdir(right);

    expect(rightName).toBe(leftName);
    expect(await readFile(join(right, rightName!), 'utf8'))
      .toBe(await readFile(join(left, leftName!), 'utf8'));
  });
});

async function fixtureEvent(
  sourceRef: string,
  sequence = 0,
  intent: 'discussion' | 'work_request' | 'control' = 'work_request',
  space: 'workroom' | 'sponsor_room' = 'workroom',
): Promise<HumanIngressProposalEvent> {
  const seed = new MemoryHumanIngressProposalRepository();
  for (let index = 0; index <= sequence; index += 1) {
    const ref = index === sequence ? sourceRef : `${sourceRef}:prefix:${index}`;
    const outcome = await new HumanIngressProposalService(seed, unaddressedResolver(intent))
      .propose(await ingressInput(ref, space));
    if (outcome.status !== 'proposed') throw new Error('fixture did not propose');
    if (index === sequence) return outcome.event;
  }
  throw new Error('fixture sequence is invalid');
}

function eventDraft(event: HumanIngressProposalEvent): HumanIngressProposalEventDraft {
  return { eventId: event.eventId, type: event.type, proposal: event.proposal };
}

function unaddressedResolver(
  intent: 'discussion' | 'work_request' | 'control',
): HumanIngressTargetResolverPort {
  return {
    resolve: request => Object.freeze({
      ...request,
      status: 'unaddressed',
      intent,
      resolverRef: `resolver:unaddressed:${intent}`,
      resolverDigest: SHA_C,
    }),
  };
}

async function ingressInput(
  sourceRef: string,
  space: 'workroom' | 'sponsor_room',
): Promise<HumanIngressProposalInput> {
  return {
    decision: await resolvedDecision(space),
    sourceEvent: {
      version: 1,
      ref: sourceRef,
      digest: SHA_A,
      sequence: 1,
      conversation: conversation(),
    },
    principal: principal(),
  };
}

async function resolvedDecision(
  space: 'workroom' | 'sponsor_room',
): Promise<Extract<InteractionSpaceDecision, { status: 'resolved'; source: 'binding' }>> {
  const value = conversation();
  const repository = new MemoryInteractionSpaceBindingRepository();
  await repository.append(conversationRefKey(value), 0, [createInteractionSpaceBinding({
    conversation: value,
    bindingRevision: 1,
    effectiveAfterConversationSequence: 0,
    space,
    projectId: 'project:zhin',
    sourceRef: 'project-registry:binding:1',
    sourceDigest: SHA_B,
  })]);
  const decision = await new InteractionSpaceRouter(repository).resolve({
    conversation: value,
    conversationSequence: 1,
  });
  if (decision.status !== 'resolved' || decision.source !== 'binding') {
    throw new Error('fixture did not resolve');
  }
  return decision;
}

function conversation(): ConversationRef {
  return {
    endpoint: { adapter: 'plugin:github', id: 'endpoint:main' },
    kind: 'channel',
    id: 'repo:zhin',
    parent: { kind: 'group', id: 'org:zhinjs' },
    threadId: 'issue:842',
  };
}

function principal(): HumanPrincipalSnapshot {
  return Object.freeze({
    version: 1,
    ref: 'principal-snapshot:alice:7',
    revision: 7,
    digest: SHA_B,
    principalId: 'principal:alice',
    subjectId: 'github:alice',
    kind: 'human',
  });
}

function temporaryDirectory(label: string): string {
  const path = join(
    tmpdir(),
    `human-ingress-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  cleanupDirectories.push(path);
  return path;
}

function tracingFileSystem(trace: string[]): HumanIngressFileSystem {
  return {
    async mkdir(path) {
      trace.push(`mkdir:${path}`);
      await mkdir(path);
    },
    async readdir(path) {
      trace.push(`readdir:${path}`);
      return readdir(path);
    },
    readFile,
    async open(path, flags) {
      trace.push(`open:${flags}:${path}`);
      const handle = await open(path, flags);
      return {
        async writeFile(value, encoding) {
          trace.push(`write:${flags}:${path}`);
          await handle.writeFile(value, encoding);
        },
        async sync() {
          trace.push(`sync:${flags}:${path}`);
          await handle.sync();
        },
        async close() {
          trace.push(`close:${flags}:${path}`);
          await handle.close();
        },
      };
    },
    async link(existingPath, newPath) {
      trace.push('link');
      await link(existingPath, newPath);
    },
    async unlink(path) {
      trace.push(`unlink:${path}`);
      await unlink(path);
    },
  };
}
