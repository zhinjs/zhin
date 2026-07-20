/**
 * 选项式交互键盘（文字冒险、问答、剧情分支等）
 */
import { segment, type SendContent } from '@zhin.js/core';
import { applyInteractionProfile, type InteractionProfile } from './interaction-profiles.js';

export interface ChoiceOption {
  /** 选项 ID，写入 payload */
  id: string;
  label: string;
  disabled?: boolean;
  style?: 'primary' | 'danger' | 'secondary';
  /** 终局菜单（如「再来一局」）保持可点 */
  keepEnabledWhenTerminal?: boolean;
}

export interface ChoiceKeyboardOptions {
  gamePrefix: string;
  sessionId: string;
  /** 剧情/题干正文 */
  narrative: string;
  choices: ChoiceOption[];
  terminal?: boolean;
  /** 文本 fallback 提示 */
  fallbackHint?: string;
  /** 每行最多几个按钮（默认全部一行） */
  buttonsPerRow?: number;
  /** 交互 profile：menu→command，gameplay→callback，terminal→command */
  interactionProfile?: InteractionProfile;
  /** terminal profile 私聊 auto-enter 用 */
  channelType?: string;
}

export function buildChoiceFallbackMap(
  gamePrefix: string,
  sessionId: string,
  choices: ChoiceOption[],
): Record<string, string> {
  const map: Record<string, string> = {};
  let n = 1;
  for (const choice of choices) {
    if (!choice.disabled) {
      map[String(n)] = `${gamePrefix}:${sessionId}:${choice.id}`;
      n++;
    }
  }
  return map;
}

function chunkChoices<T>(items: T[], size: number): T[][] {
  if (size <= 0 || items.length <= size) return [items];
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

/**
 * 构建选项键盘消息：正文 + 一行或多行按钮
 */
export function buildChoiceKeyboard(options: ChoiceKeyboardOptions): SendContent {
  const {
    gamePrefix,
    sessionId,
    narrative,
    choices,
    terminal,
    fallbackHint,
    buttonsPerRow,
    interactionProfile,
    channelType,
  } = options;

  const enabled = choices.filter((c) => !c.disabled);
  const buttonRows = chunkChoices(enabled, buttonsPerRow ?? enabled.length).map((row) =>
    row.map((choice) => {
      const base = segment.button({
        id: choice.id,
        label: choice.label,
        payload: `${gamePrefix}:${sessionId}:${choice.id}`,
        disabled: choice.disabled || (terminal && !choice.keepEnabledWhenTerminal),
        style: choice.style ?? 'secondary',
      });
      const data = base.data;
      if (!interactionProfile) return base;
      return segment.button(
        applyInteractionProfile(data, { profile: interactionProfile, channelType }),
      );
    }),
  );

  const fallback = buildChoiceFallbackMap(gamePrefix, sessionId, choices);

  return [
    segment.text(narrative),
    segment.keyboard(buttonRows, {
      fallback: fallbackHint && Object.keys(fallback).length > 0
        ? { hint: fallbackHint, map: fallback }
        : undefined,
    }).toElement(),
  ];
}

/**
 * 解析选项 payload：`{prefix}:{sessionId}:{choiceId}`
 */
export function parseChoicePayload(
  payload: string,
  expectedPrefix?: string,
): { prefix: string; sessionId: string; choiceId: string } | null {
  const m = /^([a-z0-9_]+):([^:]+):([a-z0-9_-]+)$/i.exec(payload);
  if (!m) return null;
  const prefix = m[1]!;
  if (expectedPrefix && prefix !== expectedPrefix) return null;
  return { prefix, sessionId: m[2]!, choiceId: m[3]! };
}
