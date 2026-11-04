/**
 * Console「掘金评论审批」页的插件 RPC（`plugin.<pluginId>.status` / 动作）。
 *
 * - 只返回页面需要的字段：登录态（不含 Cookie）、白名单文章、待审草稿。
 * - 动作都声明了 requiredPermissions：普通用户令牌只有持有对应权限才能操作（未声明 = 仅管理员）。
 * - 配置（白名单、sendMode、Cookie 等）不在这里改：用 YAML / 环境变量 / config:patch。
 */
import { definePluginConsoleRpc, PluginConsoleRpcError, type PluginConsoleRpc, type PluginConsoleRpcInput, type PluginConsoleRpcCall, type PluginConsoleRpcJson } from 'zhin.js';
import { isLocale, type Locale } from 'zhin.js/i18n';
import { juejinEndpoints, type JuejinEndpointDirectory, type JuejinEndpointView } from './endpoint-directory.js';
import { JuejinReviewError } from './endpoint.js';
import { draftArticleUrl, findDraft, reviewErrorText } from './review.js';

export const JUEJIN_CONSOLE_PAGE = 'index';
/** 看页面与状态。 */
export const JUEJIN_READ_PERMISSION = 'juejin:read';
/** 改写 / 丢弃 / 发送草稿。 */
export const JUEJIN_REVIEW_PERMISSION = 'juejin:review';
/** 重新检查登录态。 */
export const JUEJIN_LOGIN_PERMISSION = 'juejin:login';

const DRAFTS_PER_ENDPOINT = 50;

function localeOf(input: PluginConsoleRpcInput): Locale | undefined {
  return typeof input.locale === 'string' && isLocale(input.locale) ? input.locale : undefined;
}

function requireString(input: PluginConsoleRpcInput, key: string, label: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim()) throw new PluginConsoleRpcError('invalid_input', `缺少${label}`);
  return value.trim();
}

function pickEndpoint(registry: JuejinEndpointDirectory, input: PluginConsoleRpcInput): JuejinEndpointView {
  const id = typeof input.endpoint === 'string' ? input.endpoint.trim() : '';
  if (id) {
    const endpoint = registry.get(id);
    if (!endpoint) throw new PluginConsoleRpcError('not_found', `找不到账号 ${id}`);
    return endpoint;
  }
  const [first, second] = registry.values();
  if (!first) throw new PluginConsoleRpcError('unavailable', '掘金适配器还没有启动');
  if (second) throw new PluginConsoleRpcError('invalid_input', '有多个账号，请先选择一个');
  return first;
}

function reviewFailure(id: string, error: unknown, locale?: Locale): never {
  if (error instanceof PluginConsoleRpcError) throw error;
  const message = reviewErrorText(id, error, locale);
  if (error instanceof JuejinReviewError) {
    const code = error.code === 'not_found' ? 'not_found'
      : error.code === 'busy' || error.code === 'rate_limited' || error.code === 'unknown_outcome' ? 'conflict'
        : error.code === 'invalid_message' ? 'invalid_input' : 'unavailable';
    throw new PluginConsoleRpcError(code, message);
  }
  throw new PluginConsoleRpcError('unavailable', message);
}

function endpointView(endpoint: JuejinEndpointView) {
  const login = endpoint.login;
  const circuit = endpoint.circuitBreaker;
  const drafts = endpoint.drafts.list().slice(-DRAFTS_PER_ENDPOINT).reverse();
  return {
    id: endpoint.localId,
    sendMode: endpoint.sendMode,
    persistent: endpoint.persistent,
    circuit: circuit ? { code: circuit.code } : null,
    login: {
      state: login.state,
      ...(login.userId ? { userId: login.userId } : {}),
      ...(login.userName ? { userName: login.userName } : {}),
    },
    articles: endpoint.articles.map(article => ({ id: article.id, url: article.url })),
    pendingCount: endpoint.drafts.size,
    drafts: drafts.map(draft => ({
      id: draft.id,
      url: draftArticleUrl(draft),
      articleId: draft.articleId,
      message: draft.message,
      status: draft.status ?? 'pending',
      interrupted: draft.interrupted === true,
      createdAt: draft.createdAt,
      ...(draft.updatedAt ? { updatedAt: draft.updatedAt } : {}),
      ...(draft.context ? { author: draft.context.author, original: draft.context.text } : {}),
    })),
  };
}

function scopedRegistry(operation: (directory: JuejinEndpointDirectory, input: PluginConsoleRpcInput) => PluginConsoleRpcJson | Promise<PluginConsoleRpcJson>) {
  return (input: PluginConsoleRpcInput, call: PluginConsoleRpcCall): PluginConsoleRpcJson | Promise<PluginConsoleRpcJson> => {
    const runtime = call.runtime;
    if (!runtime) throw new PluginConsoleRpcError('unsupported', 'Juejin Adapter directory is unavailable');
    const directory = juejinEndpoints({ owner: runtime.owner, signal: call.signal, project: feature => runtime.project(feature) });
    return operation(directory, input);
  };
}

export function createJuejinConsoleRpc(): PluginConsoleRpc {
  const page = JUEJIN_CONSOLE_PAGE;
  const review = [JUEJIN_REVIEW_PERMISSION];
  return definePluginConsoleRpc({
    status: {
      page,
      requiredPermissions: [JUEJIN_READ_PERMISSION],
      handler: scopedRegistry((registry) => ({
        endpoints: [...registry.values()].map(endpointView),
        updatedAt: Date.now(),
      })),
    },
    actions: {
      send: {
        page, requiredPermissions: review,
        handler: scopedRegistry(async (registry, input) => {
          const id = requireString(input, 'id', '草稿 ID');
          const found = findDraft(registry, id);
          if (!found) throw new PluginConsoleRpcError('not_found', reviewErrorText(id, new JuejinReviewError('not_found', id), localeOf(input)));
          try {
            const { draft, replyId } = await found.endpoint.approveDraft(id);
            return { id, url: draftArticleUrl(draft), ...(replyId ? { replyId } : {}) };
          } catch (error) { return reviewFailure(id, error, localeOf(input)); }
        }),
      },
      edit: {
        page, requiredPermissions: review,
        handler: scopedRegistry(async (registry, input) => {
          const id = requireString(input, 'id', '草稿 ID');
          const message = typeof input.message === 'string' ? input.message : '';
          const found = findDraft(registry, id);
          if (!found) throw new PluginConsoleRpcError('not_found', reviewErrorText(id, new JuejinReviewError('not_found', id), localeOf(input)));
          try {
            const draft = found.endpoint.editDraft(id, message);
            return { id, message: draft.message };
          } catch (error) { return reviewFailure(id, error, localeOf(input)); }
        }),
      },
      drop: {
        page, requiredPermissions: review,
        handler: scopedRegistry(async (registry, input) => {
          const id = requireString(input, 'id', '草稿 ID');
          const found = findDraft(registry, id);
          if (!found) throw new PluginConsoleRpcError('not_found', reviewErrorText(id, new JuejinReviewError('not_found', id), localeOf(input)));
          try {
            return { id, dropped: found.endpoint.discardDraft(id) };
          } catch (error) { return reviewFailure(id, error, localeOf(input)); }
        }),
      },
      'login-check': {
        page, requiredPermissions: [JUEJIN_LOGIN_PERMISSION],
        handler: scopedRegistry(async (registry, input) => {
          try {
            const login = await pickEndpoint(registry, input).recheckLogin();
            return { state: login.state, ...(login.userId ? { userId: login.userId } : {}), ...(login.userName ? { userName: login.userName } : {}) };
          } catch (error) {
            if (error instanceof PluginConsoleRpcError) throw error;
            throw new PluginConsoleRpcError('unavailable', '检查登录失败，请稍后再试');
          }
        }),
      },
    },
  });
}
