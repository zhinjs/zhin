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
  FileInteractionSpaceBindingRepository,
  type InteractionSpaceBindingFileSystem,
} from '../../src/workroom/file-interaction-space-binding-repository.js';
import { createInteractionSpaceBinding } from '../../src/workroom/interaction-space-router.js';

const cleanupDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('File Interaction Space Binding Repository', () => {
  it('preserves canonical binding history across a real restart', async () => {
    const directory = temporaryDirectory('restart');
    const conversation = conversationFixture();
    const key = conversationRefKey(conversation);
    const first = bindingFixture(conversation, 1, 10, 'workroom');
    const second = bindingFixture(conversation, 2, 20, 'sponsor_room');
    const repository = new FileInteractionSpaceBindingRepository(directory);

    await repository.append(key, 0, [first]);
    await repository.append(key, 1, [second]);

    const restarted = new FileInteractionSpaceBindingRepository(directory);
    await expect(restarted.read(key)).resolves.toEqual([first, second]);
    expect(Object.isFrozen(await restarted.read(key))).toBe(true);
  });

  it('allows one cross-instance CAS winner and only exact replay', async () => {
    const directory = temporaryDirectory('cross-instance-cas');
    const conversation = conversationFixture();
    const key = conversationRefKey(conversation);
    const left = bindingFixture(conversation, 1, 10, 'workroom');
    const right = bindingFixture(conversation, 1, 11, 'sponsor_room');
    const first = new FileInteractionSpaceBindingRepository(directory);
    const second = new FileInteractionSpaceBindingRepository(directory);

    const raced = await Promise.allSettled([
      first.append(key, 0, [left]),
      second.append(key, 0, [right]),
    ]);

    expect(raced.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(raced.filter(result => result.status === 'rejected')).toHaveLength(1);
    const [persisted] = await first.read(key);
    await expect(second.append(key, 0, [persisted!])).resolves.toEqual([persisted]);
    const drifted = persisted?.digest === left.digest ? right : left;
    await expect(second.append(key, 0, [drifted])).rejects.toThrow(/drift|conflict/iu);
    await expect(first.read(key)).resolves.toEqual([persisted]);
  });

  it('fails closed on payload corruption, segment gaps, and filename position drift', async () => {
    const corruptDirectory = temporaryDirectory('payload-corruption');
    const conversation = conversationFixture();
    const key = conversationRefKey(conversation);
    await new FileInteractionSpaceBindingRepository(corruptDirectory)
      .append(key, 0, [bindingFixture(conversation, 1, 10, 'workroom')]);
    const [corruptName] = await readdir(corruptDirectory);
    const corruptSegment = JSON.parse(
      await readFile(join(corruptDirectory, corruptName!), 'utf8'),
    ) as { bindings: Array<{ sourceRef: string }> };
    corruptSegment.bindings[0]!.sourceRef = 'project-registry:corrupted';
    await writeFile(join(corruptDirectory, corruptName!), JSON.stringify(corruptSegment), 'utf8');
    await expect(new FileInteractionSpaceBindingRepository(corruptDirectory).read(key))
      .rejects.toThrow(/digest/iu);

    const gapDirectory = temporaryDirectory('segment-gap');
    const gapRepository = new FileInteractionSpaceBindingRepository(gapDirectory);
    await gapRepository.append(key, 0, [bindingFixture(conversation, 1, 10, 'workroom')]);
    await gapRepository.append(key, 1, [bindingFixture(conversation, 2, 20, 'sponsor_room')]);
    const gapNames = (await readdir(gapDirectory)).sort();
    await unlink(join(gapDirectory, gapNames[0]!));
    await expect(new FileInteractionSpaceBindingRepository(gapDirectory).read(key))
      .rejects.toThrow(/gap/iu);

    const nameDirectory = temporaryDirectory('filename-drift');
    await new FileInteractionSpaceBindingRepository(nameDirectory)
      .append(key, 0, [bindingFixture(conversation, 1, 10, 'workroom')]);
    const [name] = await readdir(nameDirectory);
    const driftedName = name!.replace(/\.\d{16}\.json$/u, '.0000000000000002.json');
    await rename(join(nameDirectory, name!), join(nameDirectory, driftedName));
    await expect(new FileInteractionSpaceBindingRepository(nameDirectory).read(key))
      .rejects.toThrow(/name binding/iu);
  });

  it('binds every segment filename to the canonical conversation key hash', async () => {
    const directory = temporaryDirectory('conversation-key-name');
    const conversation = conversationFixture();
    const key = conversationRefKey(conversation);
    await new FileInteractionSpaceBindingRepository(directory)
      .append(key, 0, [bindingFixture(conversation, 1, 10, 'workroom')]);
    const [name] = await readdir(directory);
    const foreignHash = 'f'.repeat(64);
    const driftedName = name!.replace(/^[a-f0-9]{64}/u, foreignHash);
    await rename(join(directory, name!), join(directory, driftedName));

    await expect(new FileInteractionSpaceBindingRepository(directory).read(key))
      .rejects.toThrow(/name binding/iu);
  });

  it('syncs parent, file, and leaf directory before confirming append', async () => {
    const directory = temporaryDirectory('durability-order');
    const trace: string[] = [];
    const conversation = conversationFixture();
    await new FileInteractionSpaceBindingRepository(directory, tracingFileSystem(trace))
      .append(
        conversationRefKey(conversation),
        0,
        [bindingFixture(conversation, 1, 10, 'workroom')],
      );

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
    const directory = join(root, 'missing', 'bindings');
    const conversation = conversationFixture();

    await expect(new FileInteractionSpaceBindingRepository(directory).append(
      conversationRefKey(conversation),
      0,
      [bindingFixture(conversation, 1, 10, 'workroom')],
    )).rejects.toThrow(/pre-existing durable parent/iu);
    await expect(readdir(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never confirms a linked segment until a retry successfully syncs the leaf', async () => {
    const directory = temporaryDirectory('leaf-sync-retry');
    const realFileSystem = tracingFileSystem([]);
    let remainingLeafFailures = 2;
    const faulty: InteractionSpaceBindingFileSystem = {
      ...realFileSystem,
      async open(path, flags) {
        const handle = await realFileSystem.open(path, flags);
        if (flags !== 'r' || path !== directory || remainingLeafFailures === 0) return handle;
        return {
          ...handle,
          async sync() {
            remainingLeafFailures -= 1;
            throw new Error('injected leaf sync failure');
          },
        };
      },
    };
    const conversation = conversationFixture();
    const key = conversationRefKey(conversation);
    const binding = bindingFixture(conversation, 1, 10, 'workroom');
    const repository = new FileInteractionSpaceBindingRepository(directory, faulty);

    await expect(repository.append(key, 0, [binding])).rejects.toThrow('leaf sync failure');
    expect((await readdir(directory)).filter(name => name.endsWith('.tmp'))).toEqual([]);
    await expect(repository.append(key, 0, [binding])).rejects.toThrow('leaf sync failure');
    await expect(repository.append(key, 0, [binding])).resolves.toEqual([binding]);
    await expect(repository.read(key)).resolves.toEqual([binding]);
  });

  it('fails before publication when the durable parent sync fails', async () => {
    const directory = temporaryDirectory('parent-sync-failure');
    const trace: string[] = [];
    const realFileSystem = tracingFileSystem(trace);
    const faulty: InteractionSpaceBindingFileSystem = {
      ...realFileSystem,
      async open(path, flags) {
        const handle = await realFileSystem.open(path, flags);
        if (flags !== 'r' || path !== dirname(directory)) return handle;
        return {
          ...handle,
          async sync() {
            throw new Error('injected parent sync failure');
          },
        };
      },
    };
    const conversation = conversationFixture();

    await expect(new FileInteractionSpaceBindingRepository(directory, faulty).append(
      conversationRefKey(conversation),
      0,
      [bindingFixture(conversation, 1, 10, 'workroom')],
    )).rejects.toThrow('parent sync failure');
    expect(trace.some(entry => entry.startsWith('open:wx:'))).toBe(false);
    expect(trace).not.toContain('link');
    expect(await readdir(directory)).toEqual([]);
  });

  it('does not publish or retain staging data when file sync fails', async () => {
    const directory = temporaryDirectory('file-sync-failure');
    const trace: string[] = [];
    const realFileSystem = tracingFileSystem(trace);
    const faulty: InteractionSpaceBindingFileSystem = {
      ...realFileSystem,
      async open(path, flags) {
        const handle = await realFileSystem.open(path, flags);
        if (flags !== 'wx') return handle;
        return {
          ...handle,
          async sync() {
            throw new Error('injected file sync failure');
          },
        };
      },
    };
    const conversation = conversationFixture();

    await expect(new FileInteractionSpaceBindingRepository(directory, faulty).append(
      conversationRefKey(conversation),
      0,
      [bindingFixture(conversation, 1, 10, 'workroom')],
    )).rejects.toThrow('file sync failure');
    expect(trace).not.toContain('link');
    expect(await readdir(directory)).toEqual([]);
  });

  it('fails closed when a digest-valid replay decreases the sequence anchor', async () => {
    const directory = temporaryDirectory('anchor-corruption');
    const conversation = conversationFixture();
    const key = conversationRefKey(conversation);
    await new FileInteractionSpaceBindingRepository(directory).append(key, 0, [
      bindingFixture(conversation, 1, 10, 'workroom'),
      bindingFixture(conversation, 2, 20, 'sponsor_room'),
    ]);
    const [name] = await readdir(directory);
    const segment = JSON.parse(await readFile(join(directory, name!), 'utf8')) as {
      payloadDigest: string;
      bindings: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    const second = segment.bindings[1]!;
    second.effectiveAfterConversationSequence = 9;
    const { digest: _bindingDigest, ...bindingPayload } = second;
    second.digest = digest(bindingPayload);
    const { payloadDigest: _payloadDigest, ...segmentPayload } = segment;
    segment.payloadDigest = digest(segmentPayload);
    await writeFile(join(directory, name!), JSON.stringify(segment), 'utf8');

    await expect(new FileInteractionSpaceBindingRepository(directory).read(key))
      .rejects.toThrow(/anchor/iu);
  });

  it('snapshots immutable facts before awaiting filesystem I/O', async () => {
    const directory = temporaryDirectory('input-snapshot');
    const conversation = conversationFixture();
    const key = conversationRefKey(conversation);
    const mutable = JSON.parse(JSON.stringify(
      bindingFixture(conversation, 1, 10, 'workroom'),
    )) as ReturnType<typeof bindingFixture>;
    const repository = new FileInteractionSpaceBindingRepository(directory);

    const pending = repository.append(key, 0, [mutable]);
    (mutable as { sourceRef: string }).sourceRef = 'project-registry:mutated';
    await pending;

    await expect(repository.read(key)).resolves.toMatchObject([
      { sourceRef: 'project-registry:binding:1' },
    ]);
  });

  it('keeps filesystem time and staging randomness out of durable facts', async () => {
    const leftDirectory = temporaryDirectory('deterministic-left');
    const rightDirectory = temporaryDirectory('deterministic-right');
    const conversation = conversationFixture();
    const key = conversationRefKey(conversation);
    const binding = bindingFixture(conversation, 1, 10, 'workroom');
    await new FileInteractionSpaceBindingRepository(leftDirectory).append(key, 0, [binding]);
    await new FileInteractionSpaceBindingRepository(rightDirectory).append(key, 0, [binding]);
    const [leftName] = await readdir(leftDirectory);
    const [rightName] = await readdir(rightDirectory);

    expect(rightName).toBe(leftName);
    expect(await readFile(join(rightDirectory, rightName!), 'utf8'))
      .toBe(await readFile(join(leftDirectory, leftName!), 'utf8'));
  });
});

function conversationFixture(): ConversationRef {
  return {
    endpoint: { adapter: 'plugin:github', id: 'endpoint:github-main' },
    kind: 'channel',
    id: 'repo:zhin',
    parent: { kind: 'group', id: 'org:zhinjs' },
    threadId: 'issue:842',
  };
}

function bindingFixture(
  conversation: ConversationRef,
  bindingRevision: number,
  effectiveAfterConversationSequence: number,
  space: 'chat' | 'workroom' | 'sponsor_room',
) {
  return createInteractionSpaceBinding({
    conversation,
    bindingRevision,
    effectiveAfterConversationSequence,
    space,
    ...(space === 'chat' ? {} : { projectId: 'project:zhin' }),
    sourceRef: `project-registry:binding:${bindingRevision}`,
    sourceDigest: `sha256:${String(bindingRevision).repeat(64)}`,
  });
}

function temporaryDirectory(label: string): string {
  const root = join(
    tmpdir(),
    `interaction-space-binding-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  cleanupDirectories.push(root);
  return root;
}

function tracingFileSystem(trace: string[]): InteractionSpaceBindingFileSystem {
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
