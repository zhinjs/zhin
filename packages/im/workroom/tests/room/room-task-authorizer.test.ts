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

function setup(
  actorOf: (by: string) => GuardActor | undefined = (by) => actors[by],
  extra: Partial<Parameters<typeof createRoomTaskAuthorizer>[0]> = {},
) {
  let ids = 0;
  const guards = createRoomGuards({ sensitiveAccounts: ['u-owner'] });
  return createRoomTaskService({
    journal: new MemoryRoomTaskJournal(),
    newId: () => `e${ids++}`,
    now: () => 1,
    authorize: createRoomTaskAuthorizer({ guards, actorOf, ...extra }),
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

  it('refuses assign by default when no role check is provided', async () => {
    const service = setup();
    await create(service);
    for (const by of ['dev', 'owner']) {
      await expect(service.execute('r', { type: 'assign', commandId: `a-${by}`, taskId: 't', by, assignee: 'other' })).rejects.toBeInstanceOf(RoomTaskAuthorizationError);
    }
    expect((await service.get('r', 't'))?.assignee).toBe('dev');

    await service.execute('r', { type: 'start', commandId: 's1', taskId: 't', by: 'dev' });
    await service.execute('r', { type: 'block', commandId: 'b1', taskId: 't', by: 'dev', reason: 'x' });
    await expect(service.execute('r', { type: 'assign', commandId: 'a-blocked', taskId: 't', by: 'dev', assignee: 'dev' })).rejects.toBeInstanceOf(RoomTaskAuthorizationError);
    expect((await service.get('r', 't'))?.status).toBe('blocked');
  });

  it('applies authorizeAssign: lead allowed, others and throwing checks refused', async () => {
    const authorizeAssign = (_room: string, command: { by: string }) => (command.by === 'owner' ? undefined : 'lead only');
    const service = setup(undefined, { authorizeAssign });
    await create(service);
    await expect(service.execute('r', { type: 'assign', commandId: 'a1', taskId: 't', by: 'dev', assignee: 'x' })).rejects.toBeInstanceOf(RoomTaskAuthorizationError);
    await service.execute('r', { type: 'assign', commandId: 'a2', taskId: 't', by: 'owner', assignee: 'x' });
    expect((await service.get('r', 't'))?.assignee).toBe('x');

    const throwing = setup(undefined, { authorizeAssign: () => { throw new Error('role lookup down'); } });
    await create(throwing);
    await expect(throwing.execute('r', { type: 'assign', commandId: 'a3', taskId: 't', by: 'owner', assignee: 'x' })).rejects.toBeInstanceOf(RoomTaskAuthorizationError);
  });

  it('calls next for other commands and propagates its refusal', async () => {
    const seen: string[] = [];
    const next = (_room: string, command: { type: string }) => {
      seen.push(command.type);
      return command.type === 'block' ? 'no blocking' : undefined;
    };
    const service = setup(() => undefined, { next });
    await create(service);
    await service.execute('r', { type: 'start', commandId: 'c1', taskId: 't', by: 'dev' });
    await expect(service.execute('r', { type: 'block', commandId: 'c2', taskId: 't', by: 'dev', reason: 'x' })).rejects.toBeInstanceOf(RoomTaskAuthorizationError);
    expect(seen).toEqual(['create', 'start', 'block']);
  });

  it('assigns unique contiguous sequences to concurrent executes on one Room', async () => {
    const service = setup(() => undefined);
    const seen: RoomTaskEvent[] = [];
    service.subscribe((event) => { seen.push(event); });
    await Promise.all([
      service.execute('r', { type: 'create', commandId: 'p1', taskId: 't1', by: 'dev', title: 'a', assignee: 'dev' }),
      service.execute('r', { type: 'create', commandId: 'p2', taskId: 't2', by: 'dev', title: 'b', assignee: 'dev' }),
    ]);
    const sequences = seen.map((e) => e.sequence);
    expect(new Set(sequences).size).toBe(sequences.length);
    const sorted = [...sequences].sort((a, b) => a - b);
    expect(sorted).toEqual(sorted.map((_, i) => sorted[0] + i));
    expect(sorted).toHaveLength(4);
  });
});
