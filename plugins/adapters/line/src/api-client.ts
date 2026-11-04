import { type EndpointManagementRequest } from 'zhin.js/adapter';
import { EventEmitter } from 'node:events';
import type { LineFetch } from './endpoint.js';
import type { LineEvent, ResolvedLineConfig } from './protocol.js';

export interface LineGroupMember {
  readonly user_id: string;
  readonly nickname: string;
}

interface LineGroupMemberIds { readonly memberIds?: string[]; readonly next?: string; }
interface LineGroupMemberPageRequest extends EndpointManagementRequest {
  readonly groupId: string;
  readonly start?: string;
}

export interface LineApiClientOptions {
  readonly config: ResolvedLineConfig;
  readonly fetch: LineFetch;
  readonly signal?: AbortSignal;
}

/** Direct LINE Messaging API client; it has no Endpoint lifecycle methods. */
export class LineApiClient extends EventEmitter {
  readonly apiConfig: ResolvedLineConfig;
  constructor({ config, fetch, signal }: LineApiClientOptions) {
    super();
    this.apiConfig = config;
    this.transportSignal = signal;
    this.fetch = (url, init) => {
      this.transportSignal?.throwIfAborted();
      return fetch(url, { ...init, ...(this.transportSignal ? { signal: init?.signal ? AbortSignal.any([this.transportSignal, init.signal]) : this.transportSignal } : {}) });
    };
  }
  readonly fetch: LineFetch;
  protected transportSignal?: AbortSignal;

  async request<T = unknown>(path: string, init: {
    readonly method?: string;
    readonly body?: string;
    readonly signal?: AbortSignal;
  } = {}): Promise<T> {
    init.signal?.throwIfAborted();
    const response = await this.fetch(`${this.apiConfig.apiBaseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.apiConfig.channelAccessToken}`,
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: init.body }),
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LINE API error ${response.status}: ${text}`);
    }
    return await response.json() as T;
  }

  getProfile(userId: string): Promise<unknown> {
    return this.request(`/v2/profile/${encodeURIComponent(userId)}`);
  }

  getGroupMemberIds(groupId: string, start?: string): Promise<LineGroupMemberIds> {
    return this.#groupMemberIds({ groupId, start });
  }

  #groupMemberIds({ groupId, start, signal }: LineGroupMemberPageRequest): Promise<LineGroupMemberIds> {
    const kind = groupId.startsWith('R') ? 'room' : 'group';
    const query = start ? `?start=${encodeURIComponent(start)}` : '';
    return this.request(`/v2/bot/${kind}/${encodeURIComponent(groupId)}/members/ids${query}`, { signal });
  }

  async getGroupMembers(groupId: string, request: EndpointManagementRequest = {}): Promise<LineGroupMember[]> {
    const kind = groupId.startsWith('R') ? 'room' : 'group';
    const ids: string[] = [];
    let next: string | undefined;
    do {
      const page = await this.#groupMemberIds({ groupId, start: next, signal: request.signal });
      ids.push(...(page.memberIds ?? []).filter((id) => typeof id === 'string' && id.length > 0));
      next = page.next || undefined;
    } while (next);

    return Promise.all(ids.map(async (userId) => {
      try {
        const profile = await this.request<{ displayName?: string }>(
          `/v2/bot/${kind}/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`, { signal: request.signal },
        );
        return { user_id: userId, nickname: String(profile.displayName ?? userId) };
      } catch (error) {
        if (request.signal?.aborted) throw error;
        return { user_id: userId, nickname: userId };
      }
    }));
  }
}
