import { createEndpointOperation, type EndpointProfile } from 'zhin.js/adapter';
import type { WecomClient } from './client.js';

/** Enterprise application profile; no member/user profile is impersonated. */
export function createWecomSelfProfile(client: Pick<WecomClient, 'getApplicationInfo'>): EndpointProfile {
  return Object.freeze<EndpointProfile>({
    writableFields: Object.freeze([]),
    async read({ signal }) {
      const self = await createEndpointOperation({ signal }).prepare(() => client.getApplicationInfo({ signal }));
      return { ...(typeof self.name === 'string' ? { nickname: self.name } : {}),
        ...(typeof self.description === 'string' ? { bio: self.description } : {}),
        ...(typeof self.square_logo_url === 'string' ? { avatar: self.square_logo_url } : {}) };
    },
  });
}
