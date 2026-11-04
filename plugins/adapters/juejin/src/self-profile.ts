import { createEndpointOperation, type EndpointProfile } from 'zhin.js/adapter';
import type { JuejinClient } from './client.js';

interface JuejinSelfProfileOptions {
  readonly client: Pick<JuejinClient, 'getSelf'>;
  readonly reportAccount: (id: string) => void;
}

/** Experimental Juejin adapter exposes a read-only profile from the logged-in Web identity. */
export function createJuejinSelfProfile({ client, reportAccount }: JuejinSelfProfileOptions): EndpointProfile {
  return Object.freeze<EndpointProfile>({
    writableFields: Object.freeze([]),
    async read({ signal }) {
      const self = await createEndpointOperation({ signal }).prepare(() => client.getSelf());
      if (!self) throw new Error('Juejin account is not logged in');
      reportAccount(self.userId);
      return { ...(self.userName ? { nickname: self.userName } : {}), ...(self.avatar ? { avatar: self.avatar } : {}) };
    },
  });
}
