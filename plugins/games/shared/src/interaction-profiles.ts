import type { ButtonCommandOptions, ButtonData, ButtonInteractionMode } from 'zhin.js';

/** 交互模式预设：见 ADR 0022 / docs/essentials/interactive-segments.md */
export type InteractionProfile = 'menu' | 'gameplay' | 'terminal';

export interface ApplyInteractionProfileOptions {
  profile: InteractionProfile;
  /** 用于 terminal profile：私聊可 auto-enter */
  channelType?: string;
}

function defaultModeForProfile(
  profile: InteractionProfile,
  channelType?: string,
): ButtonInteractionMode {
  if (profile === 'gameplay') return 'callback';
  // 群/频道大厅为共享 UI，须 callback，否则仅 opener 有文本 fallback 上下文
  if (profile === 'menu' && channelType && channelType !== 'private') return 'callback';
  return 'command';
}

function defaultCommandForProfile(
  profile: InteractionProfile,
  channelType?: string,
): ButtonCommandOptions | undefined {
  if (profile !== 'terminal') return undefined;
  return { enter: channelType === 'private' };
}

/**
 * 按 profile 注入 button.mode（显式 mode 优先）。
 * - menu / terminal → command
 * - gameplay → callback
 */
export function applyInteractionProfile(
  btn: ButtonData,
  options: ApplyInteractionProfileOptions,
): ButtonData {
  if (btn.mode != null) return btn;
  const mode = defaultModeForProfile(options.profile, options.channelType);
  const commandDefaults = defaultCommandForProfile(options.profile, options.channelType);
  return {
    ...btn,
    mode,
    command: commandDefaults
      ? { ...commandDefaults, ...btn.command }
      : btn.command,
  };
}

export function applyInteractionProfileToButtons(
  buttons: ButtonData[],
  options: ApplyInteractionProfileOptions,
): ButtonData[] {
  return buttons.map((btn) => applyInteractionProfile(btn, options));
}
