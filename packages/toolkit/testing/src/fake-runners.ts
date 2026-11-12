import { resolveLocale, type Locale } from 'zhin.js/i18n';
import type {
  CommandContext, CommandDefinition, CommandMessage, CommandParamSchema, CommandParameterValue, CommandSession,
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
import { readOperationSession, type OperationClientPort } from 'zhin.js';
import type { FakePlugin } from './fake-plugin.js';
import { fileURLToPath } from 'node:url';

export interface FakeSentDelivery {
  readonly target: {
    readonly kind: 'private' | 'group' | 'channel';
    readonly id: string;
    readonly parent?: { readonly kind: 'private' | 'group' | 'channel'; readonly id: string };
    readonly threadId?: string;
  };
  readonly content: unknown;
}

/** Inbound message with recorded replies and targeted sends. */
export interface FakeMessage extends CommandMessage {
  /** Everything passed to `$reply`, `$sendTo`, `$replyToPrivate`, `$replyToGroup`, or `$replyToChannel`, in order. */
  readonly replies: unknown[];
  /** Targeted sends invoked via `$sendTo`, `$replyToPrivate`, `$replyToGroup`, or `$replyToChannel`. */
  readonly sent: FakeSentDelivery[];
  $sendTo(
    conversation: FakeSentDelivery['target'],
    content: unknown,
  ): Promise<string>;
  $replyToPrivate(
    content: unknown,
    from?: boolean | { readonly kind: 'group' | 'channel'; readonly id: string },
  ): Promise<string>;
  $replyToGroup(groupIdOrContent: string | unknown, content?: unknown): Promise<string>;
  $replyToChannel(
    channelIdOrContent: string | unknown,
    guildId?: string,
    content?: unknown,
    threadId?: string,
  ): Promise<string>;
}

export interface FakeMessageInit {
  readonly locale?: Locale;
  readonly content?: string;
  /** `roles`: framework roles (master / trusted); `platform`: ADR 0056 §1 platform standing. */
  readonly sender?: CommandMessage['sender'];
  readonly conversation?: Partial<CommandMessage['conversation']>;
  readonly id?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly $client?: unknown;
}

export function createFakeMessage(init: FakeMessageInit = {}): FakeMessage {
  const replies: unknown[] = [];
  const sent: FakeSentDelivery[] = [];
  const conversation: CommandMessage['conversation'] = {
    endpoint: { id: 'test', adapter: 'test' }, kind: 'group', id: 'test-group', ...init.conversation,
  };
  const sender = init.sender ?? { id: 'test-user', name: 'Tester', roles: [] };
  const recordSend = (target: FakeSentDelivery['target'], content: unknown): string => {
    replies.push(content);
    sent.push({ target, content });
    return `reply-${replies.length}`;
  };
  return {
    conversation, content: init.content ?? '', locale: resolveLocale(init.locale),
    sender,
    ...(init.id === undefined ? {} : { id: init.id }),
    ...(init.metadata === undefined ? {} : { metadata: init.metadata }),
    ...(init.$client === undefined ? {} : { $client: init.$client }),
    replies,
    sent,
    async $reply(content: unknown) { replies.push(content); return `reply-${replies.length}`; },
    async $sendTo(target, content) {
      return recordSend(target, content);
    },
    async $replyToPrivate(content, from) {
      let parent: FakeSentDelivery['target']['parent'];
      if (from === true && (conversation.kind === 'group' || conversation.kind === 'channel')) {
        parent = { kind: conversation.kind, id: conversation.id };
      } else if (from != null && typeof from === 'object') {
        parent = from;
      }
      return recordSend({
        kind: 'private',
        id: sender.id,
        ...(parent ? { parent } : {}),
      }, content);
    },
    async $replyToGroup(groupIdOrContent: string | unknown, maybeContent?: unknown) {
      if (maybeContent === undefined) {
        return recordSend({ kind: 'group', id: conversation.id }, groupIdOrContent);
      }
      return recordSend({ kind: 'group', id: String(groupIdOrContent) }, maybeContent);
    },
    async $replyToChannel(
      channelIdOrContent: string | unknown,
      guildId?: string,
      content?: unknown,
      threadId?: string,
    ) {
      if (guildId === undefined && content === undefined) {
        return recordSend({ kind: 'channel', id: conversation.id }, channelIdOrContent);
      }
      return recordSend({
        kind: 'channel',
        id: String(channelIdOrContent),
        ...(guildId ? { parent: { kind: 'channel', id: guildId } } : {}),
        ...(threadId ? { threadId } : {}),
      }, content);
    },
  };
}

export type FakeInteraction = NonNullable<CommandContext['interaction']> & {
  /** Every interaction request presented via `ask`, `sequence`, `confirm`, or `select`, in order. */
  readonly prompts: Parameters<NonNullable<CommandContext['interaction']>['ask']>[0][];
  /** Append additional scripted answers to the queue. */
  enqueue(...answers: unknown[]): void;
  /** Convenience helper for confirm requests. */
  confirm(title: string, defaultValue?: boolean): Promise<boolean>;
  /** Convenience helper for select requests. */
  select<V = string>(
    title: string,
    options: readonly (V | { readonly label: string; readonly value: V })[],
  ): Promise<V>;
};

export interface FakeInteractionOptions {
  readonly answers?: readonly unknown[];
}

/**
 * Create a scripted `UserInteraction` double for unit-testing commands and handlers that use
 * `interaction.ask()`, `interaction.sequence()`, `interaction.confirm()`, or `interaction.select()`.
 */
export function createFakeInteraction(
  init: readonly unknown[] | FakeInteractionOptions = [],
): FakeInteraction {
  type Interaction = NonNullable<CommandContext['interaction']>;
  type Request = Parameters<Interaction['ask']>[0];
  const queue: unknown[] = Array.isArray(init)
    ? [...init]
    : [...(init as FakeInteractionOptions).answers ?? []];
  const prompts: Request[] = [];

  const ask: Interaction['ask'] = (async (request: Request) => {
    prompts.push(request);
    if (queue.length > 0) {
      const next = queue.shift();
      return typeof next === 'function' ? await (next as (r: Request) => unknown)(request) : next;
    }
    if ('default' in request && request.default !== undefined) {
      return request.default;
    }
    throw new Error(`No scripted answer remaining for interaction prompt: ${request.title}`);
  }) as Interaction['ask'];

  const sequence: Interaction['sequence'] = (async (seq) => {
    const acc: Record<string, unknown> = {};
    for (const step of seq.steps) {
      acc[step.id] = await ask(step);
    }
    return Object.freeze({ ...acc });
  }) as Interaction['sequence'];

  return {
    prompts,
    enqueue(...answers: unknown[]) {
      queue.push(...answers);
    },
    ask,
    sequence,
    confirm(title: string, defaultValue?: boolean): Promise<boolean> {
      return ask({
        type: 'confirm',
        title,
        ...(defaultValue === undefined ? {} : { default: defaultValue }),
      });
    },
    select<V = string>(
      title: string,
      options: readonly (V | { readonly label: string; readonly value: V })[],
    ): Promise<V> {
      const normalized = options.map((opt) =>
        opt !== null && typeof opt === 'object' && 'value' in opt && 'label' in opt
          ? opt
          : { label: String(opt), value: opt as V },
      );
      return ask({
        type: 'select',
        title,
        options: normalized,
      }) as Promise<V>;
    },
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
    get session() { return readOperationSession(input); },
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
  const resolvedOptions = populateCommandOptionsFromDefinition(command, options);
  return command.execute(createCommandContext(fake, resolvedOptions));
}

function populateCommandOptionsFromDefinition<TConfig, TResult, TInput extends CommandMessage>(
  command: CommandDefinition<TConfig, TResult, TInput, string | undefined>,
  options?: RunCommandOptions<TInput>,
): RunCommandOptions<TInput> | undefined {
  if (!command.params && !command.options) return options;
  const args = options?.args ?? [];
  const input = (options?.input ?? createFakeMessage()) as TInput;
  const session: CommandSession = {
    adapter: input.conversation.endpoint.adapter,
    endpoint: input.conversation.endpoint.id,
    scene: input.scene ?? { id: input.conversation.id, type: input.conversation.kind },
    ...(input.sender ? { sender: { id: input.sender.id, name: input.sender.name, role: input.sender.roles ?? [] } } : {}),
  };
  const resolveDefault = (def: CommandParamSchema['default']): CommandParameterValue | undefined => {
    if (def === undefined) return undefined;
    return typeof def === 'function' ? def(session) : def;
  };
  const inferredParams: Record<string, CommandParameterValue> = {};
  if (command.params) {
    const entries = Object.entries(command.params);
    for (let i = 0; i < entries.length; i++) {
      const [name, schema] = entries[i]!;
      if (schema.rest) {
        const rest = args.slice(i);
        if (rest.length > 0) {
          inferredParams[name] = rest.map((token) => coerceCommandScalar(token, schema));
        } else {
          const def = resolveDefault(schema.default);
          if (def !== undefined) inferredParams[name] = def;
        }
        break;
      }
      const raw = args[i];
      if (raw !== undefined) {
        inferredParams[name] = coerceCommandScalar(raw, schema);
      } else {
        const def = resolveDefault(schema.default);
        if (def !== undefined) inferredParams[name] = def;
      }
    }
  }
  const inferredOptions: Record<string, CommandParameterValue> = {};
  if (command.options) {
    for (const [name, opt] of Object.entries(command.options)) {
      const def = resolveDefault(opt.default);
      if (def !== undefined) {
        inferredOptions[name] = def;
      }
    }
  }
  return {
    ...options,
    params: { ...inferredParams, ...(options?.params ?? {}) },
    options: { ...inferredOptions, ...(options?.options ?? {}) },
  };
}

function coerceCommandScalar(raw: string, schema: CommandParamSchema): string | number | boolean {
  if (schema.type === 'number' || schema.type === 'integer' || schema.type === 'float' || schema.type === 'dice' || schema.type === 'rps') {
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? raw : parsed;
  }
  if (schema.type === 'boolean') {
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
  }
  return raw;
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
    get session() { return readOperationSession(input); },
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
  const context: HandlerContext<TConfig> = {
    ...fake.capabilityContext(),
    get session() { return readOperationSession(args[0]); },
  };
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
