import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import adapterFeature, {
  Adapter,
  AdapterIndex,
  adapterFeatureId,
  createEndpointSpecification,
  defineAdapter,
  endpointSpec,
  type EndpointSendRequest,
} from '@zhin.js/adapter';
import commandFeature from '@zhin.js/command';
import {
  createSenderEnricher,
  ImRuntime,
} from '@zhin.js/core/runtime';
import { chatRolesFromDocument } from './chat-role-fixture.js';
import { definePlugin, type RuntimeConfigDocument } from '@zhin.js/plugin-runtime';
import { createConfigDocument, RootRuntime, type ModuleRuntime } from '@zhin.js/runtime';
import {
  consumePendingRestartReceipt,
  createRestartChatAuthorizer,
  deliverPendingRestartReceipt,
  installRestartHost,
} from '../../src/instance/restart-host-installer.js';

class Client extends EventEmitter {
  readonly sendNative = vi.fn(async (_request: EndpointSendRequest) => 'sent');
  readonly stopNative = vi.fn();
  readonly [endpointSpec] = createEndpointSpecification(this, {
    start() {},
    open() {},
    close() {},
    stop: () => {
      this.stopNative();
    },
    send: (request) => this.sendNative(request),
  });
}

class Platform extends Adapter<Client> {
  protected createEndpoint() {
    return new Client();
  }
}

class Modules implements ModuleRuntime {
  readonly values = new Map<string, unknown>();
  async load<T>(source: string): Promise<T> {
    if (!this.values.has(source)) throw new Error('Missing fixture module');
    return this.values.get(source) as T;
  }
  invalidate() {}
  async close() {}
}

async function createRestartFixture(options: {
  locale?: 'zh-CN' | 'en';
  restartSupported?: boolean;
} = {}) {
  let clock = 1_000_000;
  const audit = vi.fn();
  const project = await realpath(await mkdtemp(join(tmpdir(), 'zhin-restart-chat-')));
  const modules = new Modules();
  const put = async (file: string, data: unknown) => {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(data));
  };
  const document: RuntimeConfigDocument = {
    configVersion: 2,
    locale: options.locale ?? 'zh-CN',
    plugins: { bot: '@test/bot' },
    // Restarting the instance is host-wide: alice and bob are global owners (ADR 0056 §2); carol only owns the
    // account; dave is globally trusted, which is not enough.
    ai: { trigger: { masters: ['alice', 'bob'], trusted: ['dave'] } },
    bot: {
      master: 'carol',
      commandPrefix: '!!',
      endpoints: [{ id: 'main' }],
    },
  };
  await put(join(project, 'package.json'), {
    name: '@test/root',
    dependencies: { '@test/command': 'workspace:*', '@test/bot': 'workspace:*' },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      features: [{ package: '@test/command' }],
    },
  });
  await put(join(project, 'plugin.ts'), {});
  modules.values.set(join(project, 'plugin.ts'), {
    default: definePlugin({ name: 'root' }),
  });
  await put(join(project, 'plugins/bot/package.json'), {
    name: '@test/bot',
    dependencies: { '@test/adapter': 'workspace:*', '@test/command': 'workspace:*' },
    zhin: {
      protocol: 1,
      type: 'plugin',
      entry: './plugin.ts',
      features: [{ package: '@test/adapter' }],
    },
  });
  await put(join(project, 'plugins/bot/schema.json'), {
    type: 'object',
    additionalProperties: false,
    properties: {
      master: { type: 'string' },
      commandPrefix: { type: 'string' },
      endpoints: {
        type: 'array',
        items: { type: 'object', properties: { id: { type: 'string' } } },
      },
    },
  });
  await put(join(project, 'plugins/bot/plugin.ts'), {});
  modules.values.set(join(project, 'plugins/bot/plugin.ts'), {
    default: definePlugin({ name: 'bot' }),
  });
  const source = join(project, 'plugins/bot/adapters/platform/index.ts');
  await put(source, {});
  modules.values.set(source, {
    default: defineAdapter({
      capabilities: ['inbound', 'outbound'],
      createAdapter: () => new Platform(),
    }),
  });
  for (const [name, feature] of [
    ['command', commandFeature],
    ['adapter', adapterFeature],
  ] as const) {
    await put(join(project, `packages/${name}/package.json`), {
      name: `@test/${name}`,
      zhin: { protocol: 1, type: 'feature', entry: './index.ts' },
    });
    await put(join(project, `packages/${name}/index.ts`), {});
    modules.values.set(join(project, `packages/${name}/index.ts`), { default: feature });
  }
  const file = join(project, 'zhin.config.json');
  await put(file, document);
  const config = createConfigDocument(file);
  const roles = await chatRolesFromDocument(document);
  const im = new ImRuntime({ enrichSender: createSenderEnricher({ roles: () => roles }) });
  const requestRestart = vi.fn();
  const runtime = new RootRuntime({
    projectRoot: project,
    config,
    modules,
    environment: { name: 'test', mode: 'test', platform: 'node' },
    installResources(context) {
      im.install(context.resources);
      installRestartHost({
        projectRoot: project,
        authorize: createRestartChatAuthorizer(() => roles, () => runtime.snapshot),
        restartSupported: () => options.restartSupported ?? true,
        requestRestart,
        restartDelayMs: 10,
        audit,
        now: () => clock,
      })(context);
    },
  });
  await runtime.start();
  im.attach(runtime.snapshots);
  const index = runtime.snapshot.projections.get(adapterFeatureId) as AdapterIndex;
  const row = index.list()[0]!;
  const client = index.clientById<Client>(row.id);
  const receive = async (
    text: string,
    input: { sender?: string; kind?: 'private' | 'group' | 'channel'; conversationId?: string } = {},
  ) =>
    client[endpointSpec].events.message({
      conversation: {
        endpoint: { id: row.id, adapter: 'platform' },
        kind: input.kind ?? 'private',
        id: input.conversationId ?? 'conv-1',
      },
      content: text,
      sender: { id: input.sender ?? 'alice' },
    });

  return {
    project,
    runtime,
    im,
    client,
    requestRestart,
    audit,
    receive,
    advance: (ms: number) => { clock += ms; },
    close: async () => {
      await runtime.stop();
      await rm(project, { recursive: true, force: true });
    },
  };
}

function lastReplyText(client: Client): string {
  return String(client.sendNative.mock.calls.at(-1)?.[0].payload);
}

const waitForRestartTimer = () => new Promise((r) => setTimeout(r, 30));

describe('installRestartHost & deliverPendingRestartReceipt', () => {
  it('denies non-owner restart requests and does not persist a receipt or restart', async () => {
    const f = await createRestartFixture({ locale: 'zh-CN', restartSupported: true });
    try {
      await f.receive('!!重启', { sender: 'stranger', kind: 'private', conversationId: 'stranger' });
      expect(lastReplyText(f.client)).toContain('仅允许全局层 Bot 主人（owner）执行重启指令');
      await f.receive('!!restart confirm', { sender: 'stranger', kind: 'private', conversationId: 'stranger' });
      expect(lastReplyText(f.client)).toContain('仅允许全局层 Bot 主人（owner）执行重启指令');
      // The account owner (migrated from the adapter master) is not the host owner.
      await f.receive('!!重启', { sender: 'carol', kind: 'private', conversationId: 'carol' });
      expect(lastReplyText(f.client)).toContain('仅允许全局层 Bot 主人（owner）执行重启指令');
      // A globally trusted user is not an owner either.
      await f.receive('!!restart', { sender: 'dave', kind: 'private', conversationId: 'dave' });
      expect(lastReplyText(f.client)).toContain('仅允许全局层 Bot 主人（owner）执行重启指令');
      await f.receive('!!restart confirm', { sender: 'dave', kind: 'private', conversationId: 'dave' });
      expect(lastReplyText(f.client)).toContain('仅允许全局层 Bot 主人（owner）执行重启指令');
      await waitForRestartTimer();
      expect(f.requestRestart).not.toHaveBeenCalled();
      expect(await consumePendingRestartReceipt(f.project)).toBeNull();
      expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({
        actor: 'chat:platform:carol', action: 'instance.chat:restart', outcome: 'denied',
        detail: { reason: 'not-global-owner' },
      }));
    } finally {
      await f.close();
    }
  });

  it('lets a global owner restart from a group; others there are denied and cannot confirm', async () => {
    const f = await createRestartFixture({ locale: 'zh-CN', restartSupported: true });
    try {
      // A non-owner in the group gets the same denial as anywhere else.
      await f.receive('!!重启', { sender: 'stranger', kind: 'group', conversationId: 'group-777' });
      expect(lastReplyText(f.client)).toContain('仅允许全局层 Bot 主人（owner）执行重启指令');
      await f.receive('!!重启', { sender: 'alice', kind: 'group', conversationId: 'group-777' });
      expect(lastReplyText(f.client)).toContain('60 秒内回复 !!restart confirm');
      // Another member (even another global owner) cannot confirm alice's request in the same group.
      await f.receive('!!restart confirm', { sender: 'stranger', kind: 'group', conversationId: 'group-777' });
      expect(lastReplyText(f.client)).toContain('仅允许全局层 Bot 主人（owner）执行重启指令');
      await f.receive('!!restart confirm', { sender: 'bob', kind: 'group', conversationId: 'group-777' });
      expect(lastReplyText(f.client)).toContain('没有待确认的重启');
      // Alice confirming from her private chat is another conversation.
      await f.receive('!!restart confirm', { sender: 'alice', kind: 'private', conversationId: 'alice-dm' });
      expect(lastReplyText(f.client)).toContain('没有待确认的重启');
      await waitForRestartTimer();
      expect(f.requestRestart).not.toHaveBeenCalled();
      expect(await consumePendingRestartReceipt(f.project)).toBeNull();

      await f.receive('!!restart confirm', { sender: 'alice', kind: 'group', conversationId: 'group-777' });
      const restartingCall = f.client.sendNative.mock.calls.at(-1)?.[0];
      expect(String(restartingCall?.payload)).toContain('正在重启 Bot');
      expect(restartingCall?.conversation).toMatchObject({ kind: 'group', id: 'group-777' });
      await waitForRestartTimer();
      expect(f.requestRestart).toHaveBeenCalledOnce();
      const receipt = await consumePendingRestartReceipt(f.project);
      expect(receipt?.target).toMatchObject({ kind: 'group', id: 'group-777' });
    } finally {
      await f.close();
    }
  });

  it('refuses to restart when supervisor restart is unsupported', async () => {
    const f = await createRestartFixture({ locale: 'zh-CN', restartSupported: false });
    try {
      await f.receive('!!restart', { sender: 'alice', kind: 'private', conversationId: 'alice-dm' });
      expect(lastReplyText(f.client)).toContain('未受 Supervisor 守护');
      await f.receive('!!restart confirm', { sender: 'alice', kind: 'private', conversationId: 'alice-dm' });
      expect(lastReplyText(f.client)).toContain('未受 Supervisor 守护');
      await waitForRestartTimer();
      expect(f.requestRestart).not.toHaveBeenCalled();
      expect(await consumePendingRestartReceipt(f.project)).toBeNull();
    } finally {
      await f.close();
    }
  });

  it('asks for confirmation first and does nothing until confirmed', async () => {
    const f = await createRestartFixture({ locale: 'zh-CN', restartSupported: true });
    try {
      await f.receive('!!重启', { sender: 'alice', kind: 'private', conversationId: 'alice-dm' });
      expect(lastReplyText(f.client)).toContain('将重启实例');
      expect(lastReplyText(f.client)).toContain('60 秒内回复 !!restart confirm');
      await waitForRestartTimer();
      expect(f.requestRestart).not.toHaveBeenCalled();
      expect(await consumePendingRestartReceipt(f.project)).toBeNull();
      // A confirm without a pending request is refused.
      await f.receive('!!restart confirm', { sender: 'bob', kind: 'private', conversationId: 'bob-dm' });
      expect(lastReplyText(f.client)).toContain('没有待确认的重启');
      await f.receive('!!restart now', { sender: 'alice', kind: 'private', conversationId: 'alice-dm' });
      expect(lastReplyText(f.client)).toContain('用法');
      await waitForRestartTimer();
      expect(f.requestRestart).not.toHaveBeenCalled();
    } finally {
      await f.close();
    }
  });

  it('refuses an expired confirmation', async () => {
    const f = await createRestartFixture({ locale: 'zh-CN', restartSupported: true });
    try {
      await f.receive('!!restart', { sender: 'alice', kind: 'private', conversationId: 'alice-dm' });
      f.advance(60_001);
      await f.receive('!!restart confirm', { sender: 'alice', kind: 'private', conversationId: 'alice-dm' });
      expect(lastReplyText(f.client)).toContain('没有待确认的重启');
      // The expired request is gone: confirming again (still in time from now on) finds nothing.
      await f.receive('!!restart confirm', { sender: 'alice', kind: 'private', conversationId: 'alice-dm' });
      expect(lastReplyText(f.client)).toContain('没有待确认的重启');
      await waitForRestartTimer();
      expect(f.requestRestart).not.toHaveBeenCalled();
      expect(await consumePendingRestartReceipt(f.project)).toBeNull();
    } finally {
      await f.close();
    }
  });

  it('only accepts the confirmation from the same sender in the same conversation', async () => {
    const f = await createRestartFixture({ locale: 'zh-CN', restartSupported: true });
    try {
      await f.receive('!!restart', { sender: 'alice', kind: 'private', conversationId: 'alice-dm' });
      // Another global owner cannot confirm alice's request.
      await f.receive('!!restart confirm', { sender: 'bob', kind: 'private', conversationId: 'alice-dm' });
      expect(lastReplyText(f.client)).toContain('没有待确认的重启');
      // Alice herself, but from another conversation.
      await f.receive('!!restart confirm', { sender: 'alice', kind: 'private', conversationId: 'alice-other' });
      expect(lastReplyText(f.client)).toContain('没有待确认的重启');
      await waitForRestartTimer();
      expect(f.requestRestart).not.toHaveBeenCalled();
      expect(await consumePendingRestartReceipt(f.project)).toBeNull();
    } finally {
      await f.close();
    }
  });

  it('confirms, replies through the endpoint, triggers one restart and reports back after restart', async () => {
    const f = await createRestartFixture({ locale: 'zh-CN', restartSupported: true });
    try {
      await f.receive('!!重启', { sender: 'alice', kind: 'private', conversationId: 'alice-dm' });
      f.advance(59_000);
      await f.receive('!!重启 确认', { sender: 'alice', kind: 'private', conversationId: 'alice-dm' });
      const restartingCall = f.client.sendNative.mock.calls.at(-1)?.[0];
      expect(String(restartingCall?.payload)).toContain('正在重启 Bot');
      expect(restartingCall?.conversation).toMatchObject({ kind: 'private', id: 'alice-dm' });
      // The reply left through the endpoint before the delayed restart request.
      expect(f.requestRestart).not.toHaveBeenCalled();

      await waitForRestartTimer();
      expect(f.requestRestart).toHaveBeenCalledOnce();
      expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({
        actor: 'chat:platform:alice', action: 'instance.chat:restart', outcome: 'ok',
        detail: { reason: 'confirmed' },
      }));

      // A confirmation is single-use.
      await f.receive('!!restart confirm', { sender: 'alice', kind: 'private', conversationId: 'alice-dm' });
      expect(lastReplyText(f.client)).toContain('没有待确认的重启');
      await waitForRestartTimer();
      expect(f.requestRestart).toHaveBeenCalledOnce();

      const delivered = await deliverPendingRestartReceipt({
        projectRoot: f.project,
        im: f.im,
        snapshot: { generation: 1, plugins: 2 },
      });
      expect(delivered).toBe(true);

      const postRestartCall = f.client.sendNative.mock.calls.at(-1)?.[0];
      expect(postRestartCall?.conversation).toMatchObject({
        kind: 'private',
        id: 'alice-dm',
      });
      expect(String(postRestartCall?.payload)).toContain('✅ Bot 重启完成');
      expect(String(postRestartCall?.payload)).toContain('Generation #1');

      // Consumed once — subsequent call is a no-op
      const second = await deliverPendingRestartReceipt({
        projectRoot: f.project,
        im: f.im,
        snapshot: { generation: 1, plugins: 2 },
      });
      expect(second).toBe(false);
    } finally {
      await f.close();
    }
  });
});
