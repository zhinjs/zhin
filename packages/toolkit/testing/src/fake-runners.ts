import { resolveLocale, type Locale } from 'zhin.js/i18n';
import type {
  CommandContext, CommandDefinition, CommandMessage, CommandParameterValue,
} from 'zhin.js/command';
import type { HandlerContext, HandlerDefinition } from 'zhin.js/handler';
import type {
  MiddlewareContext, MiddlewareDefinition, MiddlewareNext,
} from 'zhin.js/middleware';
import {
  parseToolInputSchema,
  type AgentToolDefinition, type ToolExecutionContext, type ToolInvocationOrigin,
  type ToolInvocationPolicy, type ToolQuestionPort,
} from '@zhin.js/tool';
import type { OperationClientPort } from 'zhin.js';
import type { FakePlugin } from './fake-plugin.js';
import { fileURLToPath } from 'node:url';

/** Inbound message with recorded replies. */
export interface FakeMessage extends CommandMessage {
  /** Everything passed to `$reply`, in order. */
  readonly replies: unknown[];
}

export interface FakeMessageInit {
  readonly locale?: Locale;
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
    conversation, content: init.content ?? '', locale: resolveLocale(init.locale),
    sender: init.sender ?? { id: 'test-user', name: 'Tester', roles: [] },
    ...(init.id === undefined ? {} : { id: init.id }),
    ...(init.metadata === undefined ? {} : { metadata: init.metadata }),
    ...(init.$client === undefined ? {} : { $client: init.$client }),
    replies,
    async $reply(content: unknown) { replies.push(content); return `reply-${replies.length}`; },
  };
}

export interface RunCommandOptions<TInput extends CommandMessage = FakeMessage> {
  readonly locale?: Locale;
  readonly formatCommand?: CommandContext['formatCommand'];
  readonly input?: TInput;
  readonly args?: readonly string[];
  readonly params?: Readonly<Record<string, CommandParameterValue>>;
  readonly options?: Readonly<Record<string, CommandParameterValue>>;
  readonly segments?: CommandContext['segments'];
  readonly interaction?: CommandContext['interaction'];
  /**
   * Where the command lives: its `commands/.../index.ts` file (or directory), as a path or a
   * `file:` URL such as `new URL('../commands/echo/[text]/index.ts', import.meta.url)`. When set,
   * the definition first goes through the Runtime's convention-path check (`bindCommandSource`
   * from `zhin.js/command`): a layout the Runtime would reject, e.g. `commands/term/[word]/[...rest]`,
   * throws here too, and the directory parameter is bound as in the Runtime.
   */
  readonly source?: string | URL;
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
    locale: options.locale ?? resolveLocale(input.locale),
    formatCommand: options.formatCommand ?? (() => undefined),
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
 * Pass `source` to apply the Runtime's convention-path check first.
 */
export async function runCommand<TConfig, TResult, TInput extends CommandMessage = FakeMessage>(
  fake: FakePlugin<TConfig>,
  definition: CommandDefinition<TConfig, TResult, TInput, string | undefined>,
  options?: RunCommandOptions<TInput>,
): Promise<TResult> {
  const command = options?.source === undefined ? definition : await bindSource(definition, options.source);
  return command.execute(createCommandContext(fake, options));
}

async function bindSource<T extends CommandDefinition<never, unknown, never, string | undefined>>(
  definition: T, source: string | URL,
): Promise<T> {
  const path = source instanceof URL || source.startsWith('file:') ? fileURLToPath(source) : source;
  // Loaded on demand, so an older zhin.js (unmet peer) only fails here, with an actionable message.
  const command: Partial<typeof import('zhin.js/command')> = await import('zhin.js/command');
  if (typeof command.bindCommandSource !== 'function') {
    throw new Error('runCommand({ source }) needs a newer zhin.js whose zhin.js/command exports bindCommandSource; upgrade zhin.js');
  }
  return command.bindCommandSource(definition as never, path).definition as unknown as T;
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

export interface RunToolOptions {
  readonly locale?: Locale;
  /**
   * Derive `origin` (`kind: 'im'`) and `principal` from an inbound message, so a tool sees the same
   * conversation the command tests use. Explicit `origin` / `principal` win.
   */
  readonly message?: CommandMessage;
  /** Default: `{ kind: 'im', platform: 'test', endpoint: 'test', scope: 'group', sceneId: 'test-group' }`. */
  readonly origin?: ToolInvocationOrigin;
  readonly principal?: ToolExecutionContext['principal'];
  /** Default: no permissions, attended, network disabled. */
  readonly policy?: Partial<ToolInvocationPolicy>;
  readonly question?: ToolQuestionPort;
  /** Native client port; required when the tool declares `adapter`. */
  readonly client?: OperationClientPort;
  readonly traceId?: string;
  readonly turnId?: string;
  readonly sessionKey?: string;
  readonly signal?: AbortSignal;
}

/**
 * Map an inbound message to the Agent tool origin shape (`platform` / `endpoint` / `scope` / `sceneId`),
 * with the same rules as the Agent's IM turn context (`clientAdapter` wins over the endpoint adapter).
 */
export function toolOriginFromMessage(message: CommandMessage): ToolInvocationOrigin {
  const { conversation } = message;
  return Object.freeze({
    kind: 'im' as const,
    platform: message.clientAdapter ?? conversation.endpoint.adapter,
    endpoint: conversation.endpoint.id,
    scope: conversation.kind,
    sceneId: conversation.id,
    ...(message.id === undefined ? {} : { messageId: message.id }),
    ...(conversation.threadId === undefined ? {} : { threadId: conversation.threadId }),
  });
}

/** Build the context an Agent tool's `execute()` receives, shaped like the real ToolIndex builds it. */
export function createToolContext<TConfig, TAdapter extends string | undefined = undefined>(
  fake: FakePlugin<TConfig>,
  options: RunToolOptions = {},
): ToolExecutionContext<TConfig, TAdapter> {
  const message = options.message;
  const sender = message?.sender;
  const policy = options.policy ?? {};
  const context = {
    ...fake.capabilityContext(),
    locale: options.locale ?? resolveLocale(message?.locale),
    signal: options.signal ?? fake.signal,
    traceId: options.traceId ?? 'test-trace',
    turnId: options.turnId ?? 'test-turn',
    sessionKey: options.sessionKey ?? (message
      ? `${message.conversation.endpoint.adapter}:${message.conversation.endpoint.id}:${message.conversation.kind}:${message.conversation.id}`
      : 'test-session'),
    origin: Object.freeze({ ...(options.origin ?? (message ? toolOriginFromMessage(message) : {
      kind: 'im', platform: 'test', endpoint: 'test', scope: 'group', sceneId: 'test-group',
    })) }) as ToolInvocationOrigin,
    principal: Object.freeze({ ...(options.principal ?? {
      subjectId: sender?.id ?? 'test-user',
      ...(sender?.name === undefined ? {} : { displayName: sender.name }),
      roles: sender?.roles ?? [],
    }) }),
    policy: Object.freeze({
      permissions: Object.freeze([...(policy.permissions ?? [])]),
      unattended: policy.unattended ?? false,
      network: Object.freeze({ enabled: false, ...policy.network }),
      ...(policy.shell ? { shell: Object.freeze({ ...policy.shell }) } : {}),
      ...(policy.filesystem ? { filesystem: Object.freeze({ ...policy.filesystem }) } : {}),
    }),
    ...(options.question ? { question: options.question } : {}),
  } as ToolExecutionContext<TConfig, TAdapter>;
  Object.defineProperty(context, '$client', { enumerable: true, get: () => options.client?.get() });
  return Object.freeze(context);
}

/**
 * Execute an Agent tool against the fake, the way the Runtime's tool index does: the input is parsed
 * by an executable `inputSchema` (e.g. Zod; JSON Schema inputs pass through unchanged, as in the
 * Runtime), an `adapter`-bound tool requires a matching `client`, then `execute()` runs.
 * It does NOT run model discovery, approval, permission or policy enforcement; use an Agent
 * integration test for those.
 *
 * `tool` is a definition (e.g. the default export of `tools/<name>/index.ts`) or the local name of a
 * tool registered through `addTool()` during `runPluginSetup`.
 */
export async function runTool<TResult = unknown, TConfig = unknown, TInput = unknown>(
  fake: FakePlugin<TConfig>,
  tool: AgentToolDefinition<TInput, TResult, TConfig, string | undefined> | string,
  input?: unknown,
  options: RunToolOptions = {},
): Promise<TResult> {
  const definition = typeof tool === 'string' ? registeredTool<TInput, TResult, TConfig>(fake, tool) : tool;
  const name = typeof tool === 'string' ? tool : 'tool';
  const parsed = parseToolInputSchema(definition.inputSchema, input ?? {});
  if (!parsed.ok) throw new TypeError(`Invalid Agent Tool input for ${name}: ${parsed.error}`);
  if (definition.adapter && options.client?.adapter !== definition.adapter) {
    throw new Error(`Agent Tool ${name} requires adapter ${definition.adapter}`);
  }
  return await definition.execute(parsed.data, createToolContext<TConfig, string | undefined>(fake, options));
}

function registeredTool<TInput, TResult, TConfig>(
  fake: FakePlugin<TConfig>, localName: string,
): AgentToolDefinition<TInput, TResult, TConfig, string | undefined> {
  const found = fake.features.find(feature => feature.kind === 'tool' && feature.localName === localName);
  if (!found) {
    const known = fake.features.filter(feature => feature.kind === 'tool').map(feature => feature.localName);
    throw new Error(`No tool "${localName}" was registered through addTool()${known.length ? `; registered: ${known.join(', ')}` : ''}`);
  }
  return found.definition as AgentToolDefinition<TInput, TResult, TConfig, string | undefined>;
}
