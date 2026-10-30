import { expectTypeOf } from 'vitest';
import { defineCommand } from 'zhin.js/command';
import { defineHandler } from 'zhin.js/handler';
import type { AdapterEvents } from '@zhin.js/feature-kit';

const command = defineCommand({
  adapter: 'icqq', params: { user: { type: 'integer' }, text: { type: 'text' } },
  options: { silent: { type: 'boolean', default: false } },
  async execute({ session, params, options }) {
    expectTypeOf(params.user).toEqualTypeOf<number>();
    expectTypeOf(params.text).toEqualTypeOf<string>();
    expectTypeOf(options.silent).toEqualTypeOf<boolean>();
    // @ts-expect-error direct command invocation has no guaranteed inbound Session
    session.endpoint.getGroupList();
    if (!session) return 'direct';
    expectTypeOf(session.endpoint.uin).toEqualTypeOf<number>();
    expectTypeOf(session.endpoint.endpointName).toEqualTypeOf<string>();
    session.endpoint.loginControl.state();
    const selected = session.adapter.getEndpoint('configured-instance');
    if (selected) selected.loginControl.state();
    // @ts-expect-error a Discord endpoint method is not part of ICQQ
    session.endpoint.guilds.fetch();
    expectTypeOf(session.event).toEqualTypeOf<AdapterEvents<'icqq'>[keyof AdapterEvents<'icqq'>]>();
    await session.reply(params.text);
    return 'sent';
  },
});
expectTypeOf(command.adapter).toEqualTypeOf<'icqq'>();
expectTypeOf(command.execute).returns.toEqualTypeOf<'direct' | 'sent' | Promise<'direct' | 'sent'>>();
const configured = defineCommand.withConfig<{ prefix: string }>()({ adapter: 'icqq', params: { count: { type: 'integer' } },
  execute({ session, config, params }) { expectTypeOf(config.prefix).toEqualTypeOf<string>(); expectTypeOf(params.count).toEqualTypeOf<number>(); if (session) session.endpoint.loginControl.pending(); return 'configured'; },
});
expectTypeOf(configured.adapter).toEqualTypeOf<'icqq'>();
expectTypeOf(configured.execute).returns.toEqualTypeOf<'configured' | Promise<'configured'>>();
function commandFactory(define = defineCommand) {
  return define({ adapter: 'icqq', params: { count: { type: 'integer' } }, execute({ session, params }) { if (session) session.endpoint.loginControl.state(); expectTypeOf(params.count).toEqualTypeOf<number>(); return 'factory'; } });
}
expectTypeOf(commandFactory().adapter).toEqualTypeOf<'icqq'>();
expectTypeOf(commandFactory().execute).returns.toEqualTypeOf<'factory' | Promise<'factory'>>();

defineHandler({ adapter: 'icqq', event: 'message.group', handle({ event }) {
  expectTypeOf(event.group_id).toEqualTypeOf<number>();
  if (!this.session) return;
  this.session.endpoint.loginControl.state();
  expectTypeOf(this.session.adapterName).toEqualTypeOf<'icqq'>();
  // @ts-expect-error the native event is not a canonical group scene until independently narrowed
  void this.session.scene.groupId;
} });
