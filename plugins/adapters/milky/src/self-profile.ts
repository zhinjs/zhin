import type { EndpointProfile, PendingRpcRequest } from 'zhin.js/adapter';

interface MilkySelfProfileOptions {
  readonly call: (request: PendingRpcRequest) => Promise<unknown>;
  readonly reportAccount: (id: string) => void;
}

/** Milky login facts are fetched through the same account-bound, error-checked native caller. */
export function createMilkySelfProfile({ call, reportAccount }: MilkySelfProfileOptions): EndpointProfile {
  return Object.freeze<EndpointProfile>({
    writableFields: Object.freeze([]),
    async read({ signal }) {
      const self = await call({ action: 'get_login_info', signal }) as { uin?: number; nickname?: string } | undefined;
      if (!self?.uin || typeof self.nickname !== 'string') throw new Error('Milky returned an incomplete self profile');
      reportAccount(String(self.uin));
      return { nickname: self.nickname };
    },
  });
}
