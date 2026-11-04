import { inflateSync } from 'node:zlib';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Adapter, AdapterIndex, adapterFeatureId, createEndpointSpecification, defineAdapter, endpointSpec,
  endpointEventGatewayToken, type Endpoint, type EndpointControl } from 'zhin.js/adapter';
import { createCapabilitySlot, createSnapshotView, rootPluginId, type SnapshotState } from 'zhin.js/plugin-runtime';

it.each([
  ['unsupported_operation', 'not_sent', 'unsupported'],
  ['endpoint_disconnected', 'not_sent', 'failed'],
  ['platform_rejected', 'rejected', 'failed'],
  ['unsupported_operation', 'unknown', 'unknown'],
])('classifies recall failure %s/%s in both executable probes', async (code, disposition, result) => {
  const probes = [
    (await import('../../scripts/platform-acceptance/probe-command.js')).default,
    (await import('../../examples/platform-acceptance-bot/commands/acceptance/index.js')).default,
  ];
  const directory = await mkdtemp(join(tmpdir(), 'zhin-probe-'));
  const previousPolicy = process.env.ZHIN_ACCEPTANCE_POLICY;
  try {
    for (const [index, probe] of probes.entries()) {
      const eventsPath = join(directory, `events-${index}.jsonl`);
      const policyPath = join(directory, 'policy.json');
      await writeFile(policyPath, JSON.stringify({ version: 1, platform: 'test', actions: ['reply-recall'], minIntervalMs: 1000, maxSends: 1, eventsPath, targets: [{ alias: 'private-a', adapter: 'root/test', endpoint: 'test', kind: 'private', id: 'room' }] }));
      process.env.ZHIN_ACCEPTANCE_POLICY = policyPath;
      const endpoint = { recall: async () => { throw Object.assign(new Error('controlled failure'), { code, disposition }); } };
      await probe.execute({
        input: { content: 'probe:sample123 action:reply-recall', conversation: { endpoint: { id: 'test', adapter: 'test' }, kind: 'private', id: 'room' }, $reply: async () => ({ status: 'sent', message: { id: 'message' } }) },
        endpoint: 'test', generation: 1,
        project: () => ({ connection: () => ({ transportState: 'open' }), control: () => endpoint, resolve: () => 'test', clientAdapter: () => 'test', describe: () => [{ id: 'test', admitted: true }] }),
      } as never);
      const events = (await readFile(eventsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      expect(events.map(event => event.result)).toEqual(['unknown', result]);
    }
  } finally {
    if (previousPolicy === undefined) delete process.env.ZHIN_ACCEPTANCE_POLICY;
    else process.env.ZHIN_ACCEPTANCE_POLICY = previousPolicy;
    await rm(directory, { recursive: true, force: true });
  }
});

it('both probes select only fixed image samples, preserve legacy evidence and emit a valid opaque RGB PNG', async () => {
  const probes = [(await import('../../scripts/platform-acceptance/probe-command.js')).default, (await import('../../examples/platform-acceptance-bot/commands/acceptance/index.js')).default];
  const directory = await mkdtemp(join(tmpdir(), 'zhin-images-'));
  const previous = process.env.ZHIN_ACCEPTANCE_POLICY;
  const images: string[] = [];
  try {
    for (const [index, probe] of probes.entries()) {
      const eventsPath = join(directory, `events-${index}.jsonl`); const policyPath = join(directory, 'policy.json');
      await writeFile(policyPath, JSON.stringify({ version: 1, platform: 'test', actions: ['reply-image'], minIntervalMs: 1000, maxSends: 3, eventsPath, targets: [{ alias: 'private-a', adapter: 'root/test', endpoint: 'test', kind: 'private', id: 'room' }] }));
      process.env.ZHIN_ACCEPTANCE_POLICY = policyPath;
      const reply = vi.fn(async (payload: any) => { images.push(payload[1].data.media.value); return { status: 'sent', message: { id: 'image' } }; });
      const context = (content: string) => ({ input: { content, conversation: { endpoint: { id: 'test', adapter: 'test' }, kind: 'private', id: 'room' }, $reply: reply }, endpoint: 'test', generation: 1, project: () => ({ connection: () => ({}), resolve: () => 'test', clientAdapter: () => 'test', describe: () => [{ id: 'test', admitted: true }] }) });
      await probe.execute(context('probe:image0001 action:reply-image image:https://example.com/secret') as never);
      expect(reply).not.toHaveBeenCalled();
      await probe.execute(context('probe:image0001 action:reply-image') as never);
      const legacyEvents = (await readFile(eventsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      expect(legacyEvents.every(event => event.imageSample === 'legacy')).toBe(true);
      // Keep the old result; only age its attempt to permit the second fixed sample.
      legacyEvents[0].time = new Date(Date.now() - 2000).toISOString();
      await writeFile(eventsPath, legacyEvents.map(event => JSON.stringify(event)).join('\n') + '\n');
      await probe.execute(context('probe:image0001 action:reply-image image:rgb') as never);
      expect(reply).toHaveBeenCalledTimes(2);
      const events = (await readFile(eventsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      expect(events[2].sample).not.toBe(events[0].sample); expect(events[3].imageSample).toBe('rgb');
    }
    expect(images[0]).toBe(images[2]); expect(images[1]).toBe(images[3]); expect(images[0]).not.toBe(images[1]);
    const png = Buffer.from(images[1], 'base64');
    const crc32 = (bytes: Buffer) => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; };
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const tags: string[] = []; let scanlines = Buffer.alloc(0);
    for (let offset = 8; offset < png.length;) {
      const length = png.readUInt32BE(offset); const tag = png.toString('ascii', offset + 4, offset + 8); const data = png.subarray(offset + 8, offset + 8 + length); tags.push(tag);
      expect(png.readUInt32BE(offset + 8 + length)).toBe(crc32(png.subarray(offset + 4, offset + 8 + length)));
      if (tag === 'IHDR') { expect(data.readUInt32BE(0)).toBe(128); expect(data.readUInt32BE(4)).toBe(128); expect([...data.subarray(8)]).toEqual([8, 2, 0, 0, 0]); }
      if (tag === 'IDAT') scanlines = inflateSync(data);
      offset += length + 12;
    }
    expect(tags).toEqual(['IHDR', 'IDAT', 'IEND']); expect(scanlines.length).toBe(128 * (1 + 128 * 3));
    for (let row = 0; row < 128; row++) expect(scanlines[row * 385]).toBe(0);
  } finally { if (previous === undefined) delete process.env.ZHIN_ACCEPTANCE_POLICY; else process.env.ZHIN_ACCEPTANCE_POLICY = previous; await rm(directory, { recursive: true, force: true }); }
});

it('authorizes the resolved policy instance instead of comparing an owner with the canonical platform name', async () => {
  const probes = [(await import('../../scripts/platform-acceptance/probe-command.js')).default, (await import('../../examples/platform-acceptance-bot/commands/acceptance/index.js')).default];
  const directory = await mkdtemp(join(tmpdir(), 'zhin-probe-identity-'));
  const previous = process.env.ZHIN_ACCEPTANCE_POLICY;
  try {
    for (const [number, probe] of probes.entries()) {
      const eventsPath = join(directory, `events-${number}.jsonl`);
      const policyPath = join(directory, 'policy.json');
      await writeFile(policyPath, JSON.stringify({ version: 1, platform: 'test', actions: ['reply-text'], minIntervalMs: 1000, maxSends: 1, eventsPath,
        targets: [{ alias: 'private-a', adapter: 'root/allowed', endpoint: 'bot', kind: 'private', id: 'room' }] }));
      process.env.ZHIN_ACCEPTANCE_POLICY = policyPath;
      const reply = vi.fn(async () => ({ status: 'sent', message: { id: 'sent' } }));
      const connection = vi.fn(() => ({ transportState: 'open' }));
      const index = { connection, resolve: (owner: string, id: string) => owner === 'root/allowed' && id === 'bot' ? 'allowed-id' : undefined,
        clientAdapter: () => 'test', describe: () => [{ id: 'allowed-id', admitted: true }] };
      const input = { content: 'probe:sample123', conversation: { endpoint: { id: 'foreign-id', adapter: 'test' }, kind: 'private', id: 'room' }, $reply: reply };
      const context = { input, endpoint: 'bot', generation: 1, project: () => index };
      await probe.execute(context as never);
      expect(reply).not.toHaveBeenCalled();
      expect(connection).not.toHaveBeenCalled();
      await probe.execute({ ...context, input: { ...input, conversation: { ...input.conversation, endpoint: { id: 'allowed-id', adapter: 'test' } } } } as never);
      expect(reply).toHaveBeenCalledOnce();
      expect(connection).toHaveBeenCalledWith('root/allowed', 'bot');
      expect(JSON.parse((await readFile(eventsPath, 'utf8')).trim().split('\n').at(-1)!)).toMatchObject({ target: 'private-a', result: 'confirmed' });
    }
  } finally {
    if (previous === undefined) delete process.env.ZHIN_ACCEPTANCE_POLICY;
    else process.env.ZHIN_ACCEPTANCE_POLICY = previous;
    await rm(directory, { recursive: true, force: true });
  }
});


it('both recall probes use the actual leased control port while connection exposes only facts', async () => {
  const recall = vi.fn<NonNullable<EndpointControl['recall']>>(async () => undefined);
  class NativeClient { nativeMethod() { return 'native'; } }
  class ProbeEndpoint extends NativeClient implements Endpoint {
    readonly [endpointSpec] = createEndpointSpecification(this, { start() {}, open() {}, close() {}, stop() {},
      send: () => 'sent', control: { recall } });
  }
  class ProbeAdapter extends Adapter<ProbeEndpoint> { protected createEndpoint() { return new ProbeEndpoint(); } }
  const root = rootPluginId();
  const slot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'test', source: '/fixture/adapters/test/index.ts',
    definition: defineAdapter({ capabilities: ['outbound'], operations: ['recall'], createAdapter: () => new ProbeAdapter() }) });
  const state: SnapshotState = { root, tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
    config: new Map([[root, { id: 'bot' }]]), capabilities: new Map([[slot.id, slot]]), projections: new Map(),
    resources: new Map([[root, new Map([[endpointEventGatewayToken.id, { receive: async () => undefined }]])]]) };
  const index = await AdapterIndex.create([slot], createSnapshotView(0, state), new AbortController().signal);
  const directory = await mkdtemp(join(tmpdir(), 'zhin-recall-port-'));
  const previous = process.env.ZHIN_ACCEPTANCE_POLICY;
  try {
    await index.activate(new AbortController().signal);
    const connection = index.connection('test', 'bot')!;
    expect(connection).not.toHaveProperty('control');
    const probes = [(await import('../../scripts/platform-acceptance/probe-command.js')).default,
      (await import('../../examples/platform-acceptance-bot/commands/acceptance/index.js')).default];
    for (const [number, probe] of probes.entries()) {
      const eventsPath = join(directory, `${number}.jsonl`), policyPath = join(directory, 'policy.json');
      await writeFile(policyPath, JSON.stringify({ version: 1, platform: 'test', actions: ['reply-recall'], minIntervalMs: 1000,
        maxSends: 1, eventsPath, targets: [{ alias: 'test-a', adapter: 'test', endpoint: 'bot', kind: 'private', id: 'room' }] }));
      process.env.ZHIN_ACCEPTANCE_POLICY = policyPath;
      const conversation = { endpoint: { id: String(slot.id), adapter: 'test' }, kind: 'private' as const, id: 'room' };
      await probe.execute({ endpoint: 'bot', generation: 0, project: () => index,
        input: { content: 'probe:actual123 action:reply-recall', conversation,
          $reply: async () => ({ status: 'sent', message: { conversation, id: 'real-message' } }) } } as never);
      expect(recall).toHaveBeenCalledTimes(number + 1);
      expect(recall).toHaveBeenLastCalledWith({ message: { conversation, id: 'real-message' }, signal: expect.any(AbortSignal) });
      const events = (await readFile(eventsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      expect(events.map(event => event.result)).toEqual(['unknown', 'confirmed']);
    }
  } finally {
    if (previous === undefined) delete process.env.ZHIN_ACCEPTANCE_POLICY; else process.env.ZHIN_ACCEPTANCE_POLICY = previous;
    await index.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
