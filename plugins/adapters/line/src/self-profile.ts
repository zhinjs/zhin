import type { EndpointProfile } from 'zhin.js/adapter';
import type { LineApiClient } from './api-client.js';

interface LineSelfProfileOptions {
  readonly client: Pick<LineApiClient, 'request'>;
  readonly reportAccount: (id: string) => void;
}

/** Messaging API exposes bot info, but profile edits remain in LINE account administration. */
export function createLineSelfProfile({ client, reportAccount }: LineSelfProfileOptions): EndpointProfile {
  return Object.freeze<EndpointProfile>({
    writableFields: Object.freeze([]),
    async read({ signal }) {
      const self = await client.request<{ userId: string; displayName: string; pictureUrl?: string }>('/v2/bot/info', { signal });
      if (!self.userId || typeof self.displayName !== 'string') throw new Error('LINE returned an incomplete bot profile');
      reportAccount(self.userId);
      return { nickname: self.displayName, ...(typeof self.pictureUrl === 'string' ? { avatar: self.pictureUrl } : {}) };
    },
  });
}
