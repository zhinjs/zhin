import { expectTypeOf } from 'vitest';
import { defineCommand } from 'zhin.js/command';
import { defineHandler } from 'zhin.js/handler';
import type { AdapterClient, AdapterInstance } from '@zhin.js/feature-kit';
import { NapcatAdapter } from '../../napcat/src/index.js';
import { Onebot11Adapter } from '../../onebot11/src/index.js';
import { Onebot12Adapter } from '../../onebot12/src/index.js';
import { MilkyAdapter } from '../../milky/src/index.js';
import { SatoriAdapter } from '../../satori/src/index.js';
import { SandboxAdapter } from '../../sandbox/src/index.js';
import { BilibiliAdapter } from '../../bilibili/src/index.js';
import { BilibiliLiveAdapter } from '../../bilibili-live/src/index.js';

expectTypeOf<AdapterInstance<'napcat'>>().toEqualTypeOf<NapcatAdapter>();
expectTypeOf<AdapterClient<'napcat'>>().toEqualTypeOf<NonNullable<ReturnType<NapcatAdapter['getEndpoint']>>>();
const napcat = defineCommand({ adapter: 'napcat', params: { count: { type: 'integer' } },
  options: { silent: { type: 'boolean', default: false } },
  execute({ session, params, options, $client }) {
    expectTypeOf(params.count).toEqualTypeOf<number>(); expectTypeOf(options.silent).toEqualTypeOf<boolean>();
    expectTypeOf($client).toEqualTypeOf<AdapterClient<'napcat'>>();
    // @ts-expect-error direct invocation does not fabricate an inbound Session
    void session.endpoint;
    if (!session) return 'direct';
    expectTypeOf(session.adapterName).toEqualTypeOf<'napcat'>();
    expectTypeOf(session.adapter).toEqualTypeOf<NapcatAdapter>();
    expectTypeOf(session.endpoint).toEqualTypeOf<AdapterClient<'napcat'>>();
    session.endpoint.callApi('get_login_info');
    // @ts-expect-error registry inference must never erase the actual native Endpoint into any
    session.endpoint.notARealNativeMethod();
    session.adapter.getEndpoint('instance');
    return 'native';
  },
});
expectTypeOf(napcat.adapter).toEqualTypeOf<'napcat'>();
expectTypeOf(napcat.execute).returns.toEqualTypeOf<'direct' | 'native' | Promise<'direct' | 'native'>>();
defineHandler({ adapter: 'napcat', event: 'message.receive', handle() {
  if (!this.session) return;
  expectTypeOf(this.session.endpoint).toEqualTypeOf<AdapterClient<'napcat'>>();
  // @ts-expect-error native event context is not itself proof of a group scene
  void this.session.scene.groupId;
} });

expectTypeOf<AdapterInstance<'onebot11'>>().toEqualTypeOf<Onebot11Adapter>();
expectTypeOf<AdapterClient<'onebot11'>>().toEqualTypeOf<NonNullable<ReturnType<Onebot11Adapter['getEndpoint']>>>();
const onebot11 = defineCommand({ adapter: 'onebot11', params: { count: { type: 'integer' } },
  options: { silent: { type: 'boolean', default: false } },
  execute({ session, params, options, $client }) {
    expectTypeOf(params.count).toEqualTypeOf<number>(); expectTypeOf(options.silent).toEqualTypeOf<boolean>();
    expectTypeOf($client).toEqualTypeOf<AdapterClient<'onebot11'>>();
    // @ts-expect-error direct invocation does not fabricate an inbound Session
    void session.endpoint;
    if (!session) return 'direct';
    expectTypeOf(session.adapterName).toEqualTypeOf<'onebot11'>();
    expectTypeOf(session.adapter).toEqualTypeOf<Onebot11Adapter>();
    expectTypeOf(session.endpoint).toEqualTypeOf<AdapterClient<'onebot11'>>();
    session.endpoint.call('get_login_info');
    // @ts-expect-error registry inference must never erase the actual native Endpoint into any
    session.endpoint.notARealNativeMethod();
    session.adapter.getEndpoint('instance');
    return 'native';
  },
});
expectTypeOf(onebot11.adapter).toEqualTypeOf<'onebot11'>();
expectTypeOf(onebot11.execute).returns.toEqualTypeOf<'direct' | 'native' | Promise<'direct' | 'native'>>();
defineHandler({ adapter: 'onebot11', event: 'message.receive', handle() {
  if (!this.session) return;
  expectTypeOf(this.session.endpoint).toEqualTypeOf<AdapterClient<'onebot11'>>();
  // @ts-expect-error native event context is not itself proof of a group scene
  void this.session.scene.groupId;
} });

expectTypeOf<AdapterInstance<'onebot12'>>().toEqualTypeOf<Onebot12Adapter>();
expectTypeOf<AdapterClient<'onebot12'>>().toEqualTypeOf<NonNullable<ReturnType<Onebot12Adapter['getEndpoint']>>>();
const onebot12 = defineCommand({ adapter: 'onebot12', params: { count: { type: 'integer' } },
  options: { silent: { type: 'boolean', default: false } },
  execute({ session, params, options, $client }) {
    expectTypeOf(params.count).toEqualTypeOf<number>(); expectTypeOf(options.silent).toEqualTypeOf<boolean>();
    expectTypeOf($client).toEqualTypeOf<AdapterClient<'onebot12'>>();
    // @ts-expect-error direct invocation does not fabricate an inbound Session
    void session.endpoint;
    if (!session) return 'direct';
    expectTypeOf(session.adapterName).toEqualTypeOf<'onebot12'>();
    expectTypeOf(session.adapter).toEqualTypeOf<Onebot12Adapter>();
    expectTypeOf(session.endpoint).toEqualTypeOf<AdapterClient<'onebot12'>>();
    session.endpoint.call('get_self_info');
    // @ts-expect-error registry inference must never erase the actual native Endpoint into any
    session.endpoint.notARealNativeMethod();
    session.adapter.getEndpoint('instance');
    return 'native';
  },
});
expectTypeOf(onebot12.adapter).toEqualTypeOf<'onebot12'>();
expectTypeOf(onebot12.execute).returns.toEqualTypeOf<'direct' | 'native' | Promise<'direct' | 'native'>>();
defineHandler({ adapter: 'onebot12', event: 'message.receive', handle() {
  if (!this.session) return;
  expectTypeOf(this.session.endpoint).toEqualTypeOf<AdapterClient<'onebot12'>>();
  // @ts-expect-error native event context is not itself proof of a group scene
  void this.session.scene.groupId;
} });

expectTypeOf<AdapterInstance<'milky'>>().toEqualTypeOf<MilkyAdapter>();
expectTypeOf<AdapterClient<'milky'>>().toEqualTypeOf<NonNullable<ReturnType<MilkyAdapter['getEndpoint']>>>();
const milky = defineCommand({ adapter: 'milky', params: { count: { type: 'integer' } },
  options: { silent: { type: 'boolean', default: false } },
  execute({ session, params, options, $client }) {
    expectTypeOf(params.count).toEqualTypeOf<number>(); expectTypeOf(options.silent).toEqualTypeOf<boolean>();
    expectTypeOf($client).toEqualTypeOf<AdapterClient<'milky'>>();
    // @ts-expect-error direct invocation does not fabricate an inbound Session
    void session.endpoint;
    if (!session) return 'direct';
    expectTypeOf(session.adapterName).toEqualTypeOf<'milky'>();
    expectTypeOf(session.adapter).toEqualTypeOf<MilkyAdapter>();
    expectTypeOf(session.endpoint).toEqualTypeOf<AdapterClient<'milky'>>();
    session.endpoint.call('get_login_info');
    // @ts-expect-error registry inference must never erase the actual native Endpoint into any
    session.endpoint.notARealNativeMethod();
    session.adapter.getEndpoint('instance');
    return 'native';
  },
});
expectTypeOf(milky.adapter).toEqualTypeOf<'milky'>();
expectTypeOf(milky.execute).returns.toEqualTypeOf<'direct' | 'native' | Promise<'direct' | 'native'>>();
defineHandler({ adapter: 'milky', event: 'message.receive', handle() {
  if (!this.session) return;
  expectTypeOf(this.session.endpoint).toEqualTypeOf<AdapterClient<'milky'>>();
  // @ts-expect-error native event context is not itself proof of a group scene
  void this.session.scene.groupId;
} });

expectTypeOf<AdapterInstance<'satori'>>().toEqualTypeOf<SatoriAdapter>();
expectTypeOf<AdapterClient<'satori'>>().toEqualTypeOf<NonNullable<ReturnType<SatoriAdapter['getEndpoint']>>>();
const satori = defineCommand({ adapter: 'satori', params: { count: { type: 'integer' } },
  options: { silent: { type: 'boolean', default: false } },
  execute({ session, params, options, $client }) {
    expectTypeOf(params.count).toEqualTypeOf<number>(); expectTypeOf(options.silent).toEqualTypeOf<boolean>();
    expectTypeOf($client).toEqualTypeOf<AdapterClient<'satori'>>();
    // @ts-expect-error direct invocation does not fabricate an inbound Session
    void session.endpoint;
    if (!session) return 'direct';
    expectTypeOf(session.adapterName).toEqualTypeOf<'satori'>();
    expectTypeOf(session.adapter).toEqualTypeOf<SatoriAdapter>();
    expectTypeOf(session.endpoint).toEqualTypeOf<AdapterClient<'satori'>>();
    session.endpoint.call('login', 'get', {});
    // @ts-expect-error registry inference must never erase the actual native Endpoint into any
    session.endpoint.notARealNativeMethod();
    session.adapter.getEndpoint('instance');
    return 'native';
  },
});
expectTypeOf(satori.adapter).toEqualTypeOf<'satori'>();
expectTypeOf(satori.execute).returns.toEqualTypeOf<'direct' | 'native' | Promise<'direct' | 'native'>>();
defineHandler({ adapter: 'satori', event: 'message.receive', handle() {
  if (!this.session) return;
  expectTypeOf(this.session.endpoint).toEqualTypeOf<AdapterClient<'satori'>>();
  // @ts-expect-error native event context is not itself proof of a group scene
  void this.session.scene.groupId;
} });

expectTypeOf<AdapterInstance<'sandbox'>>().toEqualTypeOf<SandboxAdapter>();
expectTypeOf<AdapterClient<'sandbox'>>().toEqualTypeOf<NonNullable<ReturnType<SandboxAdapter['getEndpoint']>>>();
const sandbox = defineCommand({ adapter: 'sandbox', params: { count: { type: 'integer' } },
  options: { silent: { type: 'boolean', default: false } },
  execute({ session, params, options, $client }) {
    expectTypeOf(params.count).toEqualTypeOf<number>(); expectTypeOf(options.silent).toEqualTypeOf<boolean>();
    expectTypeOf($client).toEqualTypeOf<AdapterClient<'sandbox'>>();
    // @ts-expect-error direct invocation does not fabricate an inbound Session
    void session.endpoint;
    if (!session) return 'direct';
    expectTypeOf(session.adapterName).toEqualTypeOf<'sandbox'>();
    expectTypeOf(session.adapter).toEqualTypeOf<SandboxAdapter>();
    expectTypeOf(session.endpoint).toEqualTypeOf<AdapterClient<'sandbox'>>();
    session.endpoint.send('peer', 'native payload');
    // @ts-expect-error registry inference must never erase the actual native Endpoint into any
    session.endpoint.notARealNativeMethod();
    session.adapter.getEndpoint('instance');
    return 'native';
  },
});
expectTypeOf(sandbox.adapter).toEqualTypeOf<'sandbox'>();
expectTypeOf(sandbox.execute).returns.toEqualTypeOf<'direct' | 'native' | Promise<'direct' | 'native'>>();
defineHandler({ adapter: 'sandbox', event: 'message.receive', handle() {
  if (!this.session) return;
  expectTypeOf(this.session.endpoint).toEqualTypeOf<AdapterClient<'sandbox'>>();
  // @ts-expect-error native event context is not itself proof of a group scene
  void this.session.scene.groupId;
} });

expectTypeOf<AdapterInstance<'bilibili'>>().toEqualTypeOf<BilibiliAdapter>();
expectTypeOf<AdapterClient<'bilibili'>>().toEqualTypeOf<NonNullable<ReturnType<BilibiliAdapter['getEndpoint']>>>();
const bilibili = defineCommand({ adapter: 'bilibili', params: { count: { type: 'integer' } },
  options: { silent: { type: 'boolean', default: false } },
  execute({ session, params, options, $client }) {
    expectTypeOf(params.count).toEqualTypeOf<number>(); expectTypeOf(options.silent).toEqualTypeOf<boolean>();
    expectTypeOf($client).toEqualTypeOf<AdapterClient<'bilibili'>>();
    // @ts-expect-error direct invocation does not fabricate an inbound Session
    void session.endpoint;
    if (!session) return 'direct';
    expectTypeOf(session.adapterName).toEqualTypeOf<'bilibili'>();
    expectTypeOf(session.adapter).toEqualTypeOf<BilibiliAdapter>();
    expectTypeOf(session.endpoint).toEqualTypeOf<AdapterClient<'bilibili'>>();
    session.endpoint.getNav();
    // @ts-expect-error registry inference must never erase the actual native Endpoint into any
    session.endpoint.notARealNativeMethod();
    session.adapter.getEndpoint('instance');
    return 'native';
  },
});
expectTypeOf(bilibili.adapter).toEqualTypeOf<'bilibili'>();
expectTypeOf(bilibili.execute).returns.toEqualTypeOf<'direct' | 'native' | Promise<'direct' | 'native'>>();
defineHandler({ adapter: 'bilibili', event: 'message.receive', handle() {
  if (!this.session) return;
  expectTypeOf(this.session.endpoint).toEqualTypeOf<AdapterClient<'bilibili'>>();
  // @ts-expect-error native event context is not itself proof of a group scene
  void this.session.scene.groupId;
} });

expectTypeOf<AdapterInstance<'bilibili-live'>>().toEqualTypeOf<BilibiliLiveAdapter>();
expectTypeOf<AdapterClient<'bilibili-live'>>().toEqualTypeOf<NonNullable<ReturnType<BilibiliLiveAdapter['getEndpoint']>>>();
const bilibili_live = defineCommand({ adapter: 'bilibili-live', params: { count: { type: 'integer' } },
  options: { silent: { type: 'boolean', default: false } },
  execute({ session, params, options, $client }) {
    expectTypeOf(params.count).toEqualTypeOf<number>(); expectTypeOf(options.silent).toEqualTypeOf<boolean>();
    expectTypeOf($client).toEqualTypeOf<AdapterClient<'bilibili-live'>>();
    // @ts-expect-error direct invocation does not fabricate an inbound Session
    void session.endpoint;
    if (!session) return 'direct';
    expectTypeOf(session.adapterName).toEqualTypeOf<'bilibili-live'>();
    expectTypeOf(session.adapter).toEqualTypeOf<BilibiliLiveAdapter>();
    expectTypeOf(session.endpoint).toEqualTypeOf<AdapterClient<'bilibili-live'>>();
    session.endpoint.identifySelf();
    // @ts-expect-error registry inference must never erase the actual native Endpoint into any
    session.endpoint.notARealNativeMethod();
    session.adapter.getEndpoint('instance');
    return 'native';
  },
});
expectTypeOf(bilibili_live.adapter).toEqualTypeOf<'bilibili-live'>();
expectTypeOf(bilibili_live.execute).returns.toEqualTypeOf<'direct' | 'native' | Promise<'direct' | 'native'>>();
defineHandler({ adapter: 'bilibili-live', event: 'message.receive', handle() {
  if (!this.session) return;
  expectTypeOf(this.session.endpoint).toEqualTypeOf<AdapterClient<'bilibili-live'>>();
  // @ts-expect-error native event context is not itself proof of a group scene
  void this.session.scene.groupId;
} });

defineCommand.withConfig<{ prefix: string }>()({ adapter: 'onebot11', execute({ session, config }) {
  expectTypeOf(config.prefix).toEqualTypeOf<string>(); if (session) session.endpoint.call('get_login_info'); return 'configured';
} });
