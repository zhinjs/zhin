import type { EndpointProfile, PendingRpcRequest } from 'zhin.js/adapter';
import { EndpointDeliveryError, type SelfProfile } from '@zhin.js/im-contract';

interface NapcatSelfProfileClient {
  readonly currentSelfProfile?: Readonly<SelfProfile>;
  requestApi(request: PendingRpcRequest): Promise<unknown>;
}
interface NapcatAccount { readonly user_id?: number | string; readonly nickname?: string; }
interface NapcatUserProfile extends NapcatAccount {
  readonly age?: number;
  readonly sex?: 'male' | 'female' | 'unknown';
  readonly long_nick?: string;
}

/** All three transports share the native action contract and their existing cancellation owner. */
export function createNapcatSelfProfile(client: NapcatSelfProfileClient, reportAccount?: (id: string) => void): EndpointProfile {
  const account = async (signal: AbortSignal): Promise<NapcatAccount> => {
    const value = await client.requestApi({ action: 'get_login_info', signal }) as NapcatAccount;
    if (!value?.user_id || typeof value.nickname !== 'string') throw new Error('NapCat self account is unavailable');
    reportAccount?.(String(value.user_id));
    return value;
  };
  return Object.freeze<EndpointProfile>({
    writableFields: Object.freeze(['nickname', 'gender', 'signature', 'avatar']),
    get current() { return client.currentSelfProfile ?? {}; },
    async read({ signal }) {
      const self = await account(signal);
      const raw = await client.requestApi({ action: 'get_stranger_info', params: { user_id: String(self.user_id), no_cache: true }, signal }) as NapcatUserProfile;
      if (!raw || String(raw.user_id) !== String(self.user_id)) throw new Error('NapCat returned another account profile');
      const profile: SelfProfile = {
        ...(typeof raw.nickname === 'string' ? { nickname: raw.nickname } : {}),
        ...(raw.sex === 'male' || raw.sex === 'female' || raw.sex === 'unknown' ? { gender: raw.sex } : {}),
        ...(typeof raw.age === 'number' && Number.isFinite(raw.age) ? { age: raw.age } : {}),
        ...(typeof raw.long_nick === 'string' ? { signature: raw.long_nick } : {}),
      };
      return profile;
    },
    async write({ change, signal }) {
      let action: string;
      let params: Record<string, unknown>;
      switch (change.field) {
        case 'nickname': action = 'set_qq_profile'; params = { nickname: change.value }; break;
        case 'gender': {
          if (change.value === 'other') return { status: 'rejected', message: 'NapCat supports male, female or unknown gender' };
          // The native API requires nickname even when only changing sex.
          let self: NapcatAccount;
          try { self = await account(signal); }
          catch (cause) {
            throw new EndpointDeliveryError('endpoint_unavailable',
              'NapCat profile change was not sent: self account lookup failed', 'not_sent', { cause });
          }
          action = 'set_qq_profile';
          params = { nickname: self.nickname, sex: change.value === 'male' ? 1 : change.value === 'female' ? 2 : 0 };
          break;
        }
        case 'signature': action = 'set_self_longnick'; params = { longNick: change.value }; break;
        case 'avatar': {
          if (change.value.kind === 'file') {
            return { status: 'rejected', message: 'NapCat avatar requires resolved image bytes, URL or remote path' };
          }
          action = 'set_qq_avatar';
          params = { file: change.value.kind === 'base64' ? `base64://${change.value.value}` : change.value.value };
          break;
        }
        default: return { status: 'rejected', message: `NapCat cannot safely update ${change.field}` };
      }
      const result = await client.requestApi({ action, params, signal }) as { result?: number; errMsg?: string } | null | undefined;
      if (result && typeof result.result === 'number' && result.result !== 0) {
        return { status: 'rejected', message: result.errMsg ?? 'NapCat rejected the profile change' };
      }
      return change.field === 'avatar' ? { status: 'updated' }
        : { status: 'updated', profile: { [change.field]: change.value } };
    },
  });
}
