import type { EndpointProfile, PendingRpcRequest } from 'zhin.js/adapter';
import type { SelfProfile } from '@zhin.js/im-contract';

interface Onebot11SelfProfileOptions {
  readonly call: (request: PendingRpcRequest) => Promise<unknown>;
  readonly reportAccount: (id: string) => void;
}

/** OneBot11's standard self-information action has no standard profile mutation counterpart. */
export function createOnebot11SelfProfile({ call, reportAccount }: Onebot11SelfProfileOptions): EndpointProfile {
  let nickname: string | undefined;
  return Object.freeze<EndpointProfile>({
    writableFields: Object.freeze([]),
    get current() { return nickname === undefined ? {} : { nickname }; },
    async read({ signal }) {
      const self = await call({ action: 'get_login_info', signal }) as { user_id?: number | string; nickname?: string } | undefined;
      if (!self?.user_id || typeof self.nickname !== 'string') throw new Error('OneBot11 returned an incomplete self profile');
      reportAccount(String(self.user_id));
      // Retain the confirmed login name if an implementation lacks the extended user-info action.
      nickname = self.nickname;
      const details = await call({ action: 'get_stranger_info', params: { user_id: self.user_id, no_cache: true }, signal }) as {
        user_id?: number | string; nickname?: string; sex?: string; age?: number;
      } | undefined;
      if (!details || String(details.user_id) !== String(self.user_id)) throw new Error('OneBot11 returned another account profile');
      if (typeof details.nickname === 'string') nickname = details.nickname;
      const profile: SelfProfile = { nickname,
        ...(details.sex === 'male' || details.sex === 'female' || details.sex === 'unknown' ? { gender: details.sex } : {}),
        ...(typeof details.age === 'number' && Number.isFinite(details.age) ? { age: details.age } : {}),
      };
      return profile;
    },
  });
}
