import type {
  CommentReviewBlueprintSpec,
  CommentReviewDraftBase,
  CommentReviewEndpointBase,
} from '@zhin.js/console-contract';

/** 与插件 `src/console.ts` 返回的结构保持一致（只读视图）。 */
export interface JuejinDraft extends CommentReviewDraftBase {
  readonly articleId: string;
}

export interface JuejinEndpoint extends CommentReviewEndpointBase<JuejinDraft> {
  readonly login: {
    readonly state: 'none' | 'ok' | 'expired';
    readonly userId?: string;
    readonly userName?: string;
  };
  readonly articles: readonly { readonly id: string; readonly url: string }[];
}

export const spec: CommentReviewBlueprintSpec<JuejinEndpoint, JuejinDraft> = {
  adapter: 'juejin',
  platform: { zh: '掘金', en: 'Juejin' },
  mark: '掘',
  resource: { zh: '文章', en: 'articles' },
  loginMode: 'cookie-check',
  resourcesKey: 'articles',
  openLabel: '打开文章',
  account: (endpoint) => ({ id: endpoint.login.userId, name: endpoint.login.userName }),
  draftResource: (draft, t) => t('文章 {0}', draft.articleId),
  loginHint: ({ login }, t) =>
    login.state === 'none'
      ? t('未登录时只能读取公开评论，不能发送回复。请用 JUEJIN_COOKIE 环境变量注入 Cookie。')
      : login.state === 'expired'
        ? t('Cookie 已失效，草稿都保留着。更新 JUEJIN_COOKIE 后重启就能继续发送。')
        : t('Cookie 只来自配置 / 环境变量，不会经过这个页面，也不会写进数据目录。'),
  dictionary: {
    '打开文章': 'Open article',
    '文章 {0}': 'Article {0}',
    '未登录时只能读取公开评论，不能发送回复。请用 JUEJIN_COOKIE 环境变量注入 Cookie。':
      'Without signing in, only public comments are read and replies cannot be posted. Inject the cookie with the JUEJIN_COOKIE environment variable.',
    'Cookie 已失效，草稿都保留着。更新 JUEJIN_COOKIE 后重启就能继续发送。':
      'The cookie has expired. Drafts are kept; update JUEJIN_COOKIE and restart to keep sending.',
    'Cookie 只来自配置 / 环境变量，不会经过这个页面，也不会写进数据目录。':
      'The cookie only comes from config or environment; it never passes through this page or the data directory.',
    '重新检查登录': 'Check login again',
    '还没有配置文章。要管理哪些文章请在配置的 articles 里填写文章 id 或链接。':
      'No articles configured. Add article IDs or links under articles in the config.',
  },
};
