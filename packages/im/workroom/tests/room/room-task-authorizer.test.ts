import { createRoomGuards, type GuardActor } from '../../src/room/room-guards.js';
import { createRoomRoleAssignAuthorizer, createRoomRoleAuthorizer, createRoomTaskAuthorizer } from '../../src/room/room-task-authorizer.js';
import { MemoryRoomTaskJournal } from '../../src/room/room-task-journal.js';
import { RoomTaskAuthorizationError, createRoomTaskService } from '../../src/room/room-task-service.js';
import type { RoomTaskEvent } from '../../src/room/room-task.js';
import { roomDefinition, registryOf } from './room-fixtures.js';

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

describe('createRoomRoleAuthorizer / createRoomRoleAssignAuthorizer', () => {
  const human: GuardActor = { origin: 'human', accountId: 'u-owner' };
  function roleSetup(room = roomDefinition(), extra: { actorOf?: (by: string) => GuardActor | undefined } = {}) {
    const journal = new MemoryRoomTaskJournal();
    let ids = 0;
    const guards = createRoomGuards({ sensitiveAccounts: ['u-owner'] });
    const service = createRoomTaskService({
      journal,
      newId: () => `e${ids++}`,
      now: () => 1,
      authorize: createRoomTaskAuthorizer({
        guards,
        actorOf: (by) => (by === 'owner' ? human : undefined),
        authorizeAssign: createRoomRoleAssignAuthorizer({ room, roomId: 'r' }),
        next: createRoomRoleAuthorizer({ room, roomId: 'r', ...extra }),
      }),
    });
    return { service, journal };
  }
  const make = (service: ReturnType<typeof roleSetup>['service'], by = 'human:alice', assignee: string | undefined = 'lead', taskId = 't') =>
    service.execute('r', { type: 'create', commandId: `c-${taskId}`, taskId, by, title: 'x', ...(assignee !== undefined ? { assignee } : {}) });
  const refused = (promise: Promise<unknown>) => expect(promise).rejects.toBeInstanceOf(RoomTaskAuthorizationError);

  it('lets members and humans create, and members work and hand off along handoffTo', async () => {
    const { service } = roleSetup();
    await make(service);
    await service.execute('r', { type: 'start', commandId: 's1', taskId: 't', by: 'lead' });
    await service.execute('r', { type: 'handoff', commandId: 'h1', taskId: 't', by: 'lead', to: 'res' });
    await service.execute('r', { type: 'start', commandId: 's2', taskId: 't', by: 'res' });
    await service.execute('r', { type: 'handoff', commandId: 'h2', taskId: 't', by: 'res', to: 'wri' });
    await service.execute('r', { type: 'start', commandId: 's3', taskId: 't', by: 'wri' });
    await service.execute('r', { type: 'complete', commandId: 'x1', taskId: 't', by: 'wri', result: 'ok' });
    expect((await service.get('r', 't'))?.status).toBe('done');
    await make(service, 'wri', undefined, 't2'); // a member may create as well
  });

  it('refuses non-members for create / start / block / complete', async () => {
    const { service, journal } = roleSetup();
    await refused(make(service, 'mallory', 'lead', 'a'));
    await refused(make(service, 'human:alice', 'mallory', 'b'));
    await refused(make(service, 'human:', 'lead', 'c'));
    await make(service);
    const before = (await journal.read('r')).length;
    await refused(service.execute('r', { type: 'start', commandId: 's', taskId: 't', by: 'mallory' }));
    await service.execute('r', { type: 'start', commandId: 's-ok', taskId: 't', by: 'lead' });
    await refused(service.execute('r', { type: 'block', commandId: 'b', taskId: 't', by: 'mallory', reason: 'x' }));
    await refused(service.execute('r', { type: 'complete', commandId: 'k', taskId: 't', by: 'human:alice', result: 'x' }));
    expect(await journal.read('r')).toHaveLength(before + 1);
  });

  it('refuses a handoff outside handoffTo, to a non-member, from a role without handoffTo', async () => {
    const { service, journal } = roleSetup();
    await make(service, 'human:alice', 'wri');
    await service.execute('r', { type: 'start', commandId: 's', taskId: 't', by: 'wri' });
    const before = (await journal.read('r')).length;
    await refused(service.execute('r', { type: 'handoff', commandId: 'h1', taskId: 't', by: 'wri', to: 'res' })); // writer: no handoffTo
    await refused(service.execute('r', { type: 'handoff', commandId: 'h2', taskId: 't', by: 'mallory', to: 'res' }));
    expect(await journal.read('r')).toHaveLength(before);

    const second = roleSetup();
    await make(second.service, 'human:alice', 'res');
    await second.service.execute('r', { type: 'start', commandId: 's', taskId: 't', by: 'res' });
    await refused(second.service.execute('r', { type: 'handoff', commandId: 'h3', taskId: 't', by: 'res', to: 'lead' })); // not in handoffTo
    await refused(second.service.execute('r', { type: 'handoff', commandId: 'h4', taskId: 't', by: 'res', to: 'mallory' }));
  });

  it('restricts assign to the coordinator and member assignees; no coordinator refuses all', async () => {
    const { service } = roleSetup();
    await make(service);
    await refused(service.execute('r', { type: 'assign', commandId: 'a1', taskId: 't', by: 'res', assignee: 'wri' }));
    await refused(service.execute('r', { type: 'assign', commandId: 'a2', taskId: 't', by: 'human:alice', assignee: 'wri' }));
    await refused(service.execute('r', { type: 'assign', commandId: 'a3', taskId: 't', by: 'lead', assignee: 'mallory' }));
    await service.execute('r', { type: 'assign', commandId: 'a4', taskId: 't', by: 'lead', assignee: 'res' });
    expect((await service.get('r', 't'))?.assignee).toBe('res');

    const { service: leaderless } = roleSetup(roomDefinition({ coordinator: undefined }));
    await make(leaderless);
    for (const by of ['lead', 'res']) {
      await refused(leaderless.execute('r', { type: 'assign', commandId: `n-${by}`, taskId: 't', by, assignee: 'wri' }));
    }
  });

  it('refuses commands for another room id and accepts a registry entry', async () => {
    const entry = registryOf(roomDefinition(), 'dev').room('dev')!;
    const authorize = createRoomRoleAuthorizer({ room: entry });
    const base = { commandId: 'c', taskId: 't', at: 1 } as const;
    expect(authorize('dev', { ...base, type: 'start', by: 'lead' })).toBeUndefined();
    expect(authorize('other', { ...base, type: 'start', by: 'lead' })).toBe('unknown room other');
    expect(createRoomRoleAssignAuthorizer({ room: entry })('other', { ...base, type: 'assign', by: 'lead', assignee: 'res' })).toBeUndefined();
    expect(createRoomRoleAuthorizer({ room: roomDefinition(), roomId: 'r' })('x', { ...base, type: 'start', by: 'lead' })).toBe('unknown room x');
  });

  it('fails closed when the room or actorOf throws, leaving the journal untouched', async () => {
    const broken = roomDefinition();
    const { service, journal } = roleSetup(broken);
    await make(service);
    const before = (await journal.read('r')).length;
    Object.defineProperty(broken, 'members', { get() { throw new Error('members down'); } });
    await refused(service.execute('r', { type: 'start', commandId: 's', taskId: 't', by: 'lead' }));
    await refused(service.execute('r', { type: 'assign', commandId: 'a', taskId: 't', by: 'lead', assignee: 'res' }));
    expect(await journal.read('r')).toHaveLength(before);

    const throwing = roleSetup(roomDefinition(), { actorOf: () => { throw new Error('actor down'); } });
    await refused(make(throwing.service));
    expect(await throwing.journal.read('r')).toHaveLength(0);
  });
});
