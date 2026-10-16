import type {
  CommandContext, CommandDefinition, CommandMessage, CommandParameterValue,
} from '@zhin.js/command';
import type { HandlerContext, HandlerDefinition } from '@zhin.js/handler';
import type {
  MiddlewareContext, MiddlewareDefinition, MiddlewareNext,
} from '@zhin.js/middleware';
import type { FakePlugin } from './fake-plugin.js';

/** Inbound message with recorded replies. */
export interface FakeMessage extends CommandMessage {
  /** Everything passed to `$reply`, in order. */
  readonly replies: unknown[];
}

export interface FakeMessageInit {
  readonly content?: string;
  readonly sender?: { readonly id: string; readonly name?: string; readonly roles?: readonly string[] };
  readonly conversation?: Partial<CommandMessage['conversation']>;
  readonly id?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly $client?: unknown;
}

export function createFakeMessage(init: FakeMessageInit = {}): FakeMessage {
  const replies: unknown[] = [];
  const conversation: CommandMessage['conversation'] = {
    endpoint: { id: 'test', adapter: 'test' }, kind: 'group', id: 'test-group', ...init.conversation,
  };
  return {
    conversation, content: init.content ?? '',
    sender: init.sender ?? { id: 'test-user', name: 'Tester', roles: [] },
    ...(init.id === undefined ? {} : { id: init.id }),
    ...(init.metadata === undefined ? {} : { metadata: init.metadata }),
    ...(init.$client === undefined ? {} : { $client: init.$client }),
    replies,
    async $reply(content: unknown) { replies.push(content); return `reply-${replies.length}`; },
  };
}

export interface RunCommandOptions<TInput extends CommandMessage = FakeMessage> {
  readonly input?: TInput;
  readonly args?: readonly string[];
  readonly params?: Readonly<Record<string, CommandParameterValue>>;
  readonly options?: Readonly<Record<string, CommandParameterValue>>;
  readonly segments?: CommandContext['segments'];
  readonly interaction?: CommandContext['interaction'];
}

/** Build the context a command receives from the fake plugin; usable for direct `execute()` calls. */
export function createCommandContext<TConfig, TInput extends CommandMessage = FakeMessage>(
  fake: FakePlugin<TConfig>,
  options: RunCommandOptions<TInput> = {},
): CommandContext<TConfig, TInput, string | undefined> {
  const input = (options.input ?? createFakeMessage()) as TInput;
  const conversation = input.conversation;
  const sender = input.sender;
  return {
    ...fake.capabilityContext(),
    args: options.args ?? [],
    params: options.params ?? {},
    options: options.options ?? {},
    segments: options.segments ?? [],
    input,
    $client: input.$client as never,
    interaction: options.interaction,
    adapter: conversation.endpoint.adapter,
    endpoint: conversation.endpoint.id,
    scene: input.scene ?? { id: conversation.id, type: conversation.kind },
    ...(sender ? { sender: { id: sender.id, name: sender.name, role: sender.roles ?? [] } } : {}),
  };
}

/**
 * Execute a command definition against the fake. This calls `execute()` directly: it does NOT run
 * route matching, parameter parsing, `permit`, or admission. Use `PluginTestKit` for those.
 */
export async function runCommand<TConfig, TResult, TInput extends CommandMessage = FakeMessage>(
  fake: FakePlugin<TConfig>,
  definition: CommandDefinition<TConfig, TResult, TInput, string | undefined>,
  options?: RunCommandOptions<TInput>,
): Promise<TResult> {
  return definition.execute(createCommandContext(fake, options));
}

export interface RunMiddlewareResult {
  /** `true` when the middleware called `next()`. */
  readonly continued: boolean;
  readonly result: unknown;
}

/** Execute an inbound or outbound middleware's `handle()`; `next` records whether it was called. */
export async function runMiddleware<TConfig, TInput = FakeMessage>(
  fake: FakePlugin<TConfig>,
  definition: MiddlewareDefinition<TInput, TConfig, string | undefined>,
  input: TInput = createFakeMessage() as TInput,
): Promise<RunMiddlewareResult> {
  let continued = false;
  const context: MiddlewareContext<TInput, TConfig, string | undefined> = {
    ...fake.capabilityContext(),
    input,
    $client: (input as { $client?: unknown } | undefined)?.$client as never,
  };
  const next = (async () => { continued = true; return undefined; }) as unknown as MiddlewareNext;
  const result = await definition.handle(context, next as never);
  return { continued, result };
}

/** Execute a handler's `handle()` with `this` bound to a capability context. */
export async function runHandler<TConfig>(
  fake: FakePlugin<TConfig>,
  definition: HandlerDefinition,
  ...args: unknown[]
): Promise<void> {
  const context: HandlerContext<TConfig> = fake.capabilityContext();
  await definition.handle.call(context as HandlerContext, ...args);
}
