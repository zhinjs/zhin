import {
  createRoomRegistry,
  validateRoomDefinitions,
  type RoomDefinition,
  type RoomRegistry,
} from '@zhin.js/workroom';

export const ROOM_ID = 'team-room';
export const SANDBOX_ADAPTER = 'sandbox';
export const BOT_ENDPOINTS = Object.freeze({
  coordinator: 'coordinator-bot',
  researcher: 'researcher-bot',
  writer: 'writer-bot',
} as const);

export interface BuildRoomOptions {
  /** Extra handoff targets for the writer role (the default writer cannot hand off). */
  readonly writerHandoffTo?: readonly string[];
}

/** The Room of this example: one group, three Bots, one role each. */
export function buildRoomDefinition(options: BuildRoomOptions = {}): RoomDefinition {
  return {
    name: 'Team Room',
    description: '3 Bot 同群协作：coordinator -> researcher -> writer',
    conversation: { adapter: SANDBOX_ADAPTER, endpoint: BOT_ENDPOINTS.coordinator, kind: 'group', id: 'team-room' },
    coordinator: 'coordinator',
    roles: {
      coordinator: { prompt: '拆解人类请求并交给 researcher', accepts: ['coordinate'], handoffTo: ['researcher'] },
      researcher: { prompt: '调研后交给 writer', accepts: ['research'], handoffTo: ['writer'] },
      writer: {
        prompt: '成稿并完成 Task',
        accepts: ['write'],
        ...(options.writerHandoffTo ? { handoffTo: options.writerHandoffTo } : {}),
      },
    },
    members: [
      { agent: 'coordinator', role: 'coordinator', botEndpoint: { adapter: SANDBOX_ADAPTER, endpoint: BOT_ENDPOINTS.coordinator } },
      { agent: 'researcher', role: 'researcher', botEndpoint: { adapter: SANDBOX_ADAPTER, endpoint: BOT_ENDPOINTS.researcher } },
      { agent: 'writer', role: 'writer', botEndpoint: { adapter: SANDBOX_ADAPTER, endpoint: BOT_ENDPOINTS.writer } },
    ],
  };
}

/** Validates the definition (throws on any issue) and builds the registry; `resolveEndpointId` maps config names to runtime ids. */
export function buildRoomRegistry(
  definition: RoomDefinition,
  resolveEndpointId: (bot: { adapter: string; endpoint: string }) => string,
): RoomRegistry {
  // Throws RoomDefinitionError on any issue (fail-closed); returns a frozen copy.
  const rooms = validateRoomDefinitions({ [ROOM_ID]: definition });
  return createRoomRegistry(rooms, resolveEndpointId);
}
