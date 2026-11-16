/**
 * 选项式交互键盘（文字冒险、问答、剧情分支等）
 */
import { segment } from '@zhin.js/core';
import type { SendContent } from '@zhin.js/core/runtime';
import type { Locale } from '@zhin.js/plugin-runtime';
import { applyInteractionProfile, type InteractionProfile } from './interaction-profiles.js';
import { gameMessages } from './messages.js';
import { buildOrdinalFallbackMap, normalizeChoiceLabel } from './choice-label.js';

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
  /** 卡片语言（统一的「回复序号或按钮文字也可以」提示行） */
  locale?: Locale;
  /**
   * 正文末尾的统一回复提示（#1250）：`ordinal-or-label`（默认）=「回复序号或按钮文字也可以」；
   * `label` =「回复按钮文字也可以」（数字另有含义的游戏，如猜数字）；`false` 不加。
   */
  replyHint?: 'ordinal-or-label' | 'label' | false;
}

/** 游戏卡片统一的回复提示行（#1250 game-button-label-text-not-accepted）。 */
function choiceReplyHintLine(kind: 'ordinal-or-label' | 'label', locale?: Locale): string {
  return gameMessages(locale, kind === 'label' ? 'replyLabel' : 'replyOrdinalOrLabel');
}

/**
 * 入站文本 → payload 映射：序号（从 `startIndex` 起，跳过 disabled）与按钮文字
 * （去 emoji / 空白、不区分大小写，见 {@link resolveGameTextPayload}）都能命中。
 */
export function buildChoiceFallbackMap(
  gamePrefix: string,
  sessionId: string,
  choices: ChoiceOption[],
  /** 起始编号（默认 1）；拼在网格 fallback 之后时传空格数 +1，避免覆盖格子映射 */
  startIndex = 1,
): Record<string, string> {
  const map = buildOrdinalFallbackMap(gamePrefix, sessionId, choices, startIndex);
  for (const choice of choices) {
    if (choice.disabled) continue;
    const key = normalizeChoiceLabel(choice.label);
    if (key && !/^\d+$/u.test(key) && !(key in map)) map[key] = `${gamePrefix}:${sessionId}:${choice.id}`;
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
    locale,
    replyHint = 'ordinal-or-label',
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

  const fallback = buildOrdinalFallbackMap(gamePrefix, sessionId, choices, 1);
  const actionable = enabled.length > 0 && !(terminal && enabled.every(choice => !choice.keepEnabledWhenTerminal));
  const text = replyHint && actionable ? `${narrative}\n${choiceReplyHintLine(replyHint, locale)}` : narrative;

  return [
    segment.text(text),
    segment.keyboard(buttonRows, {
      // 不支持按钮的端点（能力画像 interactive: 'text'）把按钮渲染成一行『1. 要牌  2. 停牌』。
      fallback: Object.keys(fallback).length > 0
        ? { hint: fallbackHint ?? '', map: fallback, layout: 'inline' }
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
  const [, prefix, sessionId, choiceId] = m;
  if (!prefix || !sessionId || !choiceId) return null;
  if (expectedPrefix && prefix !== expectedPrefix) return null;
  return { prefix, sessionId, choiceId };
}
