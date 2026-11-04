import { EventEmitter } from 'node:events';
import {
  Adapter,
  AdapterIndex,
  adapterFeatureId,
  createEndpointSpecification,
  defineAdapter,
  endpointEventGatewayToken,
  endpointSpec,
} from 'zhin.js/adapter';
import {
  SnapshotStore,
  createCapabilitySlot,
  createSnapshotView,
  rootPluginId,
  PluginDatabaseHost,
  TargetMigrationScopes,
  readOperationSession,
  type SnapshotState,
  type TokenId,
} from 'zhin.js';
import { createDatabaseHost } from '../../../basic/cli/src/plugin-runtime/database-host-installer.js';
import { MemoryDesiredRepository } from '../../../plugins/adapters/test-utils/desired-repository.js';
import { ImRuntime } from '../../im/core/src/plugin-runtime/im/index.js';
import { RuntimeMessage } from '../../im/core/src/plugin-runtime/im/contracts.js';
import { defineHostTables } from '../../../plugins/games/tic-tac-toe/src/models.js';
import { createServices } from '../../../plugins/games/tic-tac-toe/src/session-service.js';
import command from '../../../plugins/games/tic-tac-toe/commands/ttt/[[action]]/index.js';
import { handleMove } from '../../../plugins/games/tic-tac-toe/src/game-flow.js';
import { channelKey, gameTargetFromKey } from '../src/board-sender.js';
import { createGameTargetMigration } from '../src/target-migration.js';
import { createHostGameDb } from '../src/memory-db.js';
import { defineGameRecordTable } from '../src/game-records.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('migrates an active TTT scope without losing state or related rows and drains its actual unified command reply first', async () => {
  const root = rootPluginId(),
    im = new ImRuntime(),
    repository = new MemoryDesiredRepository();
  repository.snapshot = undefined;
  const entered = deferred(),
    finishSend = deferred();
  let sendCount = 0;
  class Client extends EventEmitter {
    readonly [endpointSpec] = createEndpointSpecification(this, {
      start() {},
      open() {},
      close() {},
      stop() {},
      send: async () => {
        sendCount += 1;
        entered.resolve();
        await finishSend.promise;
        return 'platform-message';
      },
    });
  }
  class NativeAdapter extends Adapter<Client> {
    protected createEndpoint() {
      return new Client();
    }
  }
  const adapter = new NativeAdapter();
  const slot = createCapabilitySlot({
    owner: root,
    feature: adapterFeatureId,
    localName: 'test',
    source: '/fixture/adapters/test/index.ts',
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => adapter }),
  });
  const state: SnapshotState = {
    root,
    tree: new Map([
      [root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }],
    ]),
    config: new Map([[root, { endpoints: [{ id: 'one' }] }]]),
    capabilities: new Map([[slot.id, slot]]),
    projections: new Map(),
    resources: new Map([[root, new Map<TokenId, unknown>([[endpointEventGatewayToken.id, im.endpointEvents]])]]),
  };
  const index = await AdapterIndex.create([slot], createSnapshotView(0, state), new AbortController().signal, {
    repository,
  });
  const snapshot = new SnapshotStore({ ...state, projections: new Map([[adapterFeatureId, index]]) });
  im.attach(snapshot);
  await index.activate(new AbortController().signal);
  const account = adapter.list()[0]!,
    client = adapter.getEndpoint(account.instanceId)!;
  const target = {
    endpoint: { adapter: 'test', id: account.canonicalId },
    kind: 'group' as const,
    id: 'room\0scope',
    parent: { kind: 'channel' as const, id: 'guild\0parent' },
    threadId: 'topic\0thread',
  };
  const captured = im.endpoints.captureOperation({ target, client });
  const host = createDatabaseHost({ dialect: 'sqlite', filename: ':memory:' }),
    db = new PluginDatabaseHost(root, host);
  defineHostTables(db);
  defineGameRecordTable(db);
  const tables = ['ttt_sessions', 'ttt_queue', 'ttt_moves', 'ttt_spectators', 'game_records'];
  const scopes = new TargetMigrationScopes({ pending: (scope) => !gameTargetFromKey(scope) });
  const provider = createGameTargetMigration({
    database: db,
    gameId: 'ttt',
    sessionTable: 'ttt_sessions',
    tables,
    scopes,
  });
  const services = createServices(createHostGameDb(db, tables) as never);
  services.session.bindMigrationScopes(scopes);
  await host.start();
  try {
    const initial = await services.session.createSession({
      message: { target: { ...target, id: 'original' }, sender: { id: 'alice' } },
      playerX: 'alice',
      playerO: 'bob',
      boardJson: JSON.stringify(Array(9).fill(0)),
    });
    await services.session.performMove({
      sessionId: initial.id,
      playerId: 'alice',
      cell: 4,
      expectedRevision: 0,
      boardJson: JSON.stringify([0, 0, 0, 0, 1, 0, 0, 0, 0]),
      moveCount: 1,
      nextTurn: 2,
      status: 'active',
      winner: 0,
    });
    const oldScope = 'test:reusable-alias:group:room';
    await db.models
      .get('ttt_sessions')!
      .update({ channel_key: oldScope, adapter: 'test', endpoint: 'reusable-alias', channel_id: 'room' })
      .where({ id: initial.id });
    await db.models
      .get('ttt_queue')!
      .insert({ channel_key: oldScope, user_id: 'charlie', user_name: 'Charlie', joined_at: Date.now() });
    await db.models
      .get('game_records')!
      .insert({
        id: 'historical-record',
        user_id: 'alice',
        user_name: 'Alice',
        channel_key: oldScope,
        game_id: 'ttt',
        result: 'draw',
        score: 0,
        created_at: Date.now(),
      });
    await services.session.addSpectator(initial.id, 'eve');
    const before = new Map<string, Record<string, unknown>[]>();
    for (const table of tables) before.set(table, await db.models.get(table)!.select());
    const candidate = (await provider.preview()).candidates.find((row) => row.status === 'unresolved')!;
    const plan = await provider.prepare({
      planId: 'explicit-plan',
      candidateId: candidate.id,
      expectedDigest: candidate.beforeDigest,
      target,
    });
    const message = new RuntimeMessage(
      { conversation: target, sender: { id: 'alice' }, content: 'continue' },
      {
        generation: snapshot.current.generation,
        clientAdapter: 'test',
        client: () => client,
        reply: (content) => captured.send(content),
        session: {
          adapterName: 'test',
          adapter,
          endpoint: client,
          scene: target,
          sender: { id: 'alice' },
          message: { text: 'continue', receivedAt: Date.now() },
          event: {},
          signal: captured.signal,
        },
      },
    );
    const running = command.execute({
      input: message,
      session: readOperationSession(message),
      params: { action: 'continue' },
      owner: { id: root },
      generation: snapshot.current.generation,
      config: {},
      args: [],
      use: () => services,
      locale: 'en',
      formatCommand: () => 'ttt',
    } as never);
    await entered.promise;
    const applying = provider.apply({ plan });
    await vi.waitFor(async () => expect((await provider.inspect({ plan })).data).toBe('unknown'));
    expect((await db.models.get('ttt_sessions')!.select())[0]!.channel_key).toBe(oldScope);
    finishSend.resolve();
    expect(await running).toBeUndefined();
    const receipt = await applying;
    expect(sendCount).toBe(1);
    expect(receipt.operation).toBe('apply');
    const migrated = (await db.models.get('ttt_sessions')!.select())[0]!;
    expect(migrated).toEqual({
      ...before.get('ttt_sessions')![0],
      channel_key: channelKey({ target }),
      adapter: 'k1:test',
      endpoint: `k1:${account.canonicalId.replaceAll('%', '%25').replaceAll('\0', '%00')}`,
      channel_id: 'k1:room%00scope',
    });
    for (const field of ['adapter', 'endpoint', 'channel_id', 'channel_key']) expect(String(migrated[field])).not.toContain('\0');
    expect(migrated.channel_key).not.toContain('\0');
    expect(gameTargetFromKey(String(migrated.channel_key))).toEqual(target);
    for (const table of ['ttt_moves', 'ttt_spectators'])
      expect(await db.models.get(table)!.select()).toEqual(before.get(table));
    for (const table of ['ttt_queue', 'game_records'])
      expect(await db.models.get(table)!.select()).toEqual(
        before.get(table)!.map((row) => ({ ...row, channel_key: channelKey({ target }) })),
      );
    await expect(handleMove(services, { target, sender: { id: 'bob' } }, initial.id, 0)).rejects.toMatchObject({
      code: 'unavailable',
    });
    await provider.resume({ plan });
    expect(await handleMove(services, { target, sender: { id: 'bob' } }, initial.id, 0)).toBeTruthy();
    const continued = await services.session.getById(initial.id);
    expect(continued).toMatchObject({ id: initial.id, revision: 2, move_count: 2, turn: 1 });
    expect(await services.session.listSpectators(initial.id)).toEqual(['eve']);
  } finally {
    finishSend.resolve();
    captured.release();
    await host.stop();
    await index.stop();
    await snapshot.close();
  }
});
