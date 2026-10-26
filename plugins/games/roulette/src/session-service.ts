import type { Database, Models } from '@zhin.js/core';
import {
  VersionedSessionService,
  channelKey,
  generateCompactId,
  secureRandomInt,
  type GameMessageLike,
  type GameOutcome,
  type GameSessionDatabase,
} from '@zhin.js/game-kit';
import type { RouletteConfig } from './config.js';
import {
  cancelGame,
  createLobby,
  currentPlayer,
  decodeRouletteState,
  expireLobby,
  expireTurn,
  isOpen,
  joinLobby,
  leaveGame,
  pullTrigger,
  startRound,
  type RoulettePlayer,
  type RouletteState,
  type RouletteTableRules,
} from './engine.js';
import type {
  RouletteGroupSettingsRow,
  RouletteSessionRow,
  RouletteSessionStatus,
} from './models.js';

export type RouletteDatabase = Database<unknown, Models, string>;

/** `message.conversation.endpoint`: the adapter plugin owner and the Endpoint capability id. */
export interface EndpointIdentity {
  readonly adapter: string;
  readonly id: string;
}

export type RouletteAction =
  | { readonly type: 'join'; readonly player: RoulettePlayer }
  | { readonly type: 'start' }
  | { readonly type: 'fire' }
  | { readonly type: 'leave' }
  | { readonly type: 'cancel' }
  | { readonly type: 'expire' };

export interface RouletteActionResult {
  readonly session: RouletteSessionRow;
  readonly state: RouletteState;
  /** False when an identical action id was already applied (adapter retry). */
  readonly applied: boolean;
}

export interface RouletteServiceOptions {
  /** Picks the loaded chamber when a round starts; secure random by default. */
  readonly chooseBulletChamber?: (chamberCount: number) => number;
}

export class RouletteSessionService extends VersionedSessionService<RouletteSessionRow> {
  readonly #chooseBulletChamber: (chamberCount: number) => number;

  constructor(database: RouletteDatabase, options: RouletteServiceOptions = {}) {
    super(database as unknown as GameSessionDatabase<RouletteSessionRow>, {
      gameId: 'roulette',
      table: 'roulette_sessions',
      userFields: ['host_id'],
      projectOutcomes: projectRouletteOutcomes,
    });
    this.#chooseBulletChamber = options.chooseBulletChamber ?? secureRandomInt;
  }

  async createLobby(
    message: GameMessageLike,
    endpoint: EndpointIdentity,
    config: RouletteConfig,
  ): Promise<RouletteSessionRow> {
    const now = Date.now();
    const host = playerFromMessage(message);
    const state = createLobby(host, tableRules(config));
    return this.createRow({
      id: generateCompactId('rlt_'),
      locale: message.locale ?? 'zh-CN',
      adapter: String(message.$adapter),
      endpoint: message.$endpoint,
      channel_type: message.$channel.type,
      channel_id: message.$channel.id,
      channel_key: channelKey(message),
      endpoint_adapter: endpoint.adapter,
      endpoint_id: endpoint.id,
      host_id: host.id,
      state_json: JSON.stringify(state),
      phase: state.phase,
      turn: '',
      revision: 0,
      processed_actions: '[]',
      deadline_at: now + config.lobbyTimeoutSeconds * 1000,
      status: 'active',
      updated_at: now,
      created_at: now,
    });
  }

  /** Every seated player counts as busy, not just the host. */
  override async getActiveForUser(
    channelKeyValue: string,
    userId: string,
  ): Promise<RouletteSessionRow | null> {
    const rows = await this.model.findAll({ channel_key: channelKeyValue, status: 'active' });
    const seated = rows.find((row) =>
      decodeRouletteState(row.state_json).players.some((player) => player.id === userId));
    return seated ?? null;
  }

  async applyAction(
    session: RouletteSessionRow,
    actorId: string,
    action: RouletteAction,
    config: RouletteConfig,
  ): Promise<RouletteActionResult> {
    if (action.type === 'join') {
      await this.assertPlayersAvailable(session.channel_key, [action.player.id]);
    }
    const result = await this.mutateSession(session.id, {
      actionId: `${session.id}:${session.revision}:${actorId}:${action.type}`,
      expectedRevision: session.revision,
      apply: (current) => {
        const before = decodeRouletteState(current.state_json);
        const after = this.#transition(before, actorId, action, config);
        return rowPatch(after, config, Date.now());
      },
    });
    return {
      session: result.session,
      state: decodeRouletteState(result.session.state_json),
      applied: result.kind === 'applied',
    };
  }

  /** Open sessions whose lobby or turn deadline has passed. */
  async listOverdue(now: number): Promise<readonly RouletteSessionRow[]> {
    const rows = await this.model.findAll({ status: 'active' });
    return rows.filter((row) => row.deadline_at > 0 && row.deadline_at <= now);
  }

  #transition(
    state: RouletteState,
    actorId: string,
    action: RouletteAction,
    config: RouletteConfig,
  ): RouletteState {
    switch (action.type) {
      case 'join':
        return joinLobby(state, action.player, tableRules(config));
      case 'start':
        return startRound(state, actorId, this.#chooseBulletChamber(state.chamberCount));
      case 'fire':
        return pullTrigger(state, actorId).state;
      case 'leave':
        return leaveGame(state, actorId);
      case 'cancel':
        return cancelGame(state);
      case 'expire':
        return state.phase === 'lobby' ? expireLobby(state) : expireTurn(state);
    }
  }
}

interface GroupSettingsModel {
  findOne(query: Record<string, unknown>): Promise<RouletteGroupSettingsRow | null>;
  create(row: RouletteGroupSettingsRow): Promise<unknown>;
  updateWhere(where: Record<string, unknown>, patch: Partial<RouletteGroupSettingsRow>): Promise<unknown>;
}

interface GroupSettingsDatabase {
  readonly models: { get(name: string): unknown };
}

/** Per-group switches. The mute penalty is off until a group turns it on. */
export class RouletteGroupSettings {
  readonly #model: GroupSettingsModel;

  constructor(database: RouletteDatabase) {
    const model = (database as unknown as GroupSettingsDatabase).models.get('roulette_group_settings');
    if (!model) throw new Error('roulette_group_settings not registered');
    this.#model = model as GroupSettingsModel;
  }

  async isMutePenaltyEnabled(channelKeyValue: string): Promise<boolean> {
    const row = await this.#model.findOne({ id: channelKeyValue });
    return row?.mute_penalty === 1;
  }

  async setMutePenalty(channelKeyValue: string, enabled: boolean, actorId: string): Promise<void> {
    const patch = {
      mute_penalty: enabled ? 1 : 0,
      updated_by: actorId,
      updated_at: Date.now(),
    };
    const existing = await this.#model.findOne({ id: channelKeyValue });
    if (existing) {
      await this.#model.updateWhere({ id: channelKeyValue }, patch);
      return;
    }
    await this.#model.create({ id: channelKeyValue, ...patch });
  }
}

export interface RouletteServices {
  readonly sessions: RouletteSessionService;
  readonly settings: RouletteGroupSettings;
}

export function createServices(
  database: RouletteDatabase,
  options: RouletteServiceOptions = {},
): RouletteServices {
  return {
    sessions: new RouletteSessionService(database, options),
    settings: new RouletteGroupSettings(database),
  };
}

export function stateOf(session: RouletteSessionRow): RouletteState {
  return decodeRouletteState(session.state_json);
}

export function playerFromMessage(message: GameMessageLike): RoulettePlayer {
  const name = message.$sender.name?.trim() || message.$sender.id;
  return { id: message.$sender.id, name };
}

function tableRules(config: RouletteConfig): RouletteTableRules {
  return { chamberCount: config.chambers, maxPlayers: config.maxPlayers };
}

function rowPatch(state: RouletteState, config: RouletteConfig, now: number): Partial<RouletteSessionRow> {
  return {
    state_json: JSON.stringify(state),
    phase: state.phase,
    turn: currentPlayer(state)?.id ?? '',
    host_id: state.hostId,
    deadline_at: deadlineFor(state, config, now),
    status: statusFor(state),
  };
}

function deadlineFor(state: RouletteState, config: RouletteConfig, now: number): number {
  if (state.phase === 'playing') return now + config.turnTimeoutSeconds * 1000;
  if (state.phase === 'lobby') return now + config.lobbyTimeoutSeconds * 1000;
  return 0;
}

function statusFor(state: RouletteState): RouletteSessionStatus {
  if (isOpen(state)) return 'active';
  if (state.phase === 'finished') return 'finished';
  return 'aborted';
}

/** Survivors win one point each; the loser records a loss. Aborted games record nothing. */
function projectRouletteOutcomes(session: Readonly<RouletteSessionRow>): readonly GameOutcome[] {
  if (session.status !== 'finished') return [];
  const state = decodeRouletteState(session.state_json);
  return state.players.map((player) => {
    const lost = player.id === state.loserId;
    return {
      userId: player.id,
      userName: player.name,
      result: lost ? 'lost' : 'won',
      score: lost ? 0 : 1,
    };
  });
}
