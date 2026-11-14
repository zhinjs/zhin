// #1250: an account whose Endpoint start never finishes must not hold back instance ready, so the
// gateway's ready timeout never restarts the instance in a loop. Slow (about 50 s): run with
// `pnpm test:e2e:gateway` after `pnpm build`.
import { mkdir, writeFile } from 'node:fs/promises';
import {
  createGatewayProject,
  sleep,
  waitFor,
  type GatewayProject,
} from './harness/gateway-project.js';

const enabled = process.env.ZHIN_TEST_GATEWAY_E2E === '1' && process.platform !== 'win32';
// Above a loaded host's instance boot time, far below the "forever" the account waits.
const READY_TIMEOUT_SECONDS = 15;

/** Starts and waits forever (until stopped): a login that never completes on its own. */
const NEVER_READY_ADAPTER = `import { Adapter, createEndpointSpecification, defineAdapter, endpointSpec } from 'zhin.js/adapter';
import { EventEmitter } from 'node:events';

class NeverClient extends EventEmitter {}
class NeverEndpoint extends NeverClient {
  constructor() {
    super();
    this[endpointSpec] = createEndpointSpecification(this, {
      start: (signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
      open() {}, close() {}, stop() {}, send: async () => 'never',
    });
  }
}
class NeverAdapter extends Adapter {
  createEndpoint() { return new NeverEndpoint(); }
}
export default defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => new NeverAdapter() });
`;

describe.skipIf(!enabled)('account start does not block instance ready (gateway, #1250)', () => {
  let project: GatewayProject;

  beforeAll(async () => {
    project = await createGatewayProject('endpoint-start', {
      extraConfig: `gateway:\n  readyTimeout: ${READY_TIMEOUT_SECONDS}\n`,
    });
    await mkdir(project.path('adapters/never'), { recursive: true });
    await writeFile(project.path('adapters/never/index.ts'), NEVER_READY_ADAPTER);
  }, 60_000);

  afterAll(async () => {
    await project?.dispose();
  }, 60_000);

  it('reports the instance ready and keeps its pid past twice the ready timeout', async () => {
    const started = await project.zhin(['start']);
    expect(started.code, started.stderr).toBe(0);
    let last: unknown;
    const status = await waitFor('instance running', async () => {
      const current = await project.status();
      last = current;
      return current.instance?.state === 'running' && current.instance.pid !== undefined ? current : undefined;
    }, 60_000).catch(async (error: unknown) => {
      const logs = await project.zhin(['logs', '--lines', '80']).catch(() => undefined);
      throw new Error(`${String(error)}\nlast status: ${JSON.stringify(last)}\n${logs?.stdout ?? ''}${logs?.stderr ?? ''}`);
    });
    const pid = status.instance!.pid!;
    const health = await project.json('/pub/health');
    expect(health.body.instance).toEqual({ state: 'running', ready: true });

    // No owner yet: the local project is open, so the details are readable without a token.
    const readiness = await project.json('/api/system/readiness');
    expect(readiness.status).toBe(200);
    expect(readiness.body.data.endpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'never', phase: 'starting' }),
    ]));

    await sleep(READY_TIMEOUT_SECONDS * 2 * 1000 + 2_000);
    const later = await project.status();
    expect(later.instance).toMatchObject({ state: 'running', pid });
    expect(later.instance?.recentRestarts ?? 0).toBe(0);
    expect((await project.json('/pub/health')).body.instance).toEqual({ state: 'running', ready: true });

    const stopped = await project.zhin(['stop', '--timeout', '30000'], { timeoutMs: 45_000 });
    expect(stopped.code, stopped.stderr).toBe(0);
  }, 120_000);
});
