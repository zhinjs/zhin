/**
 * IM 会话 ID 解析（无 AI 依赖）
 *
 * 格式：`platform:endpointId:scope:sceneId`
 */

export type IMSessionScope = 'private' | 'group' | 'channel';

export interface ResolveIMSessionIdInput {
  platform: string;
  endpointId: string;
  scope: IMSessionScope;
  sceneId: string;
}

export function resolveIMSessionId(input: ResolveIMSessionIdInput): string {
  const platform = String(input.platform || 'unknown');
  const endpointId = String(input.endpointId || 'default');
  const scope: IMSessionScope = input.scope || 'private';
  const sceneId = String(input.sceneId || 'unknown');
  return `${platform}:${endpointId}:${scope}:${sceneId}`;
}

export function resolveIMSceneIdForSession(
  scope: IMSessionScope,
  sceneId?: string,
  senderId?: string,
): string {
  if (scope === 'group' || scope === 'channel') {
    return sceneId || senderId || 'unknown';
  }
  return senderId || sceneId || 'unknown';
}

export function resolveIMSessionIdFromMessage(message: {
  $adapter?: string;
  $endpoint?: string;
  $channel?: { type?: IMSessionScope; id?: string };
  $sender?: { id?: string };
}): string {
  const scope = (message.$channel?.type || 'private') as IMSessionScope;
  const sceneId = resolveIMSceneIdForSession(
    scope,
    message.$channel?.id,
    message.$sender?.id,
  );
  return resolveIMSessionId({
    platform: String(message.$adapter || ''),
    endpointId: String(message.$endpoint || ''),
    scope,
    sceneId,
  });
}
