import { createEndpointOperation, type EndpointProfile } from 'zhin.js/adapter';
import type { BilibiliClient } from './client.js';

interface BilibiliSelfProfileOptions {
  readonly client: Pick<BilibiliClient, 'getNav'>;
  readonly reportAccount: (id: string) => void;
}

/** Experimental Bilibili adapter retains its read-only native login contract. */
export function createBilibiliSelfProfile({ client, reportAccount }: BilibiliSelfProfileOptions): EndpointProfile {
  return Object.freeze<EndpointProfile>({
    writableFields: Object.freeze([]),
    async read({ signal }) {
      const self = await createEndpointOperation({ signal }).prepare(() => client.getNav());
      if (!self) throw new Error('Bilibili account is not logged in');
      reportAccount(self.mid);
      return { ...(typeof self.uname === 'string' ? { nickname: self.uname } : {}),
        ...(typeof self.face === 'string' ? { avatar: self.face } : {}) };
    },
  });
}
