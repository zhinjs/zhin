import { plainTextFromSendContent, type GameMessageLike } from '@zhin.js/game-kit';
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

export async function sendOrEditScene(
  services: GameServices,
  message: GameMessageLike,
  session: AdvSessionRow,
  extraNarrative = '',
  profile?: AdvProfileRow,
): Promise<string> {
  const prof = profile
    ?? await services.profiles.getOrCreate(session.player_id, session.player_name);
  const content = buildSceneInteractive(session, extraNarrative, prof, message.$channel.type);
  if (!content) {
    return '场景数据异常，请 adv quit 后重新开始。';
  }
  return plainTextFromSendContent(content);
}

export async function startAdventure(
  services: GameServices,
  message: GameMessageLike,
): Promise<string | undefined> {
  const ch = `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`;
  const active = await services.sessions.getActiveByChannel(ch);
  if (active) {
    if (active.player_id === message.$sender.id) {
      return '你已有进行中的冒险。发送 adv continue 继续，或 adv quit 放弃。';
    }
    return `本频道已有玩家 ${active.player_name} 的冒险进行中。`;
  }

  await services.profiles.onRunStarted(message.$sender.id, message.$sender.name?.trim() || message.$sender.id);
  const session = await services.sessions.createSession(message);
  await services.profiles.onStep(
    message.$sender.id,
    session.player_name,
    'start',
    [],
  );
  return sendOrEditScene(services, message, session);
}

export async function handleChoice(
  services: GameServices,
  message: GameMessageLike,
  sessionId: string,
  choiceId: string,
): Promise<string | null> {
  const session = await services.sessions.getById(sessionId);
  // 踏进 terminal 场景时 status 必为 completed，终局需放行「再玩一次」（restart）
  if (!session || (session.status !== 'active' && !(session.status === 'completed' && choiceId === 'restart'))) {
    return '冒险不存在或已结束。';
  }
  if (session.player_id !== message.$sender.id) {
    return '这是别人的冒险。';
  }

  const state = stateFromSession(session);
  const scene = getScene(state.sceneId);
  if (!scene) return '场景丢失，请 adv quit 后重新开始。';

  if (scene.terminal && choiceId !== 'restart') {
    return '本局已结束，请点击「再玩一次」或发送 adv start。';
  }

  if (choiceId === 'restart') {
    await services.sessions.updateSession(session.id, {
      scene_id: 'start',
      hp: 100,
      inventory: '[]',
      flags: '{}',
      ending_id: '',
      status: 'active',
      step_count: 0,
      board_message_id: '',
    });
    const updated = (await services.sessions.getById(session.id))!;
    await services.profiles.onRunStarted(updated.player_id, updated.player_name);
    await services.profiles.onStep(updated.player_id, updated.player_name, 'start', []);
    return sendOrEditScene(services, message, updated);
  }

  // 服务端校验：选项必须当前可见（requires 门槛不能只靠视图层过滤，payload 可绕过）
  if (!visibleChoices(scene, state).some((c) => c.id === choiceId)) {
    return '该选项不可用。';
  }

  const result = resolveChoice(state, choiceId);
  if (!result) return '该选项不可用。';

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
  const extra = formatNewAchievements(newAchievements);
  return sendOrEditScene(services, message, updated, extra);
}

export async function continueAdventure(
  services: GameServices,
  message: GameMessageLike,
): Promise<string> {
  const session = await services.sessions.getActiveForUser(
    `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`,
    message.$sender.id,
  );
  if (!session) return '你没有进行中的冒险，发送 adv start 开始。';
  return sendOrEditScene(services, message, session);
}

export function sessionSummary(session: AdvSessionRow): string {
  const scene = getScene(session.scene_id);
  const state = stateFromSession(session);
  const items = state.inventory;
  const lines = [
    `冒险 ${session.id}`,
    `玩家：${session.player_name}`,
    `场景：${scene?.id ?? session.scene_id}`,
    `生命：${session.hp}`,
    `物品：${items.length ? items.join(', ') : '无'}`,
    `步数：${session.step_count}`,
    `状态：${session.status}`,
  ];
  if (session.ending_id) lines.push(`结局：${session.ending_id}`);
  return lines.join('\n');
}
