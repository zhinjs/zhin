import { defineEndpointClient } from 'zhin.js/adapter';
import type { MilkyEvent } from './protocol.js';

export type MilkyApiCall = (
  action: string,
  params?: Record<string, unknown>,
) => Promise<unknown>;

/** Transport-independent Milky protocol Client produced by every Endpoint mode. */
export class MilkyClient {
  constructor(readonly callApi: MilkyApiCall) {}

  async kickMember(groupId: number, userId: number, rejectAddRequest = false): Promise<boolean> {
    await this.callApi('kick_group_member', { group_id: groupId, user_id: userId, reject_add_request: rejectAddRequest });
    return true;
  }
  async muteMember(groupId: number, userId: number, duration = 600): Promise<boolean> {
    await this.callApi('set_group_member_mute', { group_id: groupId, user_id: userId, duration });
    return true;
  }
  async muteAll(groupId: number, enable = true): Promise<boolean> {
    await this.callApi('set_group_whole_mute', { group_id: groupId, is_mute: enable });
    return true;
  }
  async setAdmin(groupId: number, userId: number, enable = true): Promise<boolean> {
    await this.callApi('set_group_member_admin', { group_id: groupId, user_id: userId, is_set: enable });
    return true;
  }
  async setCard(groupId: number, userId: number, card: string): Promise<boolean> {
    await this.callApi('set_group_member_card', { group_id: groupId, user_id: userId, card });
    return true;
  }
  async setTitle(groupId: number, userId: number, title: string): Promise<boolean> {
    await this.callApi('set_group_member_special_title', { group_id: groupId, user_id: userId, special_title: title });
    return true;
  }
  async setGroupName(groupId: number, name: string): Promise<boolean> {
    await this.callApi('set_group_name', { group_id: groupId, new_group_name: name });
    return true;
  }
  getMemberList(groupId: number): Promise<unknown[]> {
    return this.callApi('get_group_member_list', { group_id: groupId }) as Promise<unknown[]>;
  }
  getGroupInfo(groupId: number): Promise<unknown> {
    return this.callApi('get_group_info', { group_id: groupId });
  }
}
export type MilkyClientEventMap = Record<string, MilkyEvent>;

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly milky: {
      readonly client: MilkyClient;
      readonly events: MilkyClientEventMap;
    };
  }
}

export const milkyClient = defineEndpointClient<MilkyClient, MilkyClientEventMap>('milky');
