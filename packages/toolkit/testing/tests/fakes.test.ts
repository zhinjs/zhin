import type { OperationSession } from 'zhin.js';
import { defineCommand } from '@zhin.js/command';
import { defineMiddleware } from '@zhin.js/middleware';
import {
  createToken, databaseHostToken, definePlugin, outboundHostToken, scheduleHostToken,
} from '@zhin.js/plugin-runtime';
import {
  createFakeMessage, createFakePlugin, fakeResource, runCommand, runMiddleware, runHandler, createCommandContext, runPluginSetup, FakeClock,
} from '../src/index.js';

const greeterToken = createToken<{ greet(name: string): string }>('test.greeter');

const plugin = definePlugin<{ target: string }>({
  name: 'demo',
  requires: [scheduleHostToken, outboundHostToken],
  async setup({ resources, config, lifecycle }) {
    const db = resources.use(databaseHostToken);
    db.define('notes', { text: { type: 'text' } });
    await db.models.get('notes')!.insert({ text: 'hello' });
    const outbound = resources.use(outboundHostToken);
    lifecycle.add(resources.use(scheduleHostToken).register({
      id: 'ping', cron: '*/30 * * * * *',
      execute: async () => {
        await outbound.send({ adapter: 'test', endpointKey: 'bot',
          conversation: { kind: 'group', id: config.get().target }, content: 'ping' });
      },
    }));
    return () => { disposed = true; };
  },
});
let disposed = false;

describe('testing fakes', () => {
  it('does not manufacture an operation Session for direct fake runners', async () => {
    const fake = createFakePlugin();
    expect(createCommandContext(fake).session).toBeUndefined();
    await runMiddleware(fake, defineMiddleware({ handle(context) {
      expect(context.session).toBeUndefined();
    } }));
    await runHandler(fake, { $feature: 'zhin.handler/1', handle() {
      expect(this.session).toBeUndefined();
    } });
    await fake.dispose();
  });

  it('reads a supplied operation hook without copying its Session in fake runners', async () => {
    const fake = createFakePlugin();
    const session: OperationSession<string> = {
      adapterName: 'test', adapter: {}, endpoint: {}, scene: { endpoint: { id: 'ep', adapter: 'test' }, kind: 'private', id: 'u' },
      message: { text: 'hello', receivedAt: 1 }, event: {}, signal: fake.signal, reply: async () => undefined,
    };
    const input = Object.assign(createFakeMessage(), { [Symbol.for('zhin.operation-session/1')]: () => session });
    expect(createCommandContext(fake, { input }).session).toBe(session);
    await runMiddleware(fake, defineMiddleware({ handle(context) {
      expect(context.session).toBe(session);
    } }), input);
    await runHandler(fake, { $feature: 'zhin.handler/1', handle(first) {
      expect(first).toBe(input);
      expect(this.session).toBe(session);
    } }, input);
    await fake.dispose();
  });

  it('runs setup on a real Scope with fake hosts, clock and outbound recording', async () => {
    disposed = false;
    const fake = await runPluginSetup(plugin, { config: { target: 'g1' } });
    expect(fake.missingRequirements(plugin)).toEqual([]);
    expect(fake.rows('notes')).toEqual([{ text: 'hello' }]);
    expect(await fake.database.models.get('notes')!.select('text').where({ text: 'hello' })).toEqual([{ text: 'hello' }]);

    await fake.clock.advance(65_000);
    expect(fake.sent.map(call => call.kind)).toEqual(['send', 'send']);
    expect(fake.sent[0]!.input).toMatchObject({ conversation: { id: 'g1' }, content: 'ping' });
    expect(fake.schedule.list()).toEqual([{ id: 'ping', cron: '*/30 * * * * *' }]);

    await fake.dispose();
    expect(disposed).toBe(true);
    expect(fake.schedule.list()).toEqual([]);
    expect(fake.signal.aborted).toBe(true);
  });

  it('exposes custom resources through the Scope and reports missing requirements', () => {
    const fake = createFakePlugin({ hosts: { schedule: false },
      resources: [fakeResource(greeterToken, { greet: (n: string) => `hi ${n}` })] });
    expect(fake.resources.use(greeterToken).greet('a')).toBe('hi a');
    expect(fake.resources.has(scheduleHostToken)).toBe(false);
    expect(fake.missingRequirements(plugin)).toEqual([scheduleHostToken]);
  });

  it('persists small-object state across facade reads and supports TTL-free update', async () => {
    const fake = createFakePlugin();
    const state = fake.database.state;
    await state.set('n', 1);
    await state.update<number>('n', current => (current ?? 0) + 1);
    expect(await fake.database.state.get('n')).toBe(2);
  });

  it('records feature registrations made through addCommand-style calls', async () => {
    const fake = createFakePlugin();
    const context = fake.context as unknown as { addCommand(name: string, def: unknown): void };
    context.addCommand('hello', { execute: () => 'x' });
    expect(fake.features).toMatchObject([{ kind: 'command', localName: 'hello' }]);
  });

  it('fails the next outbound call once', async () => {
    const fake = createFakePlugin();
    fake.outboundHost.failNext(new Error('boom'));
    await expect(fake.outbound.send({ adapter: 'a', endpointKey: 'b',
      conversation: { kind: 'private', id: 'u' }, content: 'x' })).rejects.toThrow('boom');
    await expect(fake.outbound.send({ adapter: 'a', endpointKey: 'b',
      conversation: { kind: 'private', id: 'u' }, content: 'x' })).resolves.toBe('fake-1');
  });

  it('runs a command and a middleware against the fake', async () => {
    const fake = createFakePlugin({ resources: [fakeResource(greeterToken, { greet: (n: string) => `hi ${n}` })] });
    const command = defineCommand({
      async execute(context) {
        const text = context.use(greeterToken).greet(context.sender?.name ?? '?');
        await context.input?.$reply?.(text);
        return text;
      },
    });
    const message = createFakeMessage({ sender: { id: 'u', name: 'Ann', roles: ['admin'] } });
    expect(await runCommand(fake, command, { input: message })).toBe('hi Ann');
    expect(message.replies).toEqual(['hi Ann']);

    const gate = defineMiddleware<{ content: string }>({
      handle: (context, next) => context.input.content === 'skip' ? undefined : next(),
    });
    expect((await runMiddleware(fake, gate, { content: 'skip' })).continued).toBe(false);
    expect((await runMiddleware(fake, gate, { content: 'go' })).continued).toBe(true);
  });

  it('clock jumps do not fire jobs; trigger runs one on demand', async () => {
    const clock = new FakeClock(0);
    const fake = createFakePlugin({ clock });
    let runs = 0;
    fake.schedule.register({ id: 'j', cron: '0 * * * * *', execute: () => { runs++; } });
    clock.set(10 * 60_000);
    expect(runs).toBe(0);
    await clock.advance(3 * 60_000);
    expect(runs).toBe(3);
    await fake.scheduleHost.trigger(fake.scheduleHost.list()[0]!.id);
    expect(runs).toBe(4);
  });

  it('a job fired by advance() sees the instant it fired at, not the time advance() started from', async () => {
    const clock = new FakeClock(0);
    const fake = createFakePlugin({ clock });
    const observedTimes: number[] = [];
    fake.schedule.register({ id: 'minute', cron: '0 * * * * *', execute: () => { observedTimes.push(clock.now()); } });
    await clock.advance(3 * 60_000);
    expect(observedTimes).toEqual([60_000, 120_000, 180_000]);
    expect(clock.now()).toBe(3 * 60_000);
  });

  it('advance() ends at the target time when a job throws and skips the remaining due jobs', async () => {
    const clock = new FakeClock(0);
    const fake = createFakePlugin({ clock });
    const runs: number[] = [];
    fake.schedule.register({ id: 'boom', cron: '0 * * * * *', execute: () => { runs.push(clock.now()); if (runs.length === 2) throw new Error('job failed'); } });
    await expect(clock.advance(5 * 60_000)).rejects.toThrow('job failed');
    expect(runs).toEqual([60_000, 120_000]);
    expect(clock.now()).toBe(5 * 60_000);
    // The next advance continues from the target, so the skipped window is not replayed.
    await clock.advance(60_000);
    expect(runs).toEqual([60_000, 120_000, 360_000]);
  });
});
