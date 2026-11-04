import {  createMessages, resolveLocale } from 'zhin.js/i18n';
import { channelKey, gameCommandHint, type GamePlayer, type GameReply } from '@zhin.js/game-kit';
import { regionLabel, endingLabel } from './story-catalog.js';
import { itemLabel } from './story-items.js';
import type { AdvProfileRow, AdvSessionRow } from './models.js';
import { formatNewAchievements } from './profile-format.js';
import { buildSceneInteractive } from './scene-view.js';
import {
  applyChoiceResult,
  getScene,
  resolveChoice,
  stateFromSession,
  visibleChoices,
} from './story.js';
import type { GameServices } from './session-service.js';

export interface AdventureSceneView {
  readonly services: GameServices;
  readonly player: GamePlayer;
  readonly session: AdvSessionRow;
  readonly extraNarrative?: string;
  /** A profile already loaded by the same action; absent means load it through the service. */
  readonly profile?: AdvProfileRow;
}

export async function renderAdventureScene(input: AdventureSceneView): Promise<GameReply> {
  const { services, player: message, session, extraNarrative = '', profile } = input;
  return services.sessions.runInScope({ scope: channelKey(message), run: async () => {
    const prof = profile
      ?? await services.profiles.getOrCreate(session.player_id, session.player_name);
    const content = buildSceneInteractive(session, extraNarrative, prof, message.target.kind);
    if (!content) {
      return messages(resolveLocale(session.locale), 'invalidScene');
    }
    return content;
  } });
}

export async function startAdventure(
  services: GameServices,
  message: GamePlayer,
): Promise<GameReply | undefined> {
  return services.sessions.runInScope({ scope: channelKey(message), run: async () => {
    const ch = channelKey(message);
    const active = await services.sessions.getActiveByChannel(ch);
    if (active) {
      if (active.player_id === message.sender.id) {
        const locale = resolveLocale(active.locale);
        const command = message.formatCommand?.('adv');
        return messages(locale, 'active') + (command === undefined ? '' : messages(locale, 'activeHint', { command }));
      }
      return messages(resolveLocale(message.locale), 'channelBusy', { player: active.player_name });
    }

    await services.profiles.onRunStarted(message.sender.id, message.sender.name?.trim() || message.sender.id);
    const session = await services.sessions.createSession(message);
    await services.profiles.onStep(
      message.sender.id,
      session.player_name,
      'start',
      [],
    );
    return renderAdventureScene({ services: services, player: message, session: session });
  } });
}

export async function handleChoice(
  services: GameServices,
  message: GamePlayer,
  sessionId: string,
  choiceId: string,
): Promise<GameReply | null> {
  return services.sessions.runInScope({ scope: channelKey(message), run: async () => {
    const session = await services.sessions.getById(sessionId);
    const locale = resolveLocale(session ? session.locale : message.locale);
    // 踏进 terminal 场景时 status 必为 completed，终局需放行「再玩一次」（restart）
    if (!session || (session.status !== 'active' && !(session.status === 'completed' && choiceId === 'restart'))) {
      return messages(locale, 'ended');
    }
    if (session.player_id !== message.sender.id) {
      return messages(locale, 'otherPlayer');
    }

    const state = stateFromSession(session);
    const scene = getScene(state.sceneId);
    if (!scene) return messages(locale, 'invalidScene');

    if (scene.terminal && choiceId !== 'restart') {
      return messages(locale, 'restart');
    }

    if (choiceId === 'restart') {
      await services.sessions.updateSession(session.id, {
        scene_id: 'start',
        locale: resolveLocale(message.locale),
        hp: 100,
        inventory: '[]',
        flags: '{}',
        ending_id: '',
        status: 'active',
        step_count: 0,
      });
      const updated = (await services.sessions.getById(session.id))!;
      await services.profiles.onRunStarted(updated.player_id, updated.player_name);
      await services.profiles.onStep(updated.player_id, updated.player_name, 'start', []);
      return renderAdventureScene({ services: services, player: message, session: updated });
    }

    // 服务端校验：选项必须当前可见（requires 门槛不能只靠视图层过滤，payload 可绕过）
    if (!visibleChoices(scene, state).some((c) => c.id === choiceId)) {
      return messages(locale, 'unavailable');
    }

    const result = resolveChoice(state, choiceId);
    if (!result) return messages(locale, 'unavailable');

    const next = applyChoiceResult(state, result);
    const nextScene = getScene(next.sceneId);
    const completed = !!nextScene?.terminal || next.hp <= 0;

    if (next.hp <= 0 && !nextScene?.terminal) {
      next.sceneId = 'defeat';
    }

    const finalScene = getScene(next.sceneId);
    const status = completed || finalScene?.terminal ? 'completed' : 'active';
    const newStepCount = session.step_count + 1;

    await services.sessions.updateSession(session.id, {
      scene_id: next.sceneId,
      hp: next.hp,
      inventory: JSON.stringify(next.inventory),
      flags: JSON.stringify(next.flags),
      ending_id: next.endingId,
      status,
      step_count: newStepCount,
    });

    const endingId = next.endingId || (finalScene?.terminal ? next.sceneId : '');
    let newAchievements = await services.profiles.onStep(
      session.player_id,
      session.player_name,
      next.sceneId,
      next.inventory,
    );
    if (status === 'completed') {
      const more = await services.profiles.onRunCompleted(
        session.player_id,
        session.player_name,
        endingId,
        newStepCount,
        next.inventory,
      );
      newAchievements = [...new Set([...newAchievements, ...more])];
    }

    const updated = (await services.sessions.getById(session.id))!;
    const extra = formatNewAchievements(newAchievements, locale);
    return renderAdventureScene({ services: services, player: message, session: updated, extraNarrative: extra });
  } });
}

export async function continueAdventure(
  services: GameServices,
  message: GamePlayer,
): Promise<GameReply> {
  return services.sessions.runInScope({ scope: channelKey(message), run: async () => {
    const session = await services.sessions.getActiveForUser(
      channelKey(message),
      message.sender.id,
    );
    if (!session) return messages(resolveLocale(message.locale), 'noGame') + gameCommandHint(message, 'adv');
    return renderAdventureScene({ services: services, player: message, session: session });
  } });
}

export function sessionSummary(session: AdvSessionRow): string {
  const locale = resolveLocale(session.locale);
  const state = stateFromSession(session);
  const lines = [
    messages(locale, 'summary', {
      id: session.id,
      player: session.player_name,
      scene: regionLabel(session.scene_id, locale),
      hp: session.hp,
      items: state.inventory.length ? state.inventory.map((id) => itemLabel(id, locale)).join(', ') : messages(locale, 'none'),
      steps: session.step_count,
      status: messages(locale, session.status === 'active' ? 'activeStatus' : session.status === 'completed' ? 'completedStatus' : 'abortedStatus'),
    }),
  ];
  if (session.ending_id) lines.push(messages(locale, 'ending', { ending: endingLabel(session.ending_id, locale) }));
  return lines.join('\n');
}

const messages = createMessages({
  invalidScene: { 'zh-CN': '场景数据异常，请结束当前冒险后重新开始。', en: 'The scene is unavailable. End this adventure and start again.' },
  active: { 'zh-CN': '你已有进行中的冒险。', en: 'You already have an active adventure.' },
  activeHint: { 'zh-CN': '发送「{command} continue」继续，或「{command} quit」放弃。', en: 'Send “{command} continue” to continue or “{command} quit” to leave.' },
  channelBusy: { 'zh-CN': '本频道已有玩家 {player} 的冒险进行中。', en: '{player} already has an adventure in progress in this channel.' },
  ended: { 'zh-CN': '冒险不存在或已结束。', en: 'This adventure does not exist or has ended.' },
  otherPlayer: { 'zh-CN': '这是别人的冒险。', en: 'This adventure belongs to another player.' },
  restart: { 'zh-CN': '本局已结束，请点击「再玩一次」开始新冒险。', en: 'This adventure has ended. Select “Play again” to start a new one.' },
  unavailable: { 'zh-CN': '该选项不可用。', en: 'That choice is not available.' },
  noGame: { 'zh-CN': '你没有进行中的冒险。', en: 'You have no active adventure.' },
  none: { 'zh-CN': '无', en: 'None' },
  activeStatus: { 'zh-CN': '进行中', en: 'Active' },
  completedStatus: { 'zh-CN': '已完成', en: 'Completed' },
  abortedStatus: { 'zh-CN': '已放弃', en: 'Abandoned' },
  summary: {
    'zh-CN': '冒险 {id}\n玩家：{player}\n场景：{scene}\n生命：{hp}\n物品：{items}\n步数：{steps}\n状态：{status}',
    en: 'Adventure {id}\nPlayer: {player}\nScene: {scene}\nHealth: {hp}\nItems: {items}\nSteps: {steps}\nStatus: {status}',
  },
  ending: { 'zh-CN': '结局：{ending}', en: 'Ending: {ending}' },
});
