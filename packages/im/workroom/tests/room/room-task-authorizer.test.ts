import { createRoomGuards, type GuardActor } from '../../src/room/room-guards.js';
import { createRoomTaskAuthorizer } from '../../src/room/room-task-authorizer.js';
import { MemoryRoomTaskJournal } from '../../src/room/room-task-journal.js';
import { RoomTaskAuthorizationError, createRoomTaskService } from '../../src/room/room-task-service.js';
import type { RoomTaskEvent } from '../../src/room/room-task.js';

const actors: Record<string, GuardActor> = {
  owner: { origin: 'human', accountId: 'u-owner' },
  stranger: { origin: 'human', accountId: 'u-other' },
  dev: { origin: 'member', accountId: 'bot-dev' },
};

function setup(actorOf: (by: string) => GuardActor | undefined = (by) => actors[by]) {
  let ids = 0;
  const guards = createRoomGuards({ sensitiveAccounts: ['u-owner'] });
  return createRoomTaskService({
    journal: new MemoryRoomTaskJournal(),
    newId: () => `e${ids++}`,
    now: () => 1,
    authorize: createRoomTaskAuthorizer({ guards, actorOf }),
  });
}

const create = (service: ReturnType<typeof setup>) =>
  service.execute('r', { type: 'create', commandId: 'c0', taskId: 't', by: 'dev', title: 'x', assignee: 'dev' });

describe('createRoomTaskAuthorizer', () => {
  it('lets a configured human cancel a Task', async () => {
    const service = setup();
    await create(service);
    const result = await service.execute('r', { type: 'cancel', commandId: 'c1', taskId: 't', by: 'owner' });
    expect(result.state.status).toBe('cancelled');
  });

  it('refuses agent members, other humans and unknown actors', async () => {
    const service = setup();
    await create(service);
    for (const by of ['dev', 'stranger', 'ghost']) {
      await expect(service.execute('r', { type: 'cancel', commandId: `c-${by}`, taskId: 't', by })).rejects.toBeInstanceOf(RoomTaskAuthorizationError);
    }
    expect((await service.get('r', 't'))?.status).toBe('assigned');
  });

  it('fails closed when actorOf throws or returns nothing', async () => {
    for (const actorOf of [() => { throw new Error('lookup down'); }, () => undefined]) {
      const service = setup(actorOf);
      await create(service);
      await expect(service.execute('r', { type: 'cancel', commandId: 'c1', taskId: 't', by: 'owner' })).rejects.toBeInstanceOf(RoomTaskAuthorizationError);
    }
  });

  it('does not restrict other commands, so agents can still block and hand off', async () => {
    const service = setup(() => undefined);
    await create(service);
    await service.execute('r', { type: 'start', commandId: 'c1', taskId: 't', by: 'dev' });
    await service.execute('r', { type: 'block', commandId: 'c2', taskId: 't', by: 'dev', reason: 'need input' });
    expect((await service.get('r', 't'))?.status).toBe('blocked');
  });

  it('documents the C1 constraint: subscribers must order by event.sequence', async () => {
    const service = setup(() => undefined);
    const seen: RoomTaskEvent[] = [];
    service.subscribe((event) => { seen.push(event); });
    await create(service);
    await service.execute('r', { type: 'start', commandId: 'c1', taskId: 't', by: 'dev' });
    await service.execute('r', { type: 'block', commandId: 'c2', taskId: 't', by: 'dev', reason: 'x' });
    // Concurrent executes may interleave dispatch, so a C1 subscriber sorts by sequence rather than trusting arrival.
    const shuffled = [...seen].reverse();
    const ordered = [...shuffled].sort((a, b) => a.sequence - b.sequence);
    expect(ordered.map((e) => e.type)).toEqual(['task.created', 'task.assigned', 'task.started', 'task.blocked']);
  });
});
