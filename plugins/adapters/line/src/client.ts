import type { LineFetch } from './endpoint.js';
import { defineEndpointClient } from 'zhin.js/adapter';
import type { LineEvent, ResolvedLineConfig } from './protocol.js';

export interface LineGroupMember {
  readonly user_id: string;
  readonly nickname: string;
}

/** Direct LINE Messaging API client; it has no Endpoint lifecycle methods. */
export class LineClient {
  constructor(
    readonly config: ResolvedLineConfig,
    readonly fetch: LineFetch,
  ) {}

  async request<T = unknown>(path: string, init: {
    readonly method?: string;
    readonly body?: string;
    readonly signal?: AbortSignal;
  } = {}): Promise<T> {
    const response = await this.fetch(`${this.config.apiBaseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${this.config.channelAccessToken}`,
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: init.body }),
      signal: init.signal ?? AbortSignal.timeout(30_000),
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

  getGroupMemberIds(groupId: string, start?: string): Promise<{
    readonly memberIds?: string[];
    readonly next?: string;
  }> {
    const kind = groupId.startsWith('R') ? 'room' : 'group';
    const query = start ? `?start=${encodeURIComponent(start)}` : '';
    return this.request(
      `/v2/bot/${kind}/${encodeURIComponent(groupId)}/members/ids${query}`,
    );
  }

  async getGroupMembers(groupId: string): Promise<LineGroupMember[]> {
    const kind = groupId.startsWith('R') ? 'room' : 'group';
    const ids: string[] = [];
    let next: string | undefined;
    do {
      const page = await this.getGroupMemberIds(groupId, next);
      ids.push(...(page.memberIds ?? []).filter((id) => typeof id === 'string' && id.length > 0));
      next = page.next || undefined;
    } while (next);

    return Promise.all(ids.map(async (userId) => {
      try {
        const profile = await this.request<{ displayName?: string }>(
          `/v2/bot/${kind}/${encodeURIComponent(groupId)}/member/${encodeURIComponent(userId)}`,
        );
        return { user_id: userId, nickname: String(profile.displayName ?? userId) };
      } catch {
        return { user_id: userId, nickname: userId };
      }
    }));
  }
}

export type LineClientEventMap = Record<string, LineEvent>;

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly line: {
      readonly client: LineClient;
      readonly events: LineClientEventMap;
    };
  }
}

export const lineClient = defineEndpointClient<LineClient, LineClientEventMap>('line');
