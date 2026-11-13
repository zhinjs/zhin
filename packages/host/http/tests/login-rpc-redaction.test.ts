import { describe, expect, it } from 'vitest';
import { CONSOLE_RPC_PERMISSIONS, LOGIN_RPC } from '@zhin.js/console-protocol';
import { type ConsolePrincipal, type ConsoleUserPrincipal } from '../src/access-control.js';
import { dispatchRuntimeConsoleRpc } from '../src/console-rpc.js';
import { dispatchExtendedConsoleRpc, loginAuditDetail } from '../src/console-rpc-extended/index.js';

const { LoginAssist } = await import('../../../im/core/src/built/login-assist.js');

type Grant = ConsoleUserPrincipal['grants'][number];

function user(...grants: Grant[]): ConsoleUserPrincipal {
  return Object.freeze({
    kind: 'user', userId: 'u', username: 'u', displayName: 'u', credentialId: 'u-session', roles: grants.map(g => g.role),
    grants,
  }) as ConsoleUserPrincipal;
}
const grant = (scope: Grant['scope'], permissions: string[], role = 'r'): Grant => ({ role, scope, permissions } as Grant);

const OWNER = user(grant({ kind: 'global' }, ['endpoint.view', 'endpoint.operate', 'endpoint.manage'], 'owner'));
const GLOBAL_VIEWER = user(grant({ kind: 'global' }, ['endpoint.view'], 'viewer'));
const GLOBAL_OPERATOR = user(grant({ kind: 'global' }, ['endpoint.view', 'endpoint.operate'], 'operator'));
/** Global viewer that may operate only `qq/mine`. */
const MINE_OPERATOR = user(
  grant({ kind: 'global' }, ['endpoint.view'], 'viewer'),
  grant({ kind: 'endpoint', key: 'qq/mine' }, ['endpoint.operate'], 'op'),
);
const ENDPOINT_VIEWER = user(grant({ kind: 'endpoint', key: 'qq/mine' }, ['endpoint.view'], 'viewer'));
const ENDPOINT_OPERATOR = user(grant({ kind: 'endpoint', key: 'qq/mine' }, ['endpoint.view', 'endpoint.operate'], 'op'));
const ADAPTER_VIEWER = user(grant({ kind: 'adapter', key: 'qq' }, ['endpoint.view'], 'viewer'));
const ADAPTER_OPERATOR = user(grant({ kind: 'adapter', key: 'qq' }, ['endpoint.view', 'endpoint.operate'], 'op'));
const OPEN_BOOTSTRAP: ConsolePrincipal = Object.freeze({ kind: 'bootstrap', open: true });

const DEVICE_JSON = 'SECRET-DEVICE-JSON';
const SID = 'sid=secret-session-0123';
const QR = 'data:image/png;base64,SECRETQR';
const LEGACY_URL = `https://verify.example/legacy?${SID}`;
const SECRETS = [DEVICE_JSON, 'secret-session', 'SECRETQR'];

/** `qq/mine` shows a device challenge (sensitive block + sid link); `qq/other` a legacy QR + url task. */
function setup() {
  const assist = new LoginAssist(null, { defaultTimeoutMs: 0 });
  const mine = assist.beginFlow({ adapter: 'qq', endpointKey: 'mine', owner: {} });
  mine.challenge({
    kind: 'device', title: 'device',
    media: { link: { url: `https://verify.example/?${SID}`, label: 'open' } },
    blocks: [
      { kind: 'copy', id: 'dev', label: 'dev', content: DEVICE_JSON, format: 'json', sensitive: true },
      { kind: 'link', label: 'verify', url: `https://verify.example/?${SID}` },
    ],
    input: { kind: 'code', label: 'code' },
  }).catch(() => undefined);
  assist.waitForInput('qq', 'mine-legacy', 'auth', { message: 'auth', url: LEGACY_URL }, { owner: {} }).catch(() => undefined);
  assist.waitForInput('qq', 'other', 'qrcode', { message: 'scan', image: QR }, { owner: {} }).catch(() => undefined);
  return { assist, mine };
}

async function rpc(message: Record<string, unknown>, assist: InstanceType<typeof LoginAssist>, who: ConsolePrincipal | undefined) {
  const replies = await dispatchRuntimeConsoleRpc({ requestId: 1, ...message } as never, {
    authScope: 'full',
    ...(who ? { principal: who } : {}),
    listPages: async () => [],
    extended: { projectRoot: '/tmp', loginAssist: assist as never },
  } as never);
  return replies[replies.length - 1]!;
}

const leaks = (value: unknown) => SECRETS.filter(secret => JSON.stringify(value).includes(secret));

type FlowRow = { endpointKey: string; steps: { challenge?: { media?: Record<string, unknown>; blocks?: { kind: string; content?: string; redacted?: boolean }[] } }[] };
type TaskRow = { endpointKey: string; payload: Record<string, unknown> };
const challengeOf = (flow: FlowRow) => flow.steps.at(-1)!.challenge!;

describe('login read RPCs return live challenge material only to operators (ADR 0058 §8)', () => {
  it('a global viewer gets the event-safe form from login.flow.list / login.flow.get / login.list', async () => {
    const { assist, mine } = setup();
    const list = await rpc({ type: LOGIN_RPC.FLOW_LIST }, assist, GLOBAL_VIEWER);
    expect(list.error).toBeUndefined();
    expect(leaks(list)).toEqual([]);
    const flows = (list.data as { flows: FlowRow[] }).flows;
    expect(flows.map(flow => flow.endpointKey).sort()).toEqual(['mine', 'mine-legacy', 'other']);
    const device = challengeOf(flows.find(flow => flow.endpointKey === 'mine')!);
    expect(device.media).toMatchObject({ linkOmitted: true });
    expect(device.blocks).toEqual([expect.objectContaining({ kind: 'copy', content: '', redacted: true })]);
    expect(challengeOf(flows.find(flow => flow.endpointKey === 'other')!).media).toMatchObject({ qrImageOmitted: true });

    for (const message of [
      { type: LOGIN_RPC.FLOW_GET, flowId: mine.id },
      { type: LOGIN_RPC.FLOW_GET, adapter: 'qq', endpointKey: 'mine' },
      { type: LOGIN_RPC.FLOW_GET, data: { adapter: 'qq', endpointKey: 'other' } },
    ]) {
      const reply = await rpc(message, assist, GLOBAL_VIEWER);
      expect((reply.data as { flow: unknown }).flow).not.toBeNull();
      expect(leaks(reply)).toEqual([]);
    }

    const pending = await rpc({ type: LOGIN_RPC.LIST }, assist, GLOBAL_VIEWER);
    expect(leaks(pending)).toEqual([]);
    const tasks = (pending.data as { tasks: TaskRow[] }).tasks;
    expect(tasks.find(task => task.endpointKey === 'other')!.payload).toEqual({ message: 'scan', imageOmitted: true });
    expect(tasks.find(task => task.endpointKey === 'mine-legacy')!.payload).toEqual({ message: 'auth', urlOmitted: true });
    // The live material itself is untouched.
    expect(JSON.stringify(assist.listFlows())).toContain(DEVICE_JSON);
    assist.dispose();
  });

  for (const [label, who] of [
    ['owner', OWNER], ['global operator', GLOBAL_OPERATOR], ['open bootstrap Host', OPEN_BOOTSTRAP], ['in-process caller', undefined],
  ] as const) {
    it(`${label} keeps live material on every RPC`, async () => {
      const { assist, mine } = setup();
      const list = await rpc({ type: LOGIN_RPC.FLOW_LIST }, assist, who);
      expect(leaks(list).sort()).toEqual([...SECRETS].sort());
      const get = await rpc({ type: LOGIN_RPC.FLOW_GET, flowId: mine.id }, assist, who);
      expect(JSON.stringify(get)).toContain(DEVICE_JSON);
      expect(JSON.stringify(get)).toContain('secret-session');
      const pending = await rpc({ type: LOGIN_RPC.LIST }, assist, who);
      const tasks = (pending.data as { tasks: TaskRow[] }).tasks;
      expect(tasks.find(task => task.endpointKey === 'other')!.payload.image).toBe(QR);
      expect(tasks.find(task => task.endpointKey === 'mine-legacy')!.payload.url).toBe(LEGACY_URL);
      assist.dispose();
    });
  }

  it('decides per Endpoint: operate on qq/mine only → live for mine, event-safe for the others', async () => {
    const { assist } = setup();
    const list = await rpc({ type: LOGIN_RPC.FLOW_LIST }, assist, MINE_OPERATOR);
    const flows = (list.data as { flows: FlowRow[] }).flows;
    expect(JSON.stringify(flows.find(flow => flow.endpointKey === 'mine'))).toContain(DEVICE_JSON);
    expect(leaks(flows.filter(flow => flow.endpointKey !== 'mine'))).toEqual([]);
    const other = await rpc({ type: LOGIN_RPC.FLOW_GET, adapter: 'qq', endpointKey: 'other' }, assist, MINE_OPERATOR);
    expect(leaks(other)).toEqual([]);
    const pending = await rpc({ type: LOGIN_RPC.LIST }, assist, MINE_OPERATOR);
    const tasks = (pending.data as { tasks: TaskRow[] }).tasks;
    expect(JSON.stringify(tasks.find(task => task.endpointKey === 'mine'))).toContain('secret-session');
    expect(leaks(tasks.filter(task => task.endpointKey !== 'mine'))).toEqual([]);
    assist.dispose();
  });

  it('endpoint- and adapter-scoped viewers get the event-safe form; scoped operators get live material', async () => {
    for (const viewer of [ENDPOINT_VIEWER, ADAPTER_VIEWER]) {
      const { assist, mine } = setup();
      for (const message of [
        { type: LOGIN_RPC.FLOW_LIST, adapter: 'qq', endpointKey: 'mine' },
        { type: LOGIN_RPC.FLOW_GET, flowId: mine.id, data: { adapter: 'qq', endpointKey: 'mine' } },
        { type: LOGIN_RPC.FLOW_GET, adapter: 'qq', endpointKey: 'mine' },
      ]) {
        const reply = await rpc(message, assist, viewer);
        expect(reply.error).toBeUndefined();
        expect(JSON.stringify(reply)).toContain('"redacted":true');
        expect(leaks(reply)).toEqual([]);
      }
      const legacy = await rpc({ type: LOGIN_RPC.LIST, adapter: 'qq', endpointKey: 'mine-legacy' }, assist, viewer === ADAPTER_VIEWER ? viewer : ADAPTER_VIEWER);
      expect(leaks(legacy)).toEqual([]);
      expect((legacy.data as { tasks: TaskRow[] }).tasks[0]!.payload).toEqual({ message: 'auth', urlOmitted: true });
      assist.dispose();
    }
    for (const operator of [ENDPOINT_OPERATOR, ADAPTER_OPERATOR]) {
      const { assist, mine } = setup();
      const reply = await rpc({ type: LOGIN_RPC.FLOW_GET, flowId: mine.id, data: { adapter: 'qq', endpointKey: 'mine' } }, assist, operator);
      expect(JSON.stringify(reply)).toContain(DEVICE_JSON);
      expect(JSON.stringify(reply)).toContain('secret-session');
      assist.dispose();
    }
    const { assist } = setup();
    const adapterOp = await rpc({ type: LOGIN_RPC.LIST, adapter: 'qq', endpointKey: 'other' }, assist, ADAPTER_OPERATOR);
    expect((adapterOp.data as { tasks: TaskRow[] }).tasks[0]!.payload.image).toBe(QR);
    assist.dispose();
  });

  it('a port without eventSafeFlow strips every challenge\'s media and blocks for viewers', async () => {
    const { assist } = setup();
    const port = {
      listPending: () => assist.listPending(),
      submit: () => false,
      cancel: () => false,
      listFlows: () => assist.listFlows(),
      getFlow: (adapter: string, endpointKey: string) => assist.getFlow(adapter, endpointKey),
      getFlowById: (id: string) => assist.getFlowById(id),
    };
    const ctx = { fullScope: true, projectRoot: '/tmp', loginAssist: port as never, canOperateEndpoint: () => false };
    const reply = await dispatchExtendedConsoleRpc(LOGIN_RPC.FLOW_LIST, {}, ctx);
    expect(leaks(reply)).toEqual([]);
    const flows = ((reply as { data: { flows: FlowRow[] } }).data.flows);
    for (const flow of flows) {
      const challenge = challengeOf(flow);
      expect(challenge).not.toHaveProperty('blocks');
      expect(challenge.media).not.toHaveProperty('qrImage');
      expect(challenge.media).not.toHaveProperty('link');
    }
    expect(challengeOf(flows.find(flow => flow.endpointKey === 'other')!).media).toMatchObject({ qrImageOmitted: true });
    expect(challengeOf(flows.find(flow => flow.endpointKey === 'mine')!).media).toMatchObject({ linkOmitted: true });
    assist.dispose();
  });

  it('a body-supplied canOperateEndpoint cannot widen what a signed-in viewer sees', async () => {
    const { assist, mine } = setup();
    const replies = await dispatchRuntimeConsoleRpc({ requestId: 1, type: LOGIN_RPC.FLOW_GET, flowId: mine.id, canOperateEndpoint: true } as never, {
      authScope: 'full',
      principal: GLOBAL_VIEWER,
      listPages: async () => [],
      extended: { projectRoot: '/tmp', loginAssist: assist as never, canOperateEndpoint: () => true },
    } as never);
    expect(leaks(replies.at(-1))).toEqual([]);
    assist.dispose();
  });

  it('permission and audit maps are unchanged', () => {
    for (const type of [LOGIN_RPC.LIST, LOGIN_RPC.FLOW_LIST, LOGIN_RPC.FLOW_GET]) {
      expect(CONSOLE_RPC_PERMISSIONS[type]).toBe('endpoint.view');
      expect(loginAuditDetail(type, { flows: [] })).toBeUndefined();
    }
    for (const type of [LOGIN_RPC.SUBMIT, LOGIN_RPC.CANCEL, LOGIN_RPC.RELOGIN, LOGIN_RPC.REFRESH]) {
      expect(CONSOLE_RPC_PERMISSIONS[type]).toBe('endpoint.operate');
    }
  });

  it('legacy qrcode / sms / other urls and extra payload fields never reach a viewer through any read', async () => {
    const assist = new LoginAssist(null, { defaultTimeoutMs: 0 });
    for (const [key, type, secret] of [['q', 'qrcode', 'QRSECRET'], ['s', 'sms', 'SMSSECRET'], ['o', 'other', 'OTHERSECRET']] as const) {
      assist.waitForInput('qq', key, type, { message: type, url: `https://x.example/?k=${secret}`, ticket: `${secret}-TICKET` }, { owner: {} }).catch(() => undefined);
    }
    const v2 = assist.beginFlow({ adapter: 'qq', endpointKey: 'c', owner: {} });
    v2.challenge({ kind: 'confirm', title: 'confirm', media: { link: { url: 'https://x.example/?k=CONFIRMSECRET', label: 'l' } }, blocks: [{ kind: 'link', label: 'b', url: 'https://x.example/?k=CBLOCK' }] }).catch(() => undefined);
    const secrets = ['QRSECRET', 'SMSSECRET', 'OTHERSECRET', 'CONFIRMSECRET', 'CBLOCK'];
    const hits = (value: unknown) => secrets.filter(secret => JSON.stringify(value).includes(secret));
    expect(hits(await rpc({ type: LOGIN_RPC.LIST }, assist, GLOBAL_VIEWER))).toEqual([]);
    const list = await rpc({ type: LOGIN_RPC.FLOW_LIST }, assist, GLOBAL_VIEWER);
    expect(hits(list)).toEqual([]);
    for (const flow of (list as { data: { flows: { id: string }[] } }).data.flows) {
      expect(hits(await rpc({ type: LOGIN_RPC.FLOW_GET, flowId: flow.id }, assist, GLOBAL_VIEWER))).toEqual([]);
    }
    // Operators keep the live material.
    expect(hits(await rpc({ type: LOGIN_RPC.FLOW_LIST }, assist, GLOBAL_OPERATOR)).sort()).toEqual([...secrets].sort());
    assist.dispose();
  });
});
