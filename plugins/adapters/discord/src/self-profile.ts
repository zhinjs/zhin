import { createEndpointOperation, type EndpointProfile } from 'zhin.js/adapter';
import type { Client, ClientUser, User } from 'discord.js';
import type { SelfProfile } from '@zhin.js/im-contract';
import type { DiscordRestRequest } from './endpoint.js';

function profileOf(user: Pick<User, 'username' | 'avatarURL'>): SelfProfile {
  return { nickname: user.username, avatar: user.avatarURL() };
}

/** The Gateway's native ClientUser owns its current username/avatar and updates its own cache. */
export function createDiscordSelfProfile(client: Pick<Client, 'user' | 'users'>): EndpointProfile {
  const user = (): ClientUser => {
    if (!client.user) throw new Error('Discord self account is unavailable');
    return client.user;
  };
  return Object.freeze<EndpointProfile>({
    writableFields: Object.freeze(['nickname', 'avatar']),
    get current() { return client.user ? profileOf(client.user) : {}; },
    async read({ signal }) {
      return profileOf(await createEndpointOperation({ signal }).prepare(() =>
        client.users.fetch(user().id, { force: true, cache: false })));
    },
    async write({ change, signal }) {
      const operation = createEndpointOperation({ signal });
      if (change.field === 'nickname') {
        const updated = await operation.run(() => user().setUsername(change.value));
        return { status: 'updated', profile: profileOf(updated) };
      }
      if (change.field === 'avatar') {
        if (change.value.kind === 'file') {
          return { status: 'rejected', message: 'Discord avatar requires resolved image bytes, URL or local path' };
        }
        const image = change.value.kind === 'base64' ? Buffer.from(change.value.value, 'base64') : change.value.value;
        const updated = await operation.run(() => user().setAvatar(image));
        return { status: 'updated', profile: profileOf(updated) };
      }
      return { status: 'rejected', message: `Discord does not expose ${change.field} through this port` };
    },
  });
}

interface DiscordOwnUser { readonly id: string; readonly username: string; readonly avatar: string | null; }
interface DiscordProfileRestClient { request<T>(request: DiscordRestRequest): Promise<T>; }

/** Interactions-only accounts use the same public identity fields through authenticated REST. */
export function createDiscordRestSelfProfile(client: DiscordProfileRestClient, reportAccount: (id: string) => void): EndpointProfile {
  const observed = (user: DiscordOwnUser): SelfProfile | undefined => {
    if (!user?.id || typeof user.username !== 'string' || (user.avatar !== null && typeof user.avatar !== 'string')) {
      return undefined;
    }
    reportAccount(user.id);
    return { nickname: user.username, avatar: user.avatar === null ? null
      : `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith('a_') ? 'gif' : 'png'}` };
  };
  return Object.freeze<EndpointProfile>({
    writableFields: Object.freeze(['nickname', 'avatar']),
    async read({ signal }) {
      const profile = observed(await client.request<DiscordOwnUser>({ method: 'GET', path: '/users/@me', signal }));
      if (!profile) throw new Error('Discord returned an incomplete self profile');
      return profile;
    },
    async write({ change, signal }) {
      let body: { username: string } | { avatar: string };
      if (change.field === 'nickname') body = { username: change.value };
      else if (change.field === 'avatar') {
        if (change.value.kind !== 'base64' || !change.value.mime_type) {
          return { status: 'rejected', message: 'Discord REST avatar requires resolved image bytes and MIME type' };
        }
        body = { avatar: `data:${change.value.mime_type};base64,${change.value.value}` };
      } else return { status: 'rejected', message: `Discord does not expose ${change.field} through this port` };
      const updated = await client.request<DiscordOwnUser>({ method: 'PATCH', path: '/users/@me', body, signal });
      const profile = observed(updated);
      return { status: 'updated', ...(profile ? { profile } : {}) };
    },
  });
}
