import type { Client } from '@icqqjs/icqq';
import { createEndpointOperation, type EndpointProfile } from 'zhin.js/adapter';
import type { SelfProfile } from '@zhin.js/im-contract';

type IcqqProfileClient = Pick<Client,
  'uin' | 'nickname' | 'isOnline' | 'getProfile' | 'setNickname' | 'setGender' |
  'setSignature' | 'setDescription' | 'setAvatar'>;

/** ICQQ owns the platform facts; config fallbacks and call leases belong to Adapter. */
export function createIcqqSelfProfile(client: IcqqProfileClient): EndpointProfile {
  return Object.freeze<EndpointProfile>({
    writableFields: Object.freeze(['nickname', 'gender', 'signature', 'bio', 'avatar']),
    get current() { return client.isOnline() ? { nickname: client.nickname } : {}; },
    async read({ signal }) {
      const raw = await createEndpointOperation({ signal }).prepare(() => client.getProfile(client.uin));
      const profile: SelfProfile = {
        ...(typeof raw.nickname === 'string' ? { nickname: raw.nickname } : {}),
        ...(raw.sex === 'male' || raw.sex === 'female' || raw.sex === 'unknown' ? { gender: raw.sex } : {}),
        ...(typeof raw.age === 'number' && Number.isFinite(raw.age) ? { age: raw.age } : {}),
        ...(typeof raw.signature === 'string' ? { signature: raw.signature } : {}),
        ...(typeof raw.avatar?.url === 'string' ? { avatar: raw.avatar.url } : {}),
      };
      return profile;
    },
    async write({ change, signal }) {
      const operation = createEndpointOperation({ signal });
      let accepted: boolean;
      switch (change.field) {
        case 'nickname': accepted = await operation.run(() => client.setNickname(change.value)); break;
        case 'gender': {
          if (change.value === 'other') return { status: 'rejected', message: 'ICQQ supports male, female or unknown gender' };
          const gender = change.value === 'male' ? 1 : change.value === 'female' ? 2 : 0;
          accepted = await operation.run(() => client.setGender(gender));
          break;
        }
        case 'signature': accepted = await operation.run(() => client.setSignature(change.value)); break;
        case 'bio': accepted = await operation.run(() => client.setDescription(change.value)); break;
        case 'avatar': {
          if (change.value.kind === 'file') {
            return { status: 'rejected', message: 'ICQQ avatar requires resolved image bytes, URL or local path' };
          }
          const image = change.value.kind === 'base64' ? Buffer.from(change.value.value, 'base64') : change.value.value;
          await operation.run(() => client.setAvatar(image));
          // The input is not the platform CDN URL; it must not become an observed avatar.
          return { status: 'updated' };
        }
        default: return { status: 'rejected', message: `ICQQ cannot safely update ${change.field}` };
      }
      if (accepted && change.field === 'nickname') client.nickname = change.value;
      return accepted
        ? { status: 'updated', profile: { [change.field]: change.value } }
        : { status: 'rejected', message: `ICQQ rejected the ${change.field} change` };
    },
  });
}
