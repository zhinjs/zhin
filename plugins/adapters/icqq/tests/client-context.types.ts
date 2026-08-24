import type { Message, OutboundEnvelope } from '@zhin.js/core/runtime';
import { defineAgentTool } from '@zhin.js/tool';
import { defineCommand } from 'zhin.js/command';
import { defineHandler } from 'zhin.js/handler';
import { defineMiddleware } from 'zhin.js/middleware';
import type { IcqqClient } from '../src/client.js';

type IsExactlyUnknown<T> = unknown extends T
  ? keyof T extends never
    ? true
    : false
  : false;
type Assert<T extends true> = T;

defineHandler({
  adapter: 'icqq',
  event: 'request.group.add',
  async handle({ client, event, endpoint }) {
    const exactClient: IcqqClient = client;
    const flag: string = event.flag;
    const adapter: string = endpoint.adapter;
    await exactClient.setGroupAddRequest(flag, true);
    void adapter;
  },
});

defineCommand({
  adapter: 'icqq',
  async execute(context) {
    const exactClient: IcqqClient = context.$client;
    await exactClient.sendLike(Number(context.sender!.id), 10);
    return '点赞完成';
  },
});

defineCommand({
  execute(context) {
    type ClientRemainsUnknown = Assert<IsExactlyUnknown<typeof context.$client>>;
    const assertion: ClientRemainsUnknown = true;
    return assertion;
  },
});

defineMiddleware<Message>({
  target: 'inbound',
  adapter: 'icqq',
  async handle(context, next) {
    const exactClient: IcqqClient = context.$client;
    const account: number = exactClient.uin;
    const content: string = context.input.content;
    void account;
    void content;
    await next();
  },
});

defineMiddleware<OutboundEnvelope>({
  target: 'outbound',
  adapter: 'icqq',
  async handle(context, next) {
    const exactClient: IcqqClient = context.$client;
    const account: number = exactClient.uin;
    void account;
    await next();
  },
});

defineMiddleware<Message>({
  target: 'inbound',
  async handle(context, next) {
    type ClientRemainsUnknown = Assert<IsExactlyUnknown<typeof context.$client>>;
    const assertion: ClientRemainsUnknown = true;
    void assertion;
    await next();
  },
});

defineAgentTool<Record<string, never>>({
  adapter: 'icqq',
  description: 'List groups',
  async execute(_input, context) {
    const exactClient: IcqqClient = context.$client;
    return exactClient.getGroupList();
  },
});

defineAgentTool<Record<string, never>>({
  description: 'No adapter binding',
  execute(_input, context) {
    type ClientRemainsUnknown = Assert<IsExactlyUnknown<typeof context.$client>>;
    const assertion: ClientRemainsUnknown = true;
    return assertion;
  },
});
