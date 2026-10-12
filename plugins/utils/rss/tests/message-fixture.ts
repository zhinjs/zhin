/** Runtime Message shape; the capability identity is deliberately not a routing address. */
export function rssMessage(
  endpointId = '8596238',
  kind: 'private' | 'group' | 'channel' = 'private',
  id = '1659488338',
) {
  return {
    conversation: {
      endpoint: { id: `root/icqq\0zhin.adapter\0icqq~${endpointId}`, adapter: 'root/icqq' },
      kind,
      id,
    },
    content: 'rss-list',
    generation: 4,
    sender: { id: '1659488338', name: '归雨', roles: ['master'] },
    clientAdapter: 'icqq',
    endpointId,
    segments: [{ type: 'text', data: { text: 'rss-list' } }],
  };
}

export const RSS_TEST_CHANNEL = {
  adapterName: 'icqq',
  endpointKey: '8596238',
  channelType: 'private',
  channelId: '1659488338',
} as const;
