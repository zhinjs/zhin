import type { PendingRpcRequest } from 'zhin.js/adapter';
import { createOneBot12EndpointManagement } from '../src/endpoint-management.js';

it.each(['9007199254740993', 'channel-alpha'])('preserves opaque group and user ID %s through listing and member lookup', async id => {
  const callApi = vi.fn(async ({ action }: PendingRpcRequest) => action === 'get_friend_list'
    ? [{ user_id: id, user_name: 'Synthetic' }] : action === 'get_group_list' ? [{ group_id: id, group_name: 'Synthetic' }] : []);
  const port = createOneBot12EndpointManagement({ callApi });
  expect(await port.listFriends!()).toEqual([{ user_id: id, nickname: 'Synthetic', remark: '' }]);
  const groups = await port.listGroups!(); expect(groups).toEqual([{ group_id: id, name: 'Synthetic' }]);
  await port.listGroupMembers!({ groupId: String(groups[0]!.group_id) });
  expect(callApi).toHaveBeenLastCalledWith({ action: 'get_group_member_list', signal: undefined, params: { group_id: id } });
});
it('does not turn an already lossy numeric ID into a plausible address', async () => {
  const port = createOneBot12EndpointManagement({ callApi: async () => [{ group_id: 9007199254740992, group_name: 'Synthetic' }] });
  await expect(port.listGroups!()).rejects.toThrow('platform ID');
});
