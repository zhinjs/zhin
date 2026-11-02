import type { EndpointProfile } from 'zhin.js/adapter';
import type { SatoriActionCaller } from './client.js';
import type { SatoriLogin } from './protocol.js';

interface SatoriSelfProfileOptions {
  readonly call: SatoriActionCaller;
  readonly platform: string;
  readonly accountId: string;
  readonly reportAccount: (id: string) => void;
}

/** login.get is scoped by Satori-Platform/Satori-User-ID, never the gateway's first login. */
export function createSatoriSelfProfile({ call, platform, accountId, reportAccount }: SatoriSelfProfileOptions): EndpointProfile {
  return Object.freeze<EndpointProfile>({
    writableFields: Object.freeze([]),
    async read({ signal }) {
      const self = await call({ resource: 'login', method: 'get', signal }) as SatoriLogin;
      if (self?.user?.id !== accountId || (self.platform !== undefined && self.platform !== platform)) {
        throw new Error('Satori returned another account profile');
      }
      reportAccount(self.user.id);
      return { ...(typeof self.user.name === 'string' ? { nickname: self.user.name } : {}),
        ...(typeof self.user.avatar === 'string' ? { avatar: self.user.avatar } : {}) };
    },
  });
}
