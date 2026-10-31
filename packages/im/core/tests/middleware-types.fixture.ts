import {
  defineMiddleware,
  // @ts-expect-error The IM facade does not expose its internal overload input helper.
  type MiddlewareAuthoringDefinition,
} from '../src/feature/middleware.js';
declare const internalOverloadInput: MiddlewareAuthoringDefinition;
void internalOverloadInput;
import { defineMiddleware as defineFeatureMiddleware } from '@zhin.js/middleware';
import type { Message, OutboundEnvelope } from '../src/plugin-runtime/im/contracts.js';
import type { HandlerContext } from '@zhin.js/handler';

declare class RegisteredTestAdapter {
  readonly adapterEvents: Record<string, unknown>;
  getEndpoint(instanceId: string): { sendNative(payload: string): void } | undefined;
}
declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry { readonly 'typed-middleware': RegisteredTestAdapter; }
}

defineMiddleware({
  adapter: 'typed-middleware',
  async handle({ input, $client }, next) {
    await input.$reply('IM message with native client');
    $client.sendNative('typed');
    // @ts-expect-error The adapter name selects its native Client contract.
    $client.missing();
    await next();
  },
});

// IM authoring defaults to the actual message, with no annotation or cast.
defineMiddleware({
  async handle({ input }, next) {
    const message: Message = input;
    await message.$reply('ack');
    await next();
  },
});
defineMiddleware({
  target: 'outbound',
  async handle({ input }, next) {
    const envelope: OutboundEnvelope = input;
    envelope.replace('replacement');
    // @ts-expect-error An outbound envelope is not an inbound Message.
    input.$reply('wrong');
    await next();
  },
});
// Generic Feature authoring deliberately does not invent an IM message.
defineFeatureMiddleware({
  handle({ input }, next) {
    // @ts-expect-error A generic Feature may be called without a message.
    input.$reply('wrong');
    return next();
  },
});
defineFeatureMiddleware<undefined>({
  handle({ input }, next) {
    const noMessage: undefined = input;
    void noMessage;
    return next();
  },
});
function hostHandler(context: HandlerContext) {
  // @ts-expect-error Non-IM handler calls have no guaranteed interaction.
  context.interaction.ask({ type: 'text', title: 'Reply' });
  if (context.interaction) context.interaction.ask({ type: 'text', title: 'Reply' });
}
void hostHandler;


// Runtime assembly uses cohesive data/authority objects, without positional compatibility overloads.
import { RuntimeMessage, OutboundRenderer, type RuntimeMessageFacts, type RuntimeMessageOperation } from '../src/plugin-runtime/im/index.js';
declare const messageFacts: RuntimeMessageFacts;
declare const messageOperation: RuntimeMessageOperation;
new RuntimeMessage(messageFacts, messageOperation);
// @ts-expect-error removed positional constructor cannot confuse sender, message and endpoint fields
new RuntimeMessage(messageFacts.conversation, messageFacts.content, messageOperation.generation, messageOperation.reply);
if (messageOperation.snapshot && messageOperation.requester) {
  new OutboundRenderer().render(messageFacts.content, {
    snapshot: messageOperation.snapshot, requester: messageOperation.requester, conversation: messageFacts.conversation,
  });
  // @ts-expect-error rendering dependencies belong to one named operation context
  new OutboundRenderer().render(messageFacts.content, messageOperation.requester, messageOperation.snapshot);
}
