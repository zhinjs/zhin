/**
 * KOOK msg_id 路由：频道 / 私聊 API 路径不同，出站编码路由、入站/删除按路由命中。
 */

export type KookMsgRoute = 'channel' | 'direct';

export function routeFromSceneType(
  sceneType?: 'private' | 'group' | 'channel',
): KookMsgRoute | undefined {
  if (sceneType === 'private') return 'direct';
  if (sceneType === 'group' || sceneType === 'channel') return 'channel';
  return undefined;
}

export function routeFromSendType(type: 'private' | 'group' | 'channel'): KookMsgRoute {
  return type === 'private' ? 'direct' : 'channel';
}

/** 出站 send 返回值，供 recall / typing 删除时走路由 */
export function encodeKookMsgRef(route: KookMsgRoute, msgId: string): string {
  return `kook:${route}:${msgId}`;
}

export function parseKookMsgRef(ref: string): { route?: KookMsgRoute; msgId: string } {
  const parts = ref.split(':');
  if (parts[0] === 'kook' && (parts[1] === 'channel' || parts[1] === 'direct') && parts.length >= 3) {
    return { route: parts[1], msgId: parts.slice(2).join(':') };
  }
  return { msgId: ref };
}

export function plainKookMsgId(ref: string): string {
  return parseKookMsgRef(ref).msgId;
}

export function resolveKookRoutes(
  action: 'add' | 'delete',
  routeHint?: KookMsgRoute,
): KookMsgRoute[] {
  if (action === 'delete' && routeHint) return [routeHint];
  if (routeHint) return [routeHint, routeHint === 'channel' ? 'direct' : 'channel'];
  return ['channel', 'direct'];
}

function isKookGoneText(text: string): boolean {
  return text.includes('404')
    || text.includes('该数据不存在')
    || text.includes('没有权限操作')
    || text.toLowerCase().includes('not found');
}

export function isKookMsgGoneError(err: unknown): boolean {
  return isKookGoneText(err instanceof Error ? err.message : String(err));
}

/** KOOK 标准成功：code=0；少数接口 HTTP 200 省略 code */
export function isKookApiSuccess(result: unknown): boolean {
  if (result == null || typeof result !== 'object') return false;
  const { code } = result as { code?: number };
  if (code === 0) return true;
  if (code === undefined) return true;
  return false;
}

/** 明确的业务失败（可尝试另一路由） */
export function isKookExplicitError(result: unknown): boolean {
  if (result == null || typeof result !== 'object') return false;
  const { code } = result as { code?: number };
  return typeof code === 'number' && code !== 0;
}

/**
 * delete 请求已返回且未抛错：是否停止（不再打第二条路由）。
 * 仅当双路由且响应为明确错误码时，才继续尝试下一路由。
 */
export function shouldStopDeleteAfterResponse(
  result: unknown,
  routeCount: number,
): boolean {
  if (isKookApiSuccess(result) || isKookApiGoneResult(result)) return true;
  if (routeCount === 1) return true;
  return !isKookExplicitError(result);
}

/** KOOK 有时用 HTTP 200 + 非 0 code 表示目标已不存在 */
export function isKookApiGoneResult(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const { code, message } = result as { code?: number; message?: string };
  if (code === 404) return true;
  return isKookGoneText(message ?? '');
}

export function kookDeleteApiPath(route: KookMsgRoute): string {
  return route === 'channel' ? '/v3/message/delete' : '/v3/direct-message/delete';
}

export function kookReactionApiPath(route: KookMsgRoute, action: 'add' | 'delete'): string {
  const prefix = route === 'channel' ? '/v3/message' : '/v3/direct-message';
  const suffix = action === 'add' ? 'add-reaction' : 'delete-reaction';
  return `${prefix}/${suffix}`;
}

export function encodeKookReactionId(route: KookMsgRoute, msgId: string, emoji: string): string {
  return `reaction:${route}:${msgId}:${emoji}`;
}

export function parseKookReactionId(reactionId: string): {
  route?: KookMsgRoute;
  emoji: string;
} {
  const parts = reactionId.split(':');
  if (parts[0] === 'reaction' && (parts[1] === 'channel' || parts[1] === 'direct')) {
    return {
      route: parts[1],
      emoji: parts.slice(3).join(':') || '⏳',
    };
  }
  if (parts[0] === 'reaction' && parts.length >= 3) {
    return { emoji: parts.slice(2).join(':') || '⏳' };
  }
  return { emoji: parts[parts.length - 1] ?? '⏳' };
}
