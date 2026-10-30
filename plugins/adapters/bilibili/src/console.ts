/**
 * Console「评论审批」页的插件 RPC（`plugin.<pluginId>.status` / 动作）。
 *
 * - 只返回页面需要的字段：登录态（不含 Cookie）、白名单视频、待审草稿。
 * - 动作都声明了 requiredPermissions：普通用户令牌只有持有对应权限才能操作（#977：未声明 = 仅管理员）。
 * - 配置（白名单视频、sendMode 等）不在这里改：用 YAML / config:patch。
 */
import { definePluginConsoleRpc, PluginConsoleRpcError, type PluginConsoleRpc, type PluginConsoleRpcInput, type PluginConsoleRpcCall, type PluginConsoleRpcJson } from 'zhin.js';
import { isLocale, type Locale } from 'zhin.js/i18n';
import { bilibiliEndpoints, type BilibiliEndpointDirectory, type BilibiliEndpointView } from './endpoint-directory.js';
import { BilibiliReviewError } from './endpoint.js';
import { draftCommentUrl, findDraft, reviewErrorText } from './review.js';

export const BILIBILI_CONSOLE_PAGE = 'index';
/** 看页面与状态。 */
export const BILIBILI_READ_PERMISSION = 'bilibili:read';
/** 改写 / 丢弃 / 发送草稿。 */
export const BILIBILI_REVIEW_PERMISSION = 'bilibili:review';
/** 扫码登录 / 退出登录。 */
export const BILIBILI_LOGIN_PERMISSION = 'bilibili:login';

const DRAFTS_PER_ENDPOINT = 50;

function localeOf(input: PluginConsoleRpcInput): Locale | undefined {
  return typeof input.locale === 'string' && isLocale(input.locale) ? input.locale : undefined;
}

function requireString(input: PluginConsoleRpcInput, key: string, label: string): string {
  const value = input[key];
  if (typeof value !== 'string' || !value.trim()) throw new PluginConsoleRpcError('invalid_input', `缺少${label}`);
  return value.trim();
}

function pickEndpoint(registry: BilibiliEndpointDirectory, input: PluginConsoleRpcInput): BilibiliEndpointView {
  const id = typeof input.endpoint === 'string' ? input.endpoint.trim() : '';
  if (id) {
    const endpoint = registry.get(id);
    if (!endpoint) throw new PluginConsoleRpcError('not_found', `找不到账号 ${id}`);
    return endpoint;
  }
  const [first, second] = registry.values();
  if (!first) throw new PluginConsoleRpcError('unavailable', 'B 站适配器还没有启动');
  if (second) throw new PluginConsoleRpcError('invalid_input', '有多个账号，请先选择一个');
  return first;
}

function reviewFailure(id: string, error: unknown, locale?: Locale): never {
  if (error instanceof PluginConsoleRpcError) throw error;
  const message = reviewErrorText(id, error, locale);
  if (error instanceof BilibiliReviewError) {
    const code = error.code === 'not_found' ? 'not_found'
      : error.code === 'busy' || error.code === 'rate_limited' ? 'conflict'
        : error.code === 'invalid_message' ? 'invalid_input' : 'unavailable';
    throw new PluginConsoleRpcError(code, message);
  }
  throw new PluginConsoleRpcError('unavailable', message);
}

function endpointView(endpoint: BilibiliEndpointView) {
  const login = endpoint.login;
  const qr = endpoint.qrLogin;
  const circuit = endpoint.circuitBreaker;
  const drafts = endpoint.drafts.list().slice(-DRAFTS_PER_ENDPOINT).reverse();
  return {
    id: endpoint.localId,
    sendMode: endpoint.sendMode,
    persistent: endpoint.persistent,
    circuit: circuit ? { code: circuit.code } : null,
    login: {
      state: login.state,
      ...(login.source ? { source: login.source } : {}),
      ...(login.mid ? { mid: login.mid } : {}),
      ...(login.uname ? { uname: login.uname } : {}),
      ...(login.expiresAt ? { expiresAt: login.expiresAt } : {}),
    },
    qr: {
      state: qr.state,
      ...(qr.image && (qr.state === 'waiting' || qr.state === 'scanned') ? { image: qr.image } : {}),
      ...(qr.expiresAt ? { expiresAt: qr.expiresAt } : {}),
      ...(qr.error ? { error: qr.error } : {}),
    },
    videos: endpoint.videos.map(video => ({
      ref: video.ref,
      url: `https://www.bilibili.com/video/${video.ref}`,
      ...(video.aid ? { aid: video.aid } : {}),
    })),
    pendingCount: endpoint.drafts.size,
    drafts: drafts.map(draft => ({
      id: draft.id,
      url: draftCommentUrl(draft),
      video: `av${draft.oid}`,
      message: draft.message,
      status: draft.status ?? 'pending',
      interrupted: draft.interrupted === true,
      createdAt: draft.createdAt,
      ...(draft.updatedAt ? { updatedAt: draft.updatedAt } : {}),
      ...(draft.context ? { author: draft.context.author, original: draft.context.text } : {}),
    })),
  };
}

function scopedRegistry(operation: (directory: BilibiliEndpointDirectory, input: PluginConsoleRpcInput) => PluginConsoleRpcJson | Promise<PluginConsoleRpcJson>) {
  return (input: PluginConsoleRpcInput, call: PluginConsoleRpcCall): PluginConsoleRpcJson | Promise<PluginConsoleRpcJson> => {
    const runtime = call.runtime;
    if (!runtime) throw new PluginConsoleRpcError('unsupported', 'Bilibili Adapter directory is unavailable');
    const directory = bilibiliEndpoints({ owner: runtime.owner, signal: call.signal, project: feature => runtime.project(feature) });
    return operation(directory, input);
  };
}

export function createBilibiliConsoleRpc(): PluginConsoleRpc {
  const page = BILIBILI_CONSOLE_PAGE;
  const review = [BILIBILI_REVIEW_PERMISSION];
  const login = [BILIBILI_LOGIN_PERMISSION];
  return definePluginConsoleRpc({
    status: {
      page,
      requiredPermissions: [BILIBILI_READ_PERMISSION],
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
          if (!found) throw new PluginConsoleRpcError('not_found', reviewErrorText(id, new BilibiliReviewError('not_found', id), localeOf(input)));
          try {
            const { rpid, draft } = await found.endpoint.approveDraft(id);
            return { id, url: draftCommentUrl({ oid: draft.oid, parent: rpid }) };
          } catch (error) { return reviewFailure(id, error, localeOf(input)); }
        }),
      },
      edit: {
        page, requiredPermissions: review,
        handler: scopedRegistry(async (registry, input) => {
          const id = requireString(input, 'id', '草稿 ID');
          const message = typeof input.message === 'string' ? input.message : '';
          const found = findDraft(registry, id);
          if (!found) throw new PluginConsoleRpcError('not_found', reviewErrorText(id, new BilibiliReviewError('not_found', id), localeOf(input)));
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
          if (!found) throw new PluginConsoleRpcError('not_found', reviewErrorText(id, new BilibiliReviewError('not_found', id), localeOf(input)));
          try {
            return { id, dropped: found.endpoint.discardDraft(id) };
          } catch (error) { return reviewFailure(id, error, localeOf(input)); }
        }),
      },
      login: {
        page, requiredPermissions: login,
        handler: scopedRegistry(async (registry, input) => {
          const qr = await pickEndpoint(registry, input).startQrLogin();
          if (qr.state === 'failed') throw new PluginConsoleRpcError('unavailable', qr.error ?? '获取二维码失败，请重试');
          return { state: qr.state, ...(qr.image ? { image: qr.image } : {}), ...(qr.expiresAt ? { expiresAt: qr.expiresAt } : {}) };
        }),
      },
      'login-cancel': {
        page, requiredPermissions: login,
        handler: scopedRegistry(async (registry, input) => {
          pickEndpoint(registry, input).cancelQrLogin();
          return { state: 'idle' };
        }),
      },
      logout: {
        page, requiredPermissions: login,
        handler: scopedRegistry(async (registry, input) => {
          const ok = await pickEndpoint(registry, input).logout();
          if (!ok) throw new PluginConsoleRpcError('unsupported', 'Cookie 来自配置 / 环境变量，请在那里修改');
          return { state: 'logged_out' };
        }),
      },
    },
  });
}
