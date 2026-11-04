import { createEndpointOperation, type EndpointProfile } from 'zhin.js/adapter';
import type { RuntimeKookClient } from './ws.js';

interface KookSelfProfileOptions {
  readonly client: Pick<RuntimeKookClient, 'getSelfInfo'>;
  readonly reportAccount: (id: string) => void;
}

/** Bot account profile facts from the SDK's existing /user/me method. */
export function createKookSelfProfile({ client, reportAccount }: KookSelfProfileOptions): EndpointProfile {
  return Object.freeze<EndpointProfile>({
    writableFields: Object.freeze([]),
    async read({ signal }) {
      const self = await createEndpointOperation({ signal }).prepare(() => client.getSelfInfo());
      if (!self?.id || typeof self.username !== 'string') throw new Error('KOOK returned an incomplete self profile');
      reportAccount(self.id);
      return { nickname: self.username, ...(typeof self.avatar === 'string' ? { avatar: self.avatar } : {}) };
    },
  });
}
