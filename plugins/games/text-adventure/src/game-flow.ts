import type { Adapter, Message, Plugin } from '@zhin.js/core';
import { plainTextFromSendContent } from '@zhin.js/game-kit';
import type { AdvProfileRow, AdvSessionRow } from './models.js';
import { formatNewAchievements } from './profile-format.js';
import { buildSceneInteractive } from './scene-view.js';
import {
  applyChoiceResult,
  getScene,
  resolveChoice,
  stateFromSession,
} from './story.js';
import type { GameServices } from './session-service.js';

export async function sendOrEditScene(
  plugin: Plugin | null,
  services: GameServices,
  message: Message<any>,
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
  if (!plugin) return plainTextFromSendContent(content);

  const adapter = plugin.root.inject(message.$adapter) as Adapter;

  if (session.board_message_id) {
    const msgId = await adapter.editMessage({
      messageId: session.board_message_id,
      context: String(message.$adapter),
      endpoint: message.$endpoint,
      id: message.$channel.id,
      type: message.$channel.type,
      content,
    });
    if (msgId !== session.board_message_id) {
      await services.sessions.updateSession(session.id, { board_message_id: msgId });
    }
    return msgId;
  }

  const msgId = await message.$reply?.(content);
  if (msgId) {
    await services.sessions.updateSession(session.id, { board_message_id: msgId });
  }
  return msgId ?? '';
}

export async function startAdventure(
  plugin: Plugin | null,
  services: GameServices,
  message: Message<any>,
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
  const text = await sendOrEditScene(plugin, services, message, session);
  return plugin ? undefined : text;
}

export async function handleChoice(
  plugin: Plugin | null,
  services: GameServices,
  message: Message<any>,
  sessionId: string,
  choiceId: string,
): Promise<string | null> {
  const session = await services.sessions.getById(sessionId);
  if (!session || session.status !== 'active') {
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
    await services.profiles.onStep(updated.player_id, updated.player_name, 'start', []);
    const text = await sendOrEditScene(plugin, services, message, updated);
    // text-only 模式（plugin===null）下 sendOrEditScene 的唯一输出就是返回文本
    return plugin ? null : text;
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
  const text = await sendOrEditScene(plugin, services, message, updated, extra);
  // text-only 模式（plugin===null）下 sendOrEditScene 的唯一输出就是返回文本
  return plugin ? null : text;
}

export async function continueAdventure(
  plugin: Plugin | null,
  services: GameServices,
  message: Message<any>,
): Promise<string> {
  const session = await services.sessions.getActiveForUser(
    `${message.$adapter}-${message.$endpoint}-${message.$channel.type}:${message.$channel.id}`,
    message.$sender.id,
  );
  if (!session) return '你没有进行中的冒险，发送 adv start 开始。';
  const text = await sendOrEditScene(plugin, services, message, session);
  if (!plugin) return text;
  return '已刷新当前场景。';
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
