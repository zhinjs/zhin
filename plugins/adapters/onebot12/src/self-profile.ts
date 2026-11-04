import type { EndpointProfile, PendingRpcRequest } from 'zhin.js/adapter';

interface Onebot12SelfProfileOptions {
  readonly call: (request: PendingRpcRequest) => Promise<unknown>;
  readonly accountId: string;
  readonly reportAccount: (id: string) => void;
}

/** The protocol caller already binds self={platform,user_id}; validate the returned account too. */
export function createOnebot12SelfProfile({ call, accountId, reportAccount }: Onebot12SelfProfileOptions): EndpointProfile {
  return Object.freeze<EndpointProfile>({
    writableFields: Object.freeze([]),
    async read({ signal }) {
      const self = await call({ action: 'get_self_info', signal }) as { user_id?: string; user_name?: string; user_displayname?: string } | undefined;
      if (self?.user_id !== accountId) throw new Error('OneBot12 returned another account profile');
      const nickname = self.user_displayname || self.user_name;
      if (typeof nickname !== 'string') throw new Error('OneBot12 returned an incomplete self profile');
      reportAccount(self.user_id);
      return { nickname };
    },
  });
}
