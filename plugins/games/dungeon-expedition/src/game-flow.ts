import {
  GameSessionConflictError,
  SessionRevisionConflictError,
  channelKey,
  type GameMessageLike,
  type GameReply,
} from '@zhin.js/game-kit';
import {
  DungeonRuleError,
  type DungeonAction,
} from './engine.js';
import type { DungeonSessionRow } from './models.js';
import {
  type SessionService,
  stateFromSession,
} from './session-service.js';
import {
  buildDungeonView,
  parseDungeonSessionToken,
} from './view.js';

export async function startDungeon(
  service: SessionService,
  message: GameMessageLike,
): Promise<GameReply> {
  const active = await service.getActiveByChannel(channelKey(message));
  if (active) return buildDungeonView(active, stateFromSession(active), message.$channel.type);
  try {
    const session = await service.createSession(message);
    return buildDungeonView(session, stateFromSession(session), message.$channel.type);
  } catch (error) {
    if (error instanceof GameSessionConflictError) return error.message;
    throw error;
  }
}

export async function continueDungeon(
  service: SessionService,
  message: GameMessageLike,
): Promise<GameReply> {
  const session = await service.getActiveByChannel(channelKey(message));
  if (!session) return '当前频道没有进行中的地牢远征。发送「地牢 开始」创建队伍。';
  return buildDungeonView(session, stateFromSession(session), message.$channel.type);
}

export async function handleDungeonChoice(
  service: SessionService,
  message: GameMessageLike,
  sessionToken: string,
  choiceId: string,
): Promise<GameReply> {
  const token = parseDungeonSessionToken(sessionToken);
  if (!token) return '无效的地牢操作。';
  const session = await service.getById(token.sessionId);
  if (!session || session.channel_key !== channelKey(message)) {
    return '远征不存在，或不属于当前频道。';
  }
  if (choiceId === 'restart') {
    if (session.status === 'active') return '当前远征尚未结束。';
    if (session.owner_id !== message.$sender.id) return '只有原队长可以重新创建远征。';
    return startDungeon(service, message);
  }
  const action = actionFromChoice(choiceId, message);
  if (!action) return '未知的地牢操作。';
  try {
    const result = await service.performAction({
      sessionId: session.id,
      actorId: message.$sender.id,
      actorName: message.$sender.name?.trim() || message.$sender.id,
      action,
      expectedRevision: token.revision,
      actionId: `${session.id}:${token.revision}:${message.$sender.id}:${choiceId}`,
    });
    return buildDungeonView(
      result.session,
      stateFromSession(result.session),
      message.$channel.type,
    );
  } catch (error) {
    if (error instanceof DungeonRuleError
      || error instanceof GameSessionConflictError) {
      return error.message;
    }
    if (error instanceof SessionRevisionConflictError) {
      const latest = await service.getById(session.id);
      if (!latest) return '远征状态已变化，请重新打开当前界面。';
      const view = buildDungeonView(
        latest,
        stateFromSession(latest),
        message.$channel.type,
      );
      return Array.isArray(view)
        ? ['操作来自旧回合，已为你刷新最新状态。', ...view]
        : ['操作来自旧回合，已为你刷新最新状态。', view];
    }
    throw error;
  }
}

export function commandActionId(
  session: DungeonSessionRow,
  actorId: string,
  choiceId: string,
): string {
  return `${session.id}:${session.revision}:${actorId}:${choiceId}`;
}

function actionFromChoice(
  choiceId: string,
  message: GameMessageLike,
): DungeonAction | null {
  if (choiceId === 'join') {
    return {
      type: 'join',
      name: message.$sender.name?.trim() || message.$sender.id,
    };
  }
  if (choiceId === 'ready') return { type: 'ready' };
  if (choiceId === 'start') return { type: 'start' };
  if (choiceId === 'explore') return { type: 'explore' };
  if (choiceId === 'attack') return { type: 'attack' };
  if (choiceId === 'defend') return { type: 'defend' };
  if (choiceId === 'potion') return { type: 'potion' };
  if (choiceId === 'abort') return { type: 'abort' };
  return null;
}
