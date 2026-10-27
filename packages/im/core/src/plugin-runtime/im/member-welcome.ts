/**
 * 入群欢迎归属（#1012 A9 方案②）。
 *
 * Agent 会话级欢迎（ADR 0037 切片 A，session-ops `welcome.enabled` + MemberLifecycle）由 Agent host 在根作用域提供本 token。
 * 插件里的旧欢迎（如 group-suite `welcomeMessage`）发送前先问归属：已被会话级欢迎接管的会话，插件不再发送，
 * 欢迎统一走 MemberLifecycle（合并窗口、小时上限、控制面、session-gate），避免同一次入群双发。
 * 未装 Agent（没有本资源）时插件保持原行为。
 */
import { createToken } from '@zhin.js/plugin-runtime';
import type { ConversationRef } from '@zhin.js/im-contract';

/** @public */
export interface MemberWelcomeOwner {
  /** 该会话的入群欢迎是否已由会话级欢迎接管（session-ops `welcome.enabled`）。只读内存，不发送、不写审计。 */
  ownsWelcome(conversation: ConversationRef): boolean;
}

/** @public */
export const memberWelcomeOwnerToken = createToken<MemberWelcomeOwner>('zhin.im.member-welcome-owner');
