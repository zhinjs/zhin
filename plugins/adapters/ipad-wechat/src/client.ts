/**
 * IpadWechatClient — owns one `@wchats/ipad` SDK client: login → online run,
 * inbound delivery admission, outbound sends and contact queries.
 *
 * SDK contracts this class keeps (see the SDK's PUBLIC_API.md):
 * - `run()` is the single long-lived owner (login/restore → NewInit → online);
 *   `stop()` + awaiting `run()` before `close()`; `logout()` is never called.
 * - A `message` listener's promise is the ACK: it resolves only after Zhin
 *   admitted the message; while input is closed it waits instead of failing,
 *   and on stop it rejects so the SDK keeps the delivery for the next run.
 * - Every send uses a fresh `operationId` and is acknowledged only after a
 *   terminal result; an unknown result is reported as `unknown`, never resent.
 */
import { EventEmitter } from 'node:events';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CapabilityId } from 'zhin.js';
import {
  createEndpointOperation,
  type EndpointFriend,
  type EndpointGroup,
  type EndpointGroupRequest,
  type EndpointManagement,
  type EndpointManagementRequest,
  type EndpointSendRequest,
  type EndpointSendResult,
  type EndpointTransportState,
} from 'zhin.js/adapter';
import { EndpointDeliveryError, type MediaRef } from '@zhin.js/im-contract';
import type { LoginAssist, LoginAssistEndpointIdentity } from '@zhin.js/core';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import {
  loadIpadSdk,
  type BusinessDelivery,
  type ContactDirectoryResult,
  type InitResult,
  type IpadClient,
  type IpadSdk,
  type LoginStep,
  type LongLinkDelivery,
  type MessageContext,
  type RunResult,
} from './sdk.js';
import { loginErrorCode, IpadWechatLoginReporter } from './login.js';
import {
  ADAPTER_KEY,
  isGroupId,
  planOutbound,
  projectInbound,
  type ResolvedIpadWechatConfig,
} from './protocol.js';

const INBOUND_MEDIA_TTL_MS = 24 * 60 * 60 * 1000;
const DIRECTORY_CACHE_MS = 10 * 60 * 1000;

export interface IpadWechatEndpointOptions {
  readonly id: CapabilityId;
  readonly config: ResolvedIpadWechatConfig;
  /** Test / embedding: the SDK module (default: dynamic import of `@wchats/ipad`). */
  readonly sdk?: IpadSdk | (() => Promise<IpadSdk>);
  readonly loginAssist?: LoginAssist;
  readonly endpointIdentity?: LoginAssistEndpointIdentity;
  readonly signal?: AbortSignal;
}

/** The finite login ended without an online session (verification, rejection, risk …). */
export class IpadWechatLoginError extends Error {
  constructor(readonly status: string, message: string) {
    super(message);
    this.name = 'IpadWechatLoginError';
  }
}

type Deferred = { promise: Promise<void>; resolve(): void; reject(error: unknown): void; settled: boolean };
function deferred(): Deferred {
  let resolve!: () => void; let reject!: (error: unknown) => void;
  const state: Deferred = {
    promise: new Promise<void>((ok, fail) => { resolve = ok; reject = fail; }),
    resolve: () => { if (!state.settled) { state.settled = true; resolve(); } },
    reject: (error) => { if (!state.settled) { state.settled = true; reject(error); } },
    settled: false,
  };
  state.promise.catch(() => undefined);
  return state;
}

function describe(error: unknown): string {
  if (error instanceof Error) return (error as { code?: string }).code ?? error.message;
  return String(error);
}

export class IpadWechatClient extends EventEmitter {
  readonly #options: IpadWechatEndpointOptions;
  readonly #logger: ReturnType<typeof getAdapterLogger>;
  readonly #login: IpadWechatLoginReporter;
  #sdk?: IpadSdk;
  #client?: IpadClient;
  #run?: Promise<void>;
  #runAbort?: AbortController;
  #ready?: Deferred;
  #state: EndpointTransportState = 'idle';
  #open = false;
  #openWaiters: Array<() => void> = [];
  #stopping = false;
  #disconnecting?: Promise<void>;
  #detach: Array<() => void> = [];
  #directory?: { at: number; result: Promise<ContactDirectoryResult> };

  protected readonly endpointManagement: EndpointManagement = createIpadWechatManagement(() => this);

  constructor(options: IpadWechatEndpointOptions) {
    super();
    this.#options = options;
    this.#logger = getAdapterLogger(ADAPTER_KEY, options.config.id);
    this.#login = new IpadWechatLoginReporter({
      endpointKey: options.config.id,
      ...(options.loginAssist ? { assist: options.loginAssist } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.endpointIdentity ? { endpointIdentity: options.endpointIdentity } : {}),
    });
  }

  /** #1250: downloaded inbound images live only under `<dataDir>/media/inbound`; the Agent reads nothing else. */
  protected readonly endpointInboundMedia: import('zhin.js/adapter').EndpointInboundMediaPort = Object.freeze({
    roots: () => [path.join(this.#options.config.dataDir, 'media', 'inbound')],
  });

  protected configName(): string { return this.#options.config.id; }
  get transportState(): EndpointTransportState { return this.#state; }
  /** Logged-in wxid, once known. */
  get account(): string | null { return this.#client?.account ?? null; }
  /** The underlying SDK client (for plugins that need SDK-only features). */
  get sdkClient(): IpadClient | undefined { return this.#client; }

  // Framework hooks overridden by the Endpoint (kept protocol-only here).
  protected receiveInboundCallback<T>(receive: () => T | Promise<T>): Promise<T> {
    try { return Promise.resolve(receive()); } catch (error) { return Promise.reject(error); }
  }
  protected publishAccepted(name: string, payload: unknown): Promise<unknown> { this.emit(name, payload); return Promise.resolve(); }
  protected publishPlatform(name: string, event: unknown): Promise<unknown> { this.emit(name, event); return Promise.resolve(); }
  protected inboundConversation(conversation: Readonly<{ kind: 'private' | 'group'; id: string }>): unknown { return conversation; }
  protected reportSelf(_account: string | null): void {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  protected async connectTransport(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.#run) return this.#ready?.promise;
    this.#state = 'connecting';
    this.#stopping = false;
    this.#disconnecting = undefined;
    const { config } = this.#options;
    try {
      this.#sdk = await this.#loadSdk();
      await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
      signal?.throwIfAborted();
      this.#client = await this.#sdk.createClient({ dataDir: config.dataDir, signConfig: { mode: 'local' } });
      this.#attach(this.#client);
      void this.#sweepInboundMedia();
      this.#login.connecting();
      this.#runAbort = new AbortController();
      this.#ready = deferred();
      this.#run = this.#runLoop(this.#client, this.#runAbort.signal);
      const abort = () => this.#ready?.reject(signal?.reason);
      signal?.addEventListener('abort', abort, { once: true });
      try { await this.#ready.promise; } finally { signal?.removeEventListener('abort', abort); }
      this.#logger.info(formatCompact({ op: 'connect', endpoint: config.id, account: this.account ?? 'unknown' }));
    } catch (error) {
      await this.disconnectTransport();
      this.#logger.error(formatCompact({ op: 'connect', ok: false, error: describe(error) }));
      throw error;
    }
  }

  async #loadSdk(): Promise<IpadSdk> {
    const source = this.#options.sdk;
    if (!source) return loadIpadSdk();
    return typeof source === 'function' ? source() : source;
  }

  #attach(client: IpadClient): void {
    const on = <A extends unknown[]>(event: string, listener: (...args: A) => unknown) => {
      (client.on as (event: string, listener: (...args: A) => unknown) => unknown)(event, listener);
      this.#detach.push(() => (client.off as (event: string, listener: (...args: A) => unknown) => unknown)(event, listener));
    };
    on('message', (message: MessageContext) => this.#onMessage(message));
    on('online.ready', () => {
      this.#state = 'open';
      this.reportSelf(client.account);
      this.#login.online();
      this.#ready?.resolve();
      void this.#platform('system.online', { account: client.account });
    });
    on('online.reconnecting', (value: { attempt: number; error: string }) => {
      this.#state = 'reconnecting';
      this.#logger.warn(formatCompact({ op: 'reconnecting', attempt: value.attempt, error: value.error }));
    });
    on('online.stopped', () => { if (!this.#stopping) this.#state = 'closed'; });
    on('session.blocked', (block: unknown) => {
      this.#logger.warn(formatCompact({ op: 'session_blocked' }));
      void this.#platform('session.blocked', block);
    });
    // EventEmitter throws on an unhandled 'error'; keep it in the log.
    on('error', (error: Error) => this.#logger.error(formatCompact({ op: 'sdk_error', error: describe(error) })));
  }

  async #runLoop(client: IpadClient, signal: AbortSignal): Promise<void> {
    const { config } = this.#options;
    try {
      for (;;) {
        const result: RunResult = await client.run({
          signal,
          timeoutMillis: config.loginTimeoutMs,
          pollIntervalMillis: config.qrPollIntervalMs,
          reconnect: config.reconnect,
          ...(config.heartbeatIntervalSeconds ? { heartbeatIntervalSeconds: config.heartbeatIntervalSeconds } : {}),
          onLoginStep: step => this.#onLoginStep(step),
          onInitPage: page => this.#onInitPage(page),
          onDelivery: delivery => this.#onDelivery(delivery),
          onLongLinkEvent: delivery => this.#onLongLinkEvent(delivery),
        });
        if (this.#stopping) return;
        if (result.status === 'login_incomplete') {
          const status = result.login.status;
          if (status === 'verification_required' && await this.#verify(client, signal)) continue;
          throw new IpadWechatLoginError(status, loginFailureMessage(status));
        }
        throw new Error('ipad-wechat: the SDK run ended without a stop request');
      }
    } catch (error) {
      if (this.#stopping) return;
      this.#state = 'closed';
      this.#login.fail(error instanceof IpadWechatLoginError ? loginErrorCode(error.status) : 'network', describe(error));
      this.#logger.error(formatCompact({ op: 'run', ok: false, error: describe(error) }));
      this.#ready?.reject(error);
      void this.#platform('system.offline', { account: client.account, error: describe(error) });
    }
  }

  /** Open the SDK device-verification page and wait for the person; true when login can continue. */
  async #verify(client: IpadClient, signal: AbortSignal): Promise<boolean> {
    const verification = this.#options.config.verification;
    const create = this.#sdk?.createVerificationServer;
    if (!verification || !create) return false;
    const [key, cert] = await Promise.all([readFile(verification.key), readFile(verification.cert)]);
    const server = await create({
      client, tls: { key, cert }, host: verification.host, port: verification.port,
      ...(verification.publicOrigin ? { publicOrigin: verification.publicOrigin } : {}),
      onInitPage: page => this.#onInitPage(page),
    });
    // The URL is a per-challenge secret: Console + a 0600 file, never the log.
    const urlFile = path.join(this.#options.config.dataDir, 'verification-url.txt');
    await writeFile(urlFile, `${server.url}\n`, { mode: 0o600 });
    this.#login.verification(server.url);
    this.#logger.warn(formatCompact({ op: 'verification_required', page: server.origin, urlFile }));
    const timeout = setTimeout(() => void server.close(), verification.timeoutMs);
    const abort = () => void server.close();
    signal.addEventListener('abort', abort, { once: true });
    try {
      const outcome = await server.completion;
      return outcome === 'initialized' && !signal.aborted;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      await server.close().catch(() => undefined);
      await rm(urlFile, { force: true });
    }
  }

  protected openInput(): void {
    this.#open = true;
    for (const resume of this.#openWaiters.splice(0)) resume();
  }

  protected closeInput(): void { this.#open = false; }

  #waitForOpen(): Promise<void> {
    if (this.#stopping) return Promise.reject(new Error('ipad-wechat endpoint stopping'));
    if (this.#open) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.#openWaiters.push(() => this.#stopping ? reject(new Error('ipad-wechat endpoint stopping')) : resolve());
    });
  }

  protected disconnectTransport(): Promise<void> { return this.#disconnecting ??= this.#disconnect(); }

  async #disconnect(): Promise<void> {
    this.#stopping = true;
    this.#open = false;
    for (const wake of this.#openWaiters.splice(0)) wake();
    this.#ready?.reject(new Error('ipad-wechat endpoint stopped'));
    const client = this.#client;
    this.#runAbort?.abort();
    try { client?.stop(); } catch { /* not running */ }
    await this.#run?.catch(() => undefined);
    for (const detach of this.#detach.splice(0)) detach();
    try { await client?.close(); }
    catch (error) { this.#logger.warn(formatCompact({ op: 'close', ok: false, error: describe(error) })); }
    this.#login.dispose();
    this.#client = undefined;
    this.#run = undefined;
    this.#directory = undefined;
    this.#state = 'stopped';
    if (client) void this.#platform('system.offline', { account: client.account });
  }

  // -------------------------------------------------------------------------
  // SDK consumers
  // -------------------------------------------------------------------------

  async #onLoginStep(step: LoginStep): Promise<void> {
    const output = step.output as { kind: string; accepted?: boolean; image?: number[] | null; phase?: string };
    if (output.kind === 'qr_code' && output.accepted && output.image) {
      const png = Uint8Array.from(output.image);
      const file = path.join(this.#options.config.dataDir, 'login-qrcode.png');
      await writeFile(file, png, { mode: 0o600 });
      this.#login.qrCode(png);
      this.#logger.info(formatCompact({ op: 'login_qrcode', file }));
    } else if (output.kind === 'qr_status' && output.phase) {
      this.#login.qrStatus(output.phase);
      this.#logger.info(formatCompact({ op: 'login_qr_status', phase: output.phase }));
    }
  }

  /** NewInit pages are handed to plugins as a platform event, then ACKed. */
  async #onInitPage(page: InitResult): Promise<void> {
    await this.#platform('init.page', page);
  }

  /** Non-message sync deliveries: forward, then ACK (an unconsumed one would stop the run). */
  async #onDelivery(delivery: BusinessDelivery): Promise<void> {
    await this.#platform(delivery.kind, delivery);
  }

  async #onLongLinkEvent(delivery: LongLinkDelivery): Promise<void> {
    await this.#platform(`longlink.${delivery.event.kind}`, delivery);
    // As in the SDK's online example: a link error ends this run instead of being ACKed silently.
    if (delivery.event.kind === 'error') throw new Error(`ipad-wechat long link error ${delivery.event.code}`);
  }

  async #platform(name: string, event: unknown): Promise<void> {
    await this.publishPlatform(name, event).catch((error) => {
      this.#logger.debug(formatCompact({ op: 'platform_event', event: name, ok: false, error: describe(error) }));
    });
  }

  async #onMessage(message: MessageContext): Promise<void> {
    if (this.#options.config.ignoreSelfMessages && message.direction === 'outgoing') return;
    for (;;) {
      await this.#waitForOpen();
      try {
        await this.receiveInboundCallback(() => this.#admit(message));
        return;
      } catch (error) {
        // Closed between the wait and admission: wait for the next open. Anything else keeps the
        // SDK delivery unacknowledged (it is redelivered on the next run).
        if (this.#stopping || this.#open) throw error;
      }
    }
  }

  async #admit(message: MessageContext): Promise<void> {
    const imagePath = message.kind === 'image' && message.mediaHandle && this.#options.config.downloadImages
      ? await this.#downloadImage(message.id, message.mediaHandle)
      : undefined;
    const projection = projectInbound(message, imagePath ? { imagePath } : {});
    const conversation = this.inboundConversation(projection.conversation);
    await this.publishAccepted('message.receive', {
      event: message,
      conversation,
      message: { conversation, id: message.id },
      content: projection.content,
      segments: projection.segments,
      sender: { id: projection.senderId },
      endpointId: this.#options.config.id,
      metadata: Object.freeze({ kind: message.kind, direction: message.direction }),
    });
  }

  async #downloadImage(messageId: string, handle: string): Promise<string | undefined> {
    const client = this.#client;
    if (!client) return undefined;
    const dir = path.join(this.#options.config.dataDir, 'media', 'inbound');
    const name = createHash('sha256').update(messageId).digest('hex').slice(0, 32);
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const result = await client.downloadImageToFile(handle, path.join(dir, `${name}.jpg`), {
        operationId: `zhin-image-${name}`,
        ...(this.#runAbort ? { signal: this.#runAbort.signal } : {}),
      });
      return result.file;
    } catch (error) {
      this.#logger.warn(formatCompact({ op: 'image_download', ok: false, error: describe(error) }));
      return undefined;
    }
  }

  async #sweepInboundMedia(): Promise<void> {
    const dir = path.join(this.#options.config.dataDir, 'media', 'inbound');
    const now = Date.now();
    const entries = await readdir(dir).catch(() => [] as string[]);
    await Promise.all(entries.map(async (entry) => {
      const file = path.join(dir, entry);
      const info = await stat(file).catch(() => undefined);
      if (info?.isFile() && now - info.mtimeMs > INBOUND_MEDIA_TTL_MS) await rm(file, { force: true });
    }));
  }

  // -------------------------------------------------------------------------
  // Outbound
  // -------------------------------------------------------------------------

  #online(): IpadClient {
    const client = this.#client;
    if (!client || this.#stopping || this.#state === 'idle' || this.#state === 'connecting') {
      throw new EndpointDeliveryError('not_online', 'ipad-wechat account is not online', 'not_sent');
    }
    return client;
  }

  protected async sendPayload({ conversation, payload, signal }: EndpointSendRequest): Promise<EndpointSendResult> {
    const client = this.#online();
    const target = conversation.id;
    const parts = planOutbound(payload, isGroupId(target));
    if (!parts.length) throw new EndpointDeliveryError('empty', 'ipad-wechat: nothing to send', 'not_sent');
    const operation = createEndpointOperation({ ...(signal ? { signal } : {}) });
    const sent: { messageId: string }[] = [];
    for (const part of parts) {
      try {
        if (part.kind === 'text') {
          sent.push({ messageId: await operation.run(() => this.#sendText(client, target, part.text, part.at)) });
        } else {
          const source = await operation.prepare(() => mediaSource(part.media, signal));
          sent.push({ messageId: await operation.run(() => this.#sendImage(client, target, source, signal)) });
        }
      } catch (error) {
        if (error instanceof EndpointDeliveryError && !sent.length) throw error;
        const disposition = error instanceof EndpointDeliveryError ? error.disposition : 'unknown';
        throw new EndpointDeliveryError('partial', `ipad-wechat: ${describe(error)}`, disposition, { cause: error, parts: sent });
      }
    }
    return sent.length === 1 ? sent[0]!.messageId : { parts: sent };
  }

  async #sendText(client: IpadClient, target: string, text: string, at: readonly string[]): Promise<string> {
    const operationId = `zhin-text-${randomUUID()}`;
    let result;
    try {
      result = await client.sendText(target, text, at.length ? { operationId, at: [...at] } : { operationId });
    } catch (error) {
      // No terminal result: the SDK journal keeps the action; never resend under a new ID.
      throw new EndpointDeliveryError('send_unknown', `ipad-wechat text send outcome unknown: ${describe(error)}`, 'unknown', { cause: error });
    }
    await this.#acknowledge(() => client.acknowledgeAction(operationId));
    if (result.return_code !== 0) {
      throw new EndpointDeliveryError('rejected', `ipad-wechat text rejected (return_code ${result.return_code})`, 'rejected');
    }
    const receipt = result.output.receipt;
    return String(receipt?.new_message_id ?? receipt?.message_id ?? receipt?.client_message_id ?? operationId);
  }

  async #sendImage(client: IpadClient, target: string, source: Uint8Array | string, signal?: AbortSignal): Promise<string> {
    const operationId = `zhin-image-${randomUUID()}`;
    let result;
    try {
      result = await client.sendImage(target, source, { operationId, ...(signal ? { signal } : {}) });
    } catch (error) {
      throw new EndpointDeliveryError('send_unknown', `ipad-wechat image send outcome unknown: ${describe(error)}`, 'unknown', { cause: error });
    }
    await this.#acknowledge(() => client.acknowledgeImageSend(operationId));
    if (result.status !== 'sent') throw new EndpointDeliveryError('rejected', 'ipad-wechat image rejected', 'rejected');
    const receipt = result.result.output.receipt;
    return String(receipt?.new_message_id ?? receipt?.message_id ?? operationId);
  }

  async #acknowledge(acknowledge: () => Promise<void>): Promise<void> {
    try { await acknowledge(); }
    catch (error) { this.#logger.warn(formatCompact({ op: 'acknowledge', ok: false, error: describe(error) })); }
  }

  // -------------------------------------------------------------------------
  // Directory
  // -------------------------------------------------------------------------

  /** Whole contact directory, cached for 10 minutes (the SDK scan is long and rate limited). */
  contactDirectory(): Promise<ContactDirectoryResult> {
    const client = this.#online();
    const cached = this.#directory;
    if (cached && Date.now() - cached.at < DIRECTORY_CACHE_MS) return cached.result;
    const result = client.getContactDirectory({ fresh: true })
      // A previous scan is still pending or unknown: continue it instead of starting another.
      .catch(() => client.getContactDirectory());
    this.#directory = { at: Date.now(), result };
    result.catch(() => { if (this.#directory?.result === result) this.#directory = undefined; });
    return result;
  }

  async groupMembers(groupId: string): Promise<readonly unknown[]> {
    const result = await this.#online().getGroupMembers(groupId);
    if (result.return_code !== 0 || !result.data) {
      throw new Error(`ipad-wechat group member query failed (return_code ${result.return_code})`);
    }
    return Object.freeze((result.data.members ?? []).filter(member => member.id).map(member => Object.freeze({
      user_id: member.id!,
      nickname: member.nickname ?? member.id!,
      card: member.displayName ?? '',
      ...(member.inviter ? { inviter: member.inviter } : {}),
    })));
  }
}

function loginFailureMessage(status: string): string {
  switch (status) {
    case 'verification_required':
      return 'ipad-wechat: WeChat requires device verification; configure `verification` (TLS key/cert) or finish it with the SDK login example in the same dataDir';
    case 'risk': return 'ipad-wechat: login blocked by WeChat risk control';
    case 'expired': case 'timeout': return 'ipad-wechat: the QR code expired before it was confirmed';
    default: return `ipad-wechat: login ended with status ${status}`;
  }
}

/** Canonical MediaRef → an SDK image source (bytes, `base64://…` or an https URL). */
export async function mediaSource(media: MediaRef, signal?: AbortSignal): Promise<Uint8Array | string> {
  switch (media.kind) {
    case 'base64': {
      const value = media.value.replace(/^data:[^,]*;base64,/u, '').replace(/^base64:\/\//u, '');
      return `base64://${value}`;
    }
    case 'url': {
      if (media.value.startsWith('https://')) return media.value;
      const response = await fetch(media.value, signal ? { signal } : {});
      if (!response.ok) throw new Error(`ipad-wechat: image download failed with HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    }
    case 'path':
    case 'file':
      return new Uint8Array(await readFile(media.value.replace(/^file:\/\//u, ''), signal ? { signal } : {}));
  }
}

function createIpadWechatManagement(requireClient: () => IpadWechatClient): EndpointManagement {
  return Object.freeze<EndpointManagement>({
    async listFriends(request: EndpointManagementRequest = {}): Promise<readonly EndpointFriend[]> {
      return createEndpointOperation(request).run(async () => {
        const directory = await requireClient().contactDirectory();
        return directory.items.filter(item => !isGroupId(item.id) && !item.officialAccount).map(item => ({
          user_id: item.id, nickname: item.name ?? item.displayName, remark: item.remark ?? '',
        }));
      });
    },
    async listGroups(request: EndpointManagementRequest = {}): Promise<readonly EndpointGroup[]> {
      return createEndpointOperation(request).run(async () => {
        const directory = await requireClient().contactDirectory();
        return directory.items.filter(item => isGroupId(item.id)).map(item => ({ group_id: item.id, name: item.displayName }));
      });
    },
    async listGroupMembers(request: EndpointGroupRequest): Promise<readonly unknown[]> {
      return createEndpointOperation(request).run(() => requireClient().groupMembers(request.groupId));
    },
  });
}
