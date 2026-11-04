import { botApiUrl, type ResolvedTelegramConfig, type TelegramChatMember } from './protocol.js';
import { TelegramApiError } from './api-error.js';

const DEFAULT_API_TIMEOUT_MS = 30_000;

export type TelegramFetch = (
  url: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string | FormData;
    readonly signal?: AbortSignal;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer?(): Promise<ArrayBuffer>;
  readonly headers?: { get(name: string): string | null };
}>;

export interface TelegramClientApi {
  callApi<T = unknown>(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<T>;
  callApiForm<T = unknown>(method: string, form: FormData, signal?: AbortSignal): Promise<T>;
  pinMessage(chatId: number, messageId: number): Promise<boolean>;
  unpinMessage(chatId: number, messageId?: number): Promise<boolean>;
  setChatDescription(chatId: number, description: string): Promise<boolean>;
  setMessageReaction(chatId: number, messageId: number, reaction: string): Promise<boolean>;
  getChatMemberCount(chatId: number): Promise<number>;
  getChatAdmins(chatId: number): Promise<TelegramChatMember[]>;
  sendStickerMessage(chatId: number, sticker: string): Promise<{ message_id: number }>;
  setChatPermissionsAll(chatId: number, permissions: Record<string, boolean | undefined>): Promise<boolean>;
  createInviteLink(chatId: number): Promise<string>;
  sendPoll(request: TelegramPollRequest): Promise<{ message_id: number }>;
}

export interface TelegramPollRequest {
  readonly chatId: number;
  readonly question: string;
  readonly options: string[];
  readonly isAnonymous?: boolean;
  readonly allowsMultipleAnswers?: boolean;
}

interface TelegramApiOk<T> {
  readonly ok: true;
  readonly result: T;
}

interface TelegramApiErr {
  readonly ok: false;
  readonly description?: string;
  readonly error_code?: number;
  readonly parameters?: { readonly retry_after?: number };
}

interface TelegramHttpRequest {
  readonly method: string;
  readonly init: NonNullable<Parameters<TelegramFetch>[1]>;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
interface TelegramDeadlineOperation<T> {
  readonly method: string;
  readonly run: (signal: AbortSignal) => Promise<T>;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

/** Owns Telegram Bot API transport, cancellation, deadlines and native API operations. */
export class TelegramClient implements TelegramClientApi {
  readonly #options: Readonly<{ config: ResolvedTelegramConfig; requestTimeoutMs?: number }>;
  protected readonly fetchTransport: TelegramFetch;
  protected requestSignal?: AbortSignal;
  #apiAbort = new AbortController();
  constructor(options: Readonly<{ config: ResolvedTelegramConfig; fetch?: TelegramFetch; requestTimeoutMs?: number }>) {
    if (options.requestTimeoutMs !== undefined && (!Number.isFinite(options.requestTimeoutMs) || options.requestTimeoutMs <= 0)) {
      throw new TypeError('Telegram requestTimeoutMs must be a positive finite number');
    }
    this.#options = options;
    this.fetchTransport = options.fetch ?? globalThis.fetch;
  }
  protected restartRequests(): void { if (this.#apiAbort.signal.aborted) this.#apiAbort = new AbortController(); }
  protected cancelRequests(): void { this.#apiAbort.abort(); }
  async callApi<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<T> {
    return this.#requestApi<T>({ method, init: {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params),
    }, signal, timeoutMs: method === 'getUpdates'
      ? Math.max(this.#options.requestTimeoutMs ?? DEFAULT_API_TIMEOUT_MS, (Number(params.timeout) || 0) * 1_000 + 15_000)
      : undefined });
  }

  /** multipart/form-data 变体（attach:// 媒体上传；Content-Type 边界由 FormData 自带）。 */
  async callApiForm<T = unknown>(
    method: string,
    form: FormData,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.#requestApi<T>({ method, init: { method: 'POST', body: form }, signal });
  }

  async #requestApi<T>({ method, init, signal, timeoutMs }: TelegramHttpRequest): Promise<T> {
    return this.withRequestDeadline({ method, run: async requestSignal => {
      const response = await this.fetchTransport(botApiUrl(this.#options.config, method), { ...init, signal: requestSignal });
      return this.#parseApiResponse<T>(method, response);
    }, signal, timeoutMs });
  }

  protected async withRequestDeadline<T>({ method, run, signal,
    timeoutMs = this.#options.requestTimeoutMs ?? DEFAULT_API_TIMEOUT_MS,
  }: TelegramDeadlineOperation<T>): Promise<T> {
    const abort = new AbortController();
    let issued = false;
    const sources = [...new Set([signal, this.requestSignal, this.#apiAbort.signal].filter((item): item is AbortSignal => !!item))];
    let rejectAbort!: (error: unknown) => void;
    const cancelled = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const onCancel = () => {
      const error = new TelegramApiError('cancelled', `Telegram API ${method} cancelled`, {
        disposition: issued ? 'unknown' : 'not_sent',
      });
      abort.abort(error);
      rejectAbort(error);
    };
    const timer = setTimeout(() => {
      const error = new TelegramApiError('timeout', `Telegram API ${method} timed out`);
      abort.abort(error);
      rejectAbort(error);
    }, timeoutMs);
    for (const source of sources) source.addEventListener('abort', onCancel, { once: true });
    try {
      if (sources.some((source) => source.aborted)) onCancel();
      const request = Promise.resolve().then(async () => {
        abort.signal.throwIfAborted();
        issued = true;
        return run(abort.signal);
      });
      return await Promise.race([request, cancelled]);
    } catch (error) {
      if (abort.signal.aborted) throw abort.signal.reason;
      if (error instanceof TelegramApiError) throw error;
      // Network exceptions can contain credential-bearing URLs. Keep those out of errors/logs.
      const detail = error instanceof Error
        ? error.message.replaceAll(this.#options.config.token, '[redacted]') : 'transport failure';
      throw new TelegramApiError('network', `Telegram API ${method} network request failed: ${detail}`);
    } finally {
      clearTimeout(timer);
      for (const source of sources) source.removeEventListener('abort', onCancel);
    }
  }

  async #parseApiResponse<T>(
    method: string,
    response: { readonly status: number; text(): Promise<string> },
  ): Promise<T> {
    const text = await response.text();
    let body: TelegramApiOk<T> | TelegramApiErr;
    try {
      body = JSON.parse(text) as TelegramApiOk<T> | TelegramApiErr;
    } catch {
      throw new TelegramApiError('invalid_response', `Telegram API ${method} invalid JSON (${response.status})`, { status: response.status });
    }
    if (!body || typeof body !== 'object' || typeof body.ok !== 'boolean') {
      throw new TelegramApiError('invalid_response', `Telegram API ${method} invalid response envelope`, { status: response.status });
    }
    if (!body.ok || response.status < 200 || response.status >= 300) {
      const status = !body.ok ? body.error_code ?? response.status : response.status;
      const kind = status === 401 || status === 403 ? 'authentication'
        : status === 429 ? 'rate_limit' : response.status >= 400 ? 'http' : 'api';
      const description = !body.ok ? body.description?.replaceAll(this.#options.config.token, '[redacted]') : undefined;
      throw new TelegramApiError(kind,
        `Telegram API ${method} failed (${status}): ${description ?? 'request rejected'}`,
        { status, disposition: !body.ok ? 'rejected' : 'unknown', ...(!body.ok && body.parameters?.retry_after != null
          ? { retryAfterSeconds: body.parameters.retry_after } : {}) },
      );
    }
    if (!('result' in body)) throw new TelegramApiError('invalid_response', `Telegram API ${method} missing result`);
    return body.result;
  }

  // ── Agent tool surface ──────────────────────────────────────────────

  async pinMessage(chatId: number, messageId: number): Promise<boolean> {
    await this.callApi('pinChatMessage', { chat_id: chatId, message_id: messageId });
    return true;
  }

  async unpinMessage(chatId: number, messageId?: number): Promise<boolean> {
    if (messageId != null) {
      await this.callApi('unpinChatMessage', { chat_id: chatId, message_id: messageId });
    } else {
      await this.callApi('unpinAllChatMessages', { chat_id: chatId });
    }
    return true;
  }

  async setChatDescription(chatId: number, description: string): Promise<boolean> {
    await this.callApi('setChatDescription', { chat_id: chatId, description });
    return true;
  }

  async setMessageReaction(chatId: number, messageId: number, reaction: string): Promise<boolean> {
    await this.callApi('setMessageReaction', {
      chat_id: chatId,
      message_id: messageId,
      reaction: [{ type: 'emoji', emoji: reaction }],
    });
    return true;
  }

  async getChatMemberCount(chatId: number): Promise<number> {
    return this.callApi<number>('getChatMemberCount', { chat_id: chatId });
  }

  async getChatAdmins(chatId: number): Promise<TelegramChatMember[]> {
    return this.callApi<TelegramChatMember[]>('getChatAdministrators', { chat_id: chatId });
  }

  async sendStickerMessage(chatId: number, sticker: string): Promise<{ message_id: number }> {
    return this.callApi<{ message_id: number }>('sendSticker', { chat_id: chatId, sticker });
  }

  async setChatPermissionsAll(
    chatId: number,
    permissions: Record<string, boolean | undefined>,
  ): Promise<boolean> {
    await this.callApi('setChatPermissions', { chat_id: chatId, permissions });
    return true;
  }

  async createInviteLink(chatId: number): Promise<string> {
    const link = await this.callApi<{ invite_link: string }>('createChatInviteLink', { chat_id: chatId });
    return link.invite_link;
  }

  async sendPoll({ chatId, question, options, isAnonymous = true,
    allowsMultipleAnswers = false }: TelegramPollRequest): Promise<{ message_id: number }> {
    return this.callApi<{ message_id: number }>('sendPoll', {
      chat_id: chatId,
      question,
      options,
      is_anonymous: isAnonymous,
      allows_multiple_answers: allowsMultipleAnswers,
    });
  }
}
