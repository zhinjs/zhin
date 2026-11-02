import type { EndpointProfile, PendingRpcRequest } from 'zhin.js/adapter';
import type { SelfProfile } from '@zhin.js/im-contract';

interface Onebot11SelfProfileOptions {
  readonly call: (request: PendingRpcRequest) => Promise<unknown>;
  readonly reportAccount: (id: string | undefined) => void;
}
interface Onebot11SelfProfile extends EndpointProfile {
  /** The same verified account observations used by transport ingress and shutdown. */
  reportAccount(id: string | undefined): void;
}

/** OneBot11's standard self-information action has no standard profile mutation counterpart. */
export function createOnebot11SelfProfile({ call, reportAccount }: Onebot11SelfProfileOptions): Onebot11SelfProfile {
  let nickname: string | undefined;
  let accountId: string | undefined;
  let accountRevision = 0;
  let readSequence = 0;
  let publishedSequence = 0;
  return Object.freeze<Onebot11SelfProfile>({
    writableFields: Object.freeze([]),
    get current() { return nickname === undefined ? {} : { nickname }; },
    reportAccount(id) {
      if (id !== accountId || id === undefined) {
        accountId = id;
        nickname = undefined;
        accountRevision++;
        readSequence++;
        publishedSequence = readSequence;
      }
      reportAccount(id);
    },
    async read({ signal }) {
      const revision = accountRevision;
      const sequence = ++readSequence;
      const assertAccount = () => {
        signal.throwIfAborted();
        if (revision !== accountRevision) throw new Error('OneBot11 account changed while reading self profile');
      };
      const self = await call({ action: 'get_login_info', signal }) as { user_id?: number | string; nickname?: string } | undefined;
      assertAccount();
      if (!self?.user_id || typeof self.nickname !== 'string') throw new Error('OneBot11 returned an incomplete self profile');
      if (sequence > publishedSequence) {
        publishedSequence = sequence;
        accountId = String(self.user_id);
        nickname = self.nickname;
        reportAccount(accountId);
      }
      // Keep confirmed login facts in current, while lookup errors remain lookup errors.
      const details = await call({ action: 'get_stranger_info', params: { user_id: self.user_id, no_cache: true }, signal }) as {
        user_id?: number | string; nickname?: string; sex?: string; age?: number;
      } | undefined;
      assertAccount();
      if (!details || String(details.user_id) !== String(self.user_id)) throw new Error('OneBot11 returned another account profile');
      const observedNickname = typeof details.nickname === 'string' ? details.nickname : self.nickname;
      if (sequence >= publishedSequence) {
        publishedSequence = sequence;
        nickname = observedNickname;
      }
      const profile: SelfProfile = { nickname: observedNickname,
        ...(details.sex === 'male' || details.sex === 'female' || details.sex === 'unknown' ? { gender: details.sex } : {}),
        ...(typeof details.age === 'number' && Number.isFinite(details.age) ? { age: details.age } : {}),
      };
      return profile;
    },
  });
}
