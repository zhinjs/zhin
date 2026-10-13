import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { defineAdapter, type AdapterDefinition, type AdapterSegmentPolicy,
  type EndpointIdentity, type EndpointEventSink, type EndpointIncomingMessage, type EndpointSendRequest } from '@zhin.js/adapter';
import { ImRuntime, type ConversationAddress, type MessageDispatchResult,
  type SendContent } from '@zhin.js/core/runtime';
import { type ConversationRef, type DeliveryReceipt } from '@zhin.js/im-contract';
import { rootPluginId, type ConfigPatch, type PluginId, type RuntimeConfigDocument } from '@zhin.js/plugin-runtime';
import { NativeDevelopmentModuleRuntime, NodePackageResolver, RootRuntime,
  type ModuleRuntime, type RootResourceInstaller } from '@zhin.js/runtime';
import { withTestEndpoints } from './test-module-runtime.js';

export interface PluginTestKitOptions {
  /** A real, disposable test app with its own package.json, plugin entry, dependencies and mounts. */
  readonly projectRoot: string;
  readonly config?: RuntimeConfigDocument;
  /** Adapter names reserved for synthetic transports, default: ['test']. */
  readonly endpoints?: readonly string[];
  /** Default endpoint renders HTML and buttons as text; override to verify negotiated capabilities. */
  readonly segments?: AdapterSegmentPolicy;
  readonly commandPrefix?: string;
  /** Supply your test runner's module adapter if it owns ESM loading. Native Node is the default. */
  readonly modules?: ModuleRuntime;
  readonly installResources?: RootResourceInstaller;
}

/** A terminal send attempt, after the real renderer, policy negotiation and outbound middleware. */
export interface TestDelivery {
  readonly endpoint: string;
  readonly conversation: ConversationRef;
  readonly payload: unknown;
  readonly id: string;
}

export type TestReceiveInput = EndpointIncomingMessage & { readonly endpoint?: string };

export type TestReloadResult =
  | Readonly<{ status: 'reloaded' | 'unchanged'; generation: number }>
  | Readonly<{ status: 'failed'; generation: number; error: unknown }>
  | Readonly<{ status: 'restart-required'; generation: number; reasons: readonly string[] }>;

/**
 * Owns a test IM host and synthetic transports. Every operation enters the real Root Runtime.
 * It does not install dependencies or replace providers. Discovered plugins still execute normally;
 * use disposable applications without real credentials or adapters. This is not a sandbox.
 */
export class PluginTestKit {
  readonly #im: ImRuntime;
  readonly #root: RootRuntime;
  readonly #sinks = new Map<string, EndpointEventSink>();
  readonly #identities = new Map<string, EndpointIdentity>();
  #nextDelivery = 1;
  readonly #attempts: TestDelivery[] = [];
  readonly #defaultEndpoint: string;
  readonly #hmr: ReturnType<RootRuntime['createHmrCoordinator']>;
  #restartReasons?: readonly string[];
  #started = false;
  #closed = false;
  #startResult?: Promise<number>;
  #closeResult?: Promise<void>;

  private constructor(options: PluginTestKitOptions, projectRoot: string, rootEntry: string) {
    this.#im = new ImRuntime({ commandPrefix: options.commandPrefix });
    const names = options.endpoints ?? ['test'];
    if (!names.length || new Set(names).size !== names.length
      || names.some(name => !/^[a-z][a-z0-9-]*$/.test(name))) {
      throw new TypeError('Test endpoints must have unique lowercase names');
    }
    this.#defaultEndpoint = names[0]!;
    const definitions = new Map<string, AdapterDefinition>(names.map(name => [name, defineAdapter({
      capabilities: ['inbound', 'outbound'],
      segments: options.segments ?? { html: 'text', interactive: 'text', markdown: 'text' },
      create: () => ({
        client: Object.freeze({ synthetic: true }),
        connect: ({ events, identity }) => {
          this.#identities.set(name, identity);
          this.#sinks.set(name, events);
          return () => { if (this.#sinks.get(name) === events) { this.#sinks.delete(name); this.#identities.delete(name); } };
        },
        send: (request: EndpointSendRequest) => {
          const id = `test-${this.#nextDelivery++}`;
          this.#attempts.push(Object.freeze({ endpoint: name, id,
            conversation: freezeValue(structuredClone(request.conversation)),
            payload: freezeValue(structuredClone(request.payload)),
          }));
          return id;
        },
      }),
    })]));
    const modules = options.modules ?? new NativeDevelopmentModuleRuntime({ projectRoot, watch: false });
    this.#root = new RootRuntime({ projectRoot,
      modules: withTestEndpoints(modules, rootEntry, definitions),
      environment: { name: 'test', mode: 'test', platform: 'node' },
      config: options.config,
      installResources: async context => {
        this.#im.install(context.resources);
        await options.installResources?.(context);
      },
    });
    this.#im.attach(this.#root.snapshots);
    this.#hmr = this.#root.createHmrCoordinator({
      onRestartRequired: plan => { this.#restartReasons = plan.reasons; },
      onError: () => undefined,
    });
  }

  static async create(options: PluginTestKitOptions): Promise<PluginTestKit> {
    const projectRoot = await realpath(resolve(options.projectRoot));
    const resolver = await NodePackageResolver.create(projectRoot);
    const root = await resolver.root(projectRoot);
    if (root.packageJson.zhin.type !== 'plugin' || root.packageJson.zhin.runtime === 'isolated') {
      throw new TypeError('Test application must be a trusted Plugin root');
    }
    return new PluginTestKit(options, projectRoot, resolve(projectRoot, root.packageJson.zhin.entry));
  }

  /** The same PermissionHost consumed by real command admission. */
  get permissions(): ImRuntime['permissionHost'] { return this.#im.permissionHost; }
  get generation(): number { return this.#root.snapshot.generation; }
  get deliveries(): readonly TestDelivery[] { return Object.freeze(this.#attempts.map(item => freezeValue(structuredClone(item)))); }
  clearDeliveries(): void { this.#attempts.splice(0); }

  start(): Promise<number> {
    if (this.#closed) return Promise.reject(new Error('Plugin test kit is closed'));
    if (this.#startResult) return this.#startResult;
    this.#startResult = this.#root.start().then(snapshot => {
      this.#started = true;
      return snapshot.generation;
    });
    return this.#startResult;
  }

  async receive(input: TestReceiveInput): Promise<MessageDispatchResult | undefined> {
    this.#assertStarted();
    const { endpoint, ...message } = input;
    return await this.#sink(endpoint).message(message) as MessageDispatchResult | undefined;
  }

  async emit(name: string, payload: unknown, endpoint?: string): Promise<unknown> {
    this.#assertStarted();
    return this.#sink(endpoint).emit(name, payload);
  }

  async send(input: { readonly conversation: ConversationAddress; readonly content: SendContent;
    readonly requester?: PluginId; readonly endpoint?: string }): Promise<DeliveryReceipt> {
    this.#assertStarted();
    const name = input.endpoint ?? this.#defaultEndpoint;
    this.#sink(name);
    const identity = this.#identities.get(name)!;
    return this.#im.send({ conversation: { ...input.conversation, endpoint: {
      id: String(identity.id), adapter: identity.adapter,
    } }, content: input.content, requester: input.requester ?? rootPluginId() });
  }

  /** Call after editing a file in your test app; returns the real HMR transaction outcome. */
  async reloadSource(source: string): Promise<TestReloadResult> {
    this.#assertStarted();
    const previous = this.generation;
    this.#restartReasons = undefined;
    try {
      await this.#hmr.enqueue(source);
      if (this.#restartReasons) return Object.freeze({ status: 'restart-required',
        generation: this.generation, reasons: Object.freeze([...this.#restartReasons]) });
      return Object.freeze({ status: this.generation === previous ? 'unchanged' : 'reloaded', generation: this.generation });
    } catch (error) {
      return Object.freeze({ status: 'failed', generation: this.generation, error });
    }
  }

  async patchConfig(patches: readonly ConfigPatch[]): Promise<number> {
    this.#assertStarted();
    return (await this.#root.patchConfig(patches)).generation;
  }

  close(): Promise<void> {
    if (this.#closeResult) return this.#closeResult;
    this.#closed = true;
    this.#closeResult = (async () => {
      try { await this.#hmr.stop(); }
      finally { await this.#root.stop(); }
    })();
    return this.#closeResult;
  }

  #assertStarted(): void {
    if (this.#closed || !this.#started) throw new Error('Plugin test kit is not running');
  }
  #sink(endpoint = this.#defaultEndpoint): EndpointEventSink {
    const sink = this.#sinks.get(endpoint);
    if (!sink) throw new Error(`Unknown test endpoint: ${endpoint}`);
    return sink;
  }
}

function freezeValue<T>(value: T): T {
  if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
    for (const child of Object.values(value)) freezeValue(child);
    Object.freeze(value);
  }
  return value;
}
