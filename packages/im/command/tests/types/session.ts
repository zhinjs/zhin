import { expectTypeOf } from 'vitest';
import { defineCommand } from '../../src/index.js';
import type { OperationScene, OperationSession } from '@zhin.js/feature-kit';

const command = defineCommand({
  adapter: 'typed-session-test',
  params: { user: { type: 'integer' }, text: { type: 'text' } },
  options: { silent: { type: 'boolean', default: false } },
  execute({ session, params, options }) {
    expectTypeOf(params.user).toEqualTypeOf<number>();
    expectTypeOf(params.text).toEqualTypeOf<string>();
    expectTypeOf(options.silent).toEqualTypeOf<boolean>();
    // @ts-expect-error direct calls have no guaranteed IM Session
    session.endpoint.endpointOnly();
    if (!session) return 'direct';
    expectTypeOf(session.adapter.adapterOnly()).toEqualTypeOf<'typed-adapter'>();
    expectTypeOf(session.endpoint.endpointOnly()).toEqualTypeOf<'native-endpoint'>();
    expectTypeOf(session.adapterName).toEqualTypeOf<'typed-session-test'>();
    // @ts-expect-error another platform's operation is unavailable
    session.endpoint.discordOnly();
    // @ts-expect-error integer parameters do not become strings
    const wrong: string = params.user;
    // @ts-expect-error a group scene requires independent narrowing
    const group: Extract<OperationScene, { kind: 'group' }> = session.scene;
    if (session.scene.kind === 'group') expectTypeOf(session.scene.kind).toEqualTypeOf<'group'>();
    // @ts-expect-error private events do not necessarily have group_id
    void session.event.group_id;
    if ('group_id' in session.event) expectTypeOf(session.event.group_id).toEqualTypeOf<number>();
    void wrong; void group;
    return 'handled';
  },
});
expectTypeOf(command.adapter).toEqualTypeOf<'typed-session-test'>();
expectTypeOf(command.execute).returns.toEqualTypeOf<'handled' | 'direct' | Promise<'handled' | 'direct'>>();
expectTypeOf<Parameters<typeof command.execute>[0]['session']>().toEqualTypeOf<OperationSession<'typed-session-test'> | undefined>();

const defineConfigured = defineCommand.withConfig<{ prefix: string }>();
const configured = defineConfigured({ adapter: 'typed-session-test', params: { count: { type: 'integer' } },
  execute({ session, config, params }) {
    expectTypeOf(config.prefix).toEqualTypeOf<string>(); expectTypeOf(params.count).toEqualTypeOf<number>();
    if (session) session.endpoint.endpointOnly();
    return 'configured';
  },
});
expectTypeOf(configured.adapter).toEqualTypeOf<'typed-session-test'>();
expectTypeOf(configured.execute).returns.toEqualTypeOf<'configured' | Promise<'configured'>>();
function factory() { return defineCommand({ adapter: 'typed-session-test', options: { count: { type: 'integer', default: 1 } }, execute({ session, options }) { if (session) session.adapter.adapterOnly(); expectTypeOf(options.count).toEqualTypeOf<number>(); return 'factory'; } }); }
expectTypeOf(factory().adapter).toEqualTypeOf<'typed-session-test'>();
expectTypeOf(factory().execute).returns.toEqualTypeOf<'factory' | Promise<'factory'>>();
defineCommand({ execute({ session }) { if (session) { expectTypeOf(session.adapter).toBeUnknown(); expectTypeOf(session.endpoint).toBeUnknown(); } return 'generic'; } });

// Higher Feature packages consume the same platform registry and Session structure.
import { defineHandler } from '../../../handler/src/index.js';
import { defineMiddleware } from '../../../middleware/src/index.js';
declare module '../../../handler/src/definition.js' { interface HandlerEventMap { 'typed.message': [message: { text: string }] } }
defineHandler({ adapter: 'typed-session-test', event: 'typed.message', handle(message) {
  expectTypeOf(message.text).toEqualTypeOf<string>();
  if (!this.session) return;
  expectTypeOf(this.session.adapterName).toEqualTypeOf<'typed-session-test'>();
  this.session.adapter.adapterOnly(); this.session.endpoint.endpointOnly();
  // @ts-expect-error wrong platform operation is not accepted on a handler Session
  this.session.endpoint.discordOnly();
} });
defineMiddleware({ adapter: 'typed-session-test', async handle({ session }, next) {
  if (session) {
    expectTypeOf(session.adapterName).toEqualTypeOf<'typed-session-test'>();
    session.adapter.adapterOnly(); session.endpoint.endpointOnly();
    // @ts-expect-error wrong platform operation is not accepted on a middleware Session
    session.endpoint.discordOnly();
  }
  await next();
} });
defineHandler({ event: 'typed.message', handle() {
  if (!this.session) return;
  expectTypeOf(this.session.adapter).toBeUnknown();
  expectTypeOf(this.session.endpoint).toBeUnknown();
  // @ts-expect-error an unbound handler has no inferred platform methods
  this.session.endpoint.endpointOnly();
} });
