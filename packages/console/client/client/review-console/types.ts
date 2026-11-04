import type React from 'react';
import type { PluginUiText } from '../ui/locale.js';

/** 评论草稿的线上视图（各适配器 `console.ts` 返回；字段名在两家适配器间一致）。 */
export interface ReviewDraftBase {
  readonly id: string;
  /** 原评论 / 原资源的链接。 */
  readonly url: string;
  readonly message: string;
  readonly status: 'pending' | 'sending';
  /** 上次发送被中断或结果未知：可能已经发出。 */
  readonly interrupted: boolean;
  readonly createdAt: number;
  readonly updatedAt?: number;
  readonly author?: string;
  readonly original?: string;
}

/** 一个账号（endpoint）的审批视图；登录细节由适配器自己的类型扩展。 */
export interface ReviewEndpointBase<D extends ReviewDraftBase = ReviewDraftBase> {
  readonly id: string;
  readonly sendMode: 'review' | 'off';
  readonly persistent: boolean;
  readonly circuit: { readonly code: number } | null;
  readonly login: { readonly state: 'none' | 'ok' | 'expired' };
  readonly pendingCount: number;
  readonly drafts: readonly D[];
}

export interface ReviewStatus<E extends ReviewEndpointBase = ReviewEndpointBase> {
  readonly endpoints: readonly E[];
  readonly updatedAt: number;
}

/** 传给 `renderLoginExtras` / `renderResources` 的页面能力。 */
export interface ReviewContext {
  readonly t: PluginUiText['t'];
  readonly locale: PluginUiText['locale'];
  /** 资源名词（随语言），如“视频” / “文章”。 */
  readonly noun: string;
  /** 正在执行的登录类动作（RPC 方法名）；没有则为 undefined。 */
  readonly pending: string | undefined;
  /**
   * 调用本账号的 RPC 动作（自动带上 `endpoint` 与 `locale`），成功后刷新状态，
   * 失败时在页面顶部显示可关闭的错误提示。
   */
  readonly act: (method: string) => Promise<void>;
}

/**
 * 一个适配器的“评论审批页”描述。共享页面负责账号区、登录状态、草稿卡片（修改 / 发送 / 丢弃）与提示，
 * 适配器只补充平台名称、文案和少量字段映射。
 */
export interface CommentReviewSpec<E extends ReviewEndpointBase<D>, D extends ReviewDraftBase> {
  /** 适配器 key，用来从页面清单解析 PluginId（如 `bilibili`）。 */
  readonly adapter: string;
  /** 界面里的平台名（中文 / 英文），如 `B 站` / `Bilibili`。 */
  readonly platform: { readonly zh: string; readonly en: string };
  /** 页头图标位的单个字。 */
  readonly mark: string;
  /** 资源名词，如 视频 / video。 */
  readonly resource: { readonly zh: string; readonly en: string };
  /** 适配器自己的文案翻译表：中文原文 → English。 */
  readonly dictionary?: Readonly<Record<string, string>>;
  /** 草稿卡片上“打开原评论”链接文案（中文原文），默认 `查看原评论`。 */
  readonly openLabel?: string;
  /** 登录账号：用于显示 `名称 · uid 编号`。 */
  readonly account: (endpoint: E) => { readonly id?: string; readonly name?: string };
  /** 草稿所属资源的显示名（如 `av123`、`文章 456`）。 */
  readonly draftResource: (draft: D, t: PluginUiText['t']) => string;
  /** 登录状态下方的说明（未登录 / 失效 / Cookie 来源…），返回 undefined 则不显示。 */
  readonly loginHint?: (endpoint: E, t: PluginUiText['t']) => string | undefined;
  /** 登录区的额外操作，如 Bilibili 的扫码登录。 */
  readonly renderLoginExtras?: (endpoint: E, context: ReviewContext) => React.ReactNode;
  /** 管理的资源列表（视频 / 文章…）；用 {@link ReviewResourceList} 排版。 */
  readonly renderResources?: (endpoint: E, context: ReviewContext) => React.ReactNode;
  /** 有登录流程在进行时（如二维码待扫描）要加快轮询。 */
  readonly isLoginPending?: (endpoint: E) => boolean;
  /** 常规轮询间隔，默认 10 秒。 */
  readonly pollMs?: number;
  /** 登录进行中的轮询间隔，默认 2 秒。 */
  readonly pendingPollMs?: number;
}
