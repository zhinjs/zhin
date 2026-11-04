import { createMessages, resolveLocale } from 'zhin.js/i18n';
import {
  GameSessionConflictError,
  SessionRevisionConflictError,
  channelKey,
  type GamePlayer,
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
  message: GamePlayer,
): Promise<GameReply> {
  return service.runInScope({ scope: channelKey(message), run: async () => {
    const active = await service.getActiveByChannel(channelKey(message));
    if (active) return buildDungeonView(active, stateFromSession(active), message.target.kind);
    try {
      const session = await service.createSession(message);
      return buildDungeonView(session, stateFromSession(session), message.target.kind);
    } catch (error) {
      if (error instanceof GameSessionConflictError) return error.format(message.locale);
      throw error;
    }
  } });
}

export async function continueDungeon(
  service: SessionService,
  message: GamePlayer,
): Promise<GameReply> {
  return service.runInScope({ scope: channelKey(message), run: async () => {
    const locale = resolveLocale(message.locale);
    const session = await service.getActiveByChannel(channelKey(message));
    if (!session) return messages(locale, 'text1');
    return buildDungeonView(session, stateFromSession(session), message.target.kind);
  } });
}

export async function handleDungeonChoice(
  service: SessionService,
  message: GamePlayer,
  sessionToken: string,
  choiceId: string,
): Promise<GameReply> {
  return service.runInScope({ scope: channelKey(message), run: async () => {
    let locale = resolveLocale(message.locale);
    const token = parseDungeonSessionToken(sessionToken);
    if (!token) return messages(locale, 'text2');
    const session = await service.getById(token.sessionId);
    if (!session || session.channel_key !== channelKey(message)) {
      return messages(locale, 'text3');
    }
    locale = resolveLocale(session.locale);
    if (choiceId === 'restart') {
      if (session.status === 'active') return messages(locale, 'text4');
      if (session.owner_id !== message.sender.id) return messages(locale, 'text5');
      return startDungeon(service, message);
    }
    const action = actionFromChoice(choiceId, message);
    if (!action) return messages(locale, 'text6');
    try {
      const result = await service.performAction({
        sessionId: session.id,
        actorId: message.sender.id,
        actorName: message.sender.name?.trim() || message.sender.id,
        action,
        expectedRevision: token.revision,
        actionId: `${session.id}:${token.revision}:${message.sender.id}:${choiceId}`,
      });
      return buildDungeonView(
        result.session,
        stateFromSession(result.session),
        message.target.kind,
      );
    } catch (error) {
      if (error instanceof DungeonRuleError) return error.message;
      if (error instanceof GameSessionConflictError) return error.format(locale);
      if (error instanceof SessionRevisionConflictError) {
        const latest = await service.getById(session.id);
        if (!latest) return messages(locale, 'text7');
        const view = buildDungeonView(
          latest,
          stateFromSession(latest),
          message.target.kind,
        );
        return Array.isArray(view)
          ? [messages(locale, 'text8'), ...view]
          : [messages(locale, 'text8'), view];
      }
      throw error;
    }
  } });
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
  message: GamePlayer,
): DungeonAction | null {
  if (choiceId === 'join') {
    return {
      type: 'join',
      name: message.sender.name?.trim() || message.sender.id,
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

const messages = createMessages({
  text1: { 'zh-CN': "当前频道没有进行中的地牢远征。", en: "There is no active dungeon expedition in this channel." },
  text2: { 'zh-CN': "无效的地牢操作。", en: "Invalid dungeon action." },
  text3: { 'zh-CN': "远征不存在，或不属于当前频道。", en: "The expedition does not exist or belongs to another channel." },
  text4: { 'zh-CN': "当前远征尚未结束。", en: "The current expedition has not ended." },
  text5: { 'zh-CN': "只有原队长可以重新创建远征。", en: "Only the original leader may restart the expedition." },
  text6: { 'zh-CN': "未知的地牢操作。", en: "Unknown dungeon action." },
  text7: { 'zh-CN': "远征状态已变化，请重新打开当前界面。", en: "The expedition state changed. Reopen its current view." },
  text8: { 'zh-CN': "操作来自旧回合，已为你刷新最新状态。", en: "This action was from an earlier turn. The latest state is shown below." },
});
