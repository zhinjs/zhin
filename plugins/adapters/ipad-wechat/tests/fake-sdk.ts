/** In-memory stand-in for the `@wchats/ipad` client: no network, no native module. */
import { EventEmitter } from 'node:events';
import { writeFile } from 'node:fs/promises';
import type { IpadClient, IpadSdk, RunOptions, RunResult } from '../src/sdk.js';

export interface FakeMessage {
  id: string;
  kind: string;
  direction: 'incoming' | 'outgoing';
  conversationId: string;
  senderId: string;
  groupSenderId: string | null;
  body: string;
  rawContent: string;
  mediaHandle?: string;
}

export class FakeIpadClient extends EventEmitter {
  account: string | null = 'wxid_bot';
  runOptions?: RunOptions;
  /** What the next `run()` does before going online; return a result to end the run. */
  onRun?: (options: RunOptions) => Promise<RunResult | undefined>;
  readonly sent: Array<{ kind: 'text' | 'image'; recipient: string; content: unknown; options: unknown }> = [];
  readonly acknowledged: string[] = [];
  textResult: (recipient: string) => Promise<unknown> = async () => ({
    request_id: 'r', sequence: 1, state_version: 1, return_code: 0,
    output: { kind: 'send_text', receipt: { new_message_id: 9_000_000_000_000_000_001n, message_id: 7, client_message_id: 1 } },
  });
  closed = false;
  #stop?: () => void;

  async run(options: RunOptions = {}): Promise<RunResult> {
    this.runOptions = options;
    const early = await this.onRun?.(options);
    if (early) return early;
    this.emit('online.started', { link: { context: 'c', generation: 1 } });
    this.emit('online.ready', { link: { context: 'c', generation: 1 }, nextHeartbeatAt: 0 });
    await new Promise<void>((resolve) => {
      this.#stop = resolve;
      options.signal?.addEventListener('abort', () => resolve(), { once: true });
    });
    return { status: 'stopped', login: null, online: null };
  }

  stop(): void { this.#stop?.(); }
  async close(): Promise<void> { this.closed = true; }

  /** Deliver like the SDK: every message listener is awaited; resolving is the ACK. */
  async deliver(message: FakeMessage): Promise<void> {
    const delivery = { id: 1, account: 'wxid_bot', request_id: 'r', command_index: 0, kind: 'message', message };
    await Promise.all(this.listeners('message').map(listener => (listener as (...args: unknown[]) => unknown)(message, delivery)));
  }

  async sendText(recipient: string, content: string, options?: { operationId?: string }) {
    this.sent.push({ kind: 'text', recipient, content, options });
    return this.textResult(recipient);
  }
  async sendImage(recipient: string, source: unknown, options: { operationId: string }) {
    this.sent.push({ kind: 'image', recipient, content: source, options });
    return { operationId: options.operationId, recipient, status: 'sent', bytes: 1, sha256: '', uploadTime: 0,
      preflight: {}, result: { output: { receipt: { message_id: 5, new_message_id: 55n, create_time: 0 } } } };
  }
  async acknowledgeAction(operationId: string) { this.acknowledged.push(operationId); }
  async acknowledgeImageSend(operationId: string) { this.acknowledged.push(operationId); }
  async downloadImageToFile(_handle: string, file: string) {
    await writeFile(file, Buffer.from([0xff, 0xd8, 0xff]));
    return { file, bytes: 3, sha256: '', operationId: 'x', resumed: false };
  }
  async getContactDirectory() {
    return { id: 'd', status: 'complete', complete: true, detailErrors: [], message: '', scan: { pages: 1, wxSequence: 0, roomSequence: 0, returnCode: 0 },
      items: [
        { id: 'wxid_alice', name: 'Alice', remark: 'A', displayName: 'A', alias: null, avatarUrl: null, labelIds: [], verifyFlag: 0, officialAccount: false, hydrated: true },
        { id: 'gh_news', name: 'News', remark: null, displayName: 'News', alias: null, avatarUrl: null, labelIds: [], verifyFlag: 8, officialAccount: true, hydrated: true },
        { id: '123@chatroom', name: null, remark: null, displayName: '测试群', alias: null, avatarUrl: null, labelIds: [], verifyFlag: 0, officialAccount: false, hydrated: true },
      ] };
  }
  async getGroupMembers(chatroom: string) {
    return { request_id: 'r', sequence: 1, state_version: 1, return_code: 0, message: '', output: {},
      data: { chatroom, version: 1, infoMask: 0, members: [{ id: 'wxid_alice', nickname: 'Alice', displayName: '群名片', avatar: null, avatarLarge: null, flag: 0, inviter: null }, { id: null, nickname: null, displayName: null, avatar: null, avatarLarge: null, flag: null, inviter: null }] } };
  }
}

export function fakeSdk(client: FakeIpadClient, extra: Partial<IpadSdk> = {}): IpadSdk & { created: unknown[] } {
  const created: unknown[] = [];
  return {
    created,
    async createClient(options) { created.push(options); return client as unknown as IpadClient; },
    ...extra,
  };
}

export function message(overrides: Partial<FakeMessage> = {}): FakeMessage {
  return { id: 'm1', kind: 'text', direction: 'incoming', conversationId: 'wxid_alice', senderId: 'wxid_alice',
    groupSenderId: null, body: 'hello', rawContent: 'hello', ...overrides };
}
