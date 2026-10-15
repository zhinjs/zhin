import type { RoomDefinition } from '../../src/room/room-definition.js';
import { createRoomRegistry } from '../../src/room/room-registry.js';
import type { RoomRouteFacts } from '../../src/room/room-router.js';

export const bot = (n: string) => ({ adapter: 'qq', endpoint: n });
export const endpointOf = (b: { adapter: string; endpoint: string }) => `ep-${b.endpoint}`;

export function roomDefinition(over: Partial<RoomDefinition> = {}): RoomDefinition {
  return {
    name: 'Dev',
    conversation: { adapter: 'qq', endpoint: 'main', kind: 'group', id: '100' },
    coordinator: 'lead',
    roles: {
      coordinator: { prompt: 'p', accepts: ['coordinate'], handoffTo: ['researcher', 'writer'] },
      researcher: { prompt: 'p', accepts: ['research'], handoffTo: ['writer'] },
      writer: { prompt: 'p', accepts: ['write'] },
    },
    members: [
      { agent: 'lead', role: 'coordinator', botEndpoint: bot('b1'), aliases: ['boss'] },
      { agent: 'res', role: 'researcher', botEndpoint: bot('b2'), aliases: ['rex'] },
      { agent: 'wri', role: 'writer', botEndpoint: bot('b3') },
    ],
    ...over,
  };
}

export const EP = { lead: 'ep-b1', res: 'ep-b2', wri: 'ep-b3' } as const;
export const ACCOUNTS: Record<string, string> = { 'ep-b1': 'acct-lead', 'ep-b2': 'acct-res', 'ep-b3': 'acct-wri' };

export function registryOf(room: RoomDefinition = roomDefinition(), id = 'dev') {
  return createRoomRegistry({ [id]: room }, endpointOf);
}

export function facts(over: Partial<RoomRouteFacts> = {}): RoomRouteFacts {
  return {
    content: 'hello',
    mentionTargets: [],
    pending: () => false,
    accountOf: (endpointId) => ACCOUNTS[endpointId],
    isAvailable: () => true,
    ...over,
  };
}
