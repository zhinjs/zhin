/**
 * The part of the `@wchats/ipad` SDK this adapter uses.
 *
 * The SDK is a private optional peer: these structural types describe only the
 * members the adapter calls, so this package builds and tests without it (tests
 * inject a fake through `IpadWechatEndpointOptions.sdk`). The SDK itself is
 * loaded lazily at endpoint start; importing this package never loads the
 * native signing module.
 */

export type Counter = number | bigint;

export interface ResultBase {
  readonly request_id: string;
  readonly sequence: Counter;
  readonly state_version: Counter;
  readonly return_code: number;
}

/** Projected message of a `message` delivery (SDK `MessageContext` fields read here). */
export interface MessageContext {
  readonly id: string;
  readonly kind: string;
  readonly direction: 'incoming' | 'outgoing';
  readonly conversationId: string;
  readonly senderId: string;
  readonly groupSenderId: string | null;
  readonly body: string;
  readonly rawContent: string;
  readonly mediaHandle?: string;
}

/** A finite login step; QR code and QR status are the ones the adapter reads. */
export interface LoginStep extends ResultBase {
  readonly output:
    | Readonly<{ kind: 'qr_code'; message: string; accepted: boolean; image: number[] | null }>
    | Readonly<{ kind: 'qr_status'; phase: string; verification_required: boolean; message: string }>
    | Readonly<{ kind: string }>;
}

/** One NewInit page; its effects are durable once the consumer resolves. */
export interface InitResult extends ResultBase {
  readonly output: Readonly<{ kind: 'new_init'; message: string; page: unknown }>;
}

export type BusinessDelivery = Readonly<{
  id: Counter;
  account: string;
  request_id: string;
  command_index: number;
}> & (
  | Readonly<{ kind: 'message'; message: unknown }>
  | Readonly<{ kind: 'sync.command'; command_id: number | null; payload: number[] }>
  | Readonly<{ kind: 'sync.error'; command_id: number | null; code: string }>
);

export interface LongLinkDelivery {
  readonly link: Readonly<{ context: string; generation: Counter }>;
  readonly id: Counter;
  readonly event:
    | Readonly<{ kind: 'sync_notification' | 'special_noop' | 'response' | 'push' }>
    | Readonly<{ kind: 'error'; code: string }>;
}

export interface LoginResult {
  readonly method: 'qr' | 'restore' | null;
  readonly status: string;
}

export type RunResult =
  | Readonly<{ status: 'stopped'; login: LoginResult | null; online: unknown }>
  | Readonly<{ status: 'login_incomplete'; login: LoginResult; online: null }>;

export interface RunOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMillis?: number;
  readonly pollIntervalMillis?: number;
  readonly heartbeatIntervalSeconds?: number;
  readonly reconnect?: boolean;
  readonly onLoginStep?: (step: LoginStep) => void | Promise<void>;
  readonly onInitPage?: (page: InitResult) => void | Promise<void>;
  readonly onDelivery?: (delivery: BusinessDelivery) => void | Promise<void>;
  readonly onLongLinkEvent?: (delivery: LongLinkDelivery) => void | Promise<void>;
}

export interface TextResult extends ResultBase {
  readonly output: Readonly<{
    kind: 'send_text';
    receipt: Readonly<{ message_id: Counter | null; new_message_id: Counter | null; client_message_id: Counter }> | null;
  }>;
}

export interface ImageSendResult {
  readonly operationId: string;
  readonly status: 'sent' | 'rejected';
  readonly result: Readonly<{
    output: Readonly<{ receipt: Readonly<{ message_id: number | null; new_message_id: Counter | null }> | null }>;
  }>;
}

export interface ContactSummary {
  readonly id: string;
  readonly name: string | null;
  readonly remark: string | null;
  readonly displayName: string;
  readonly officialAccount: boolean;
}

export interface ContactDirectoryResult {
  readonly status: string;
  readonly complete: boolean;
  readonly items: readonly ContactSummary[];
}

export interface GroupMember {
  readonly id: string | null;
  readonly nickname: string | null;
  readonly displayName: string | null;
  readonly inviter: string | null;
}

export interface DirectoryResult<T> extends ResultBase {
  readonly message: string;
  readonly data: T | null;
}

export interface GroupMembers {
  readonly chatroom: string;
  readonly members: readonly GroupMember[] | null;
}

/** SDK client members the Endpoint calls (a fake only needs these). */
export interface IpadClient {
  readonly account: string | null;
  run(options?: RunOptions): Promise<RunResult>;
  stop(): void;
  close(): Promise<void> | undefined;
  sendText(recipient: string, content: string, options?: { operationId?: string; at?: string[] }): Promise<TextResult>;
  sendImage(recipient: string, source: Uint8Array | string, options: { operationId: string; signal?: AbortSignal }): Promise<ImageSendResult>;
  acknowledgeAction(operationId: string): Promise<void>;
  acknowledgeImageSend(operationId: string): Promise<void>;
  downloadImageToFile(handle: string, file: string, options?: { operationId?: string; maxBytes?: number; signal?: AbortSignal }): Promise<{ file: string }>;
  getContactDirectory(options?: { fresh?: boolean; signal?: AbortSignal; maxPages?: number }): Promise<ContactDirectoryResult>;
  getGroupMembers(chatroom: string, options?: { operationId?: string }): Promise<DirectoryResult<GroupMembers>>;
  on(event: string, listener: (...args: never[]) => unknown): unknown;
  off(event: string, listener: (...args: never[]) => unknown): unknown;
}

export interface VerificationServer {
  readonly url: string;
  readonly origin: string;
  readonly completion: Promise<'initialized' | 'closed'>;
  close(): Promise<void>;
}

export interface VerificationServerOptions {
  readonly client: IpadClient;
  readonly tls: Readonly<{ key: string | Uint8Array; cert: string | Uint8Array }>;
  readonly host?: string;
  readonly port?: number;
  readonly publicOrigin?: string;
  readonly onInitPage: (page: InitResult) => void | Promise<void>;
}

export interface IpadSdk {
  createClient(options: { dataDir?: string; signConfig: { mode: 'local' } }): Promise<IpadClient>;
  createVerificationServer?(options: VerificationServerOptions): Promise<VerificationServer>;
}

const SDK_PACKAGE = '@wchats/ipad';

/** Import the installed SDK peer; the error names the packages to install. */
export async function loadIpadSdk(): Promise<IpadSdk> {
  try {
    const sdk = await import(/* @vite-ignore */ SDK_PACKAGE) as unknown as IpadSdk;
    if (typeof sdk.createClient !== 'function') throw new Error(`${SDK_PACKAGE} does not export createClient`);
    return sdk;
  } catch (error) {
    throw new Error(
      `ipad-wechat: cannot load ${SDK_PACKAGE}. Install @wchats/ipad and @wchats/ipad-sign (matching versions, Node.js 24) `
      + 'in the bot project; see the adapter README.',
      { cause: error },
    );
  }
}
