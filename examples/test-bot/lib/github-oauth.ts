/**
 * GitHub user OAuth binding for Plugin Runtime (PAT + Device Flow).
 * Persists into DatabaseHost table owned by `@zhin.js/adapter-github`.
 */
import {
  GhClient,
  getAdapter,
  GITHUB_OAUTH_USERS_TABLE,
} from '@zhin.js/adapter-github';
import {
  databaseHostToken,
  type DatabaseHost,
  type DatabaseHostModel,
  type Token,
} from '@zhin.js/plugin-runtime';

export { GITHUB_OAUTH_USERS_TABLE };

export interface GithubOauthRow {
  readonly id: number;
  readonly platform: string;
  readonly platform_uid: string;
  readonly github_login: string;
  readonly access_token: string;
  readonly created_at: number;
}

export function requireOauthModel(use: <T>(token: Token<T>) => T): DatabaseHostModel | string {
  let host: DatabaseHost;
  try {
    host = use(databaseHostToken);
  } catch {
    return '数据库未就绪（缺少 DatabaseHost）';
  }
  if (!host.started) return '数据库尚未启动';
  const model = host.models.get(GITHUB_OAUTH_USERS_TABLE);
  if (!model) return `表 ${GITHUB_OAUTH_USERS_TABLE} 未定义`;
  return model;
}

export function platformIdentity(input: unknown): { platform: string; uid: string } | string {
  if (!input || typeof input !== 'object') return '无法获取用户信息（缺少消息上下文）';
  const value = input as Record<string, unknown>;
  const meta = value.metadata && typeof value.metadata === 'object'
    ? value.metadata as Record<string, unknown>
    : {};
  const platform = typeof value.$adapter === 'string'
    ? value.$adapter
    : typeof value.adapter === 'string'
      ? value.adapter
      : typeof meta.adapter === 'string'
        ? meta.adapter
        : '';
  let uid = '';
  const sender = value.$sender;
  if (sender && typeof sender === 'object' && 'id' in sender) {
    uid = String((sender as { id?: unknown }).id ?? '');
  } else if (typeof value.sender === 'string') {
    uid = value.sender;
  } else if (typeof meta.senderId === 'string') {
    uid = meta.senderId;
  }
  if (!platform || !uid) return '无法获取用户信息（需要 platform + sender）';
  return { platform, uid };
}

export async function findOauthBinding(
  model: DatabaseHostModel,
  platform: string,
  uid: string,
): Promise<GithubOauthRow | null> {
  const rows = await model.select().where({ platform, platform_uid: uid });
  const row = rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    platform: String(row.platform),
    platform_uid: String(row.platform_uid),
    github_login: String(row.github_login),
    access_token: String(row.access_token),
    created_at: Number(row.created_at),
  };
}

export async function bindWithPat(
  model: DatabaseHostModel,
  platform: string,
  uid: string,
  token: string,
): Promise<string> {
  const existing = await findOauthBinding(model, platform, uid);
  if (existing) {
    return `已绑定 GitHub 账号: ${existing.github_login}\n请先执行 gh unbind`;
  }
  const endpoint = getAdapter();
  const userGh = new GhClient({ host: endpoint.getHost(), token });
  const auth = await userGh.verifyAuth();
  if (!auth.ok) return `Token 验证失败: ${auth.message}`;
  await model.insert({
    id: Date.now(),
    platform,
    platform_uid: uid,
    github_login: auth.user,
    access_token: token,
    created_at: Date.now(),
  });
  return `GitHub 绑定成功\n用户: ${auth.user}`;
}

export async function startDeviceFlowBind(
  model: DatabaseHostModel,
  platform: string,
  uid: string,
  reply?: (text: string) => Promise<unknown>,
): Promise<string> {
  const existing = await findOauthBinding(model, platform, uid);
  if (existing) {
    return `已绑定 GitHub 账号: ${existing.github_login}\n请先执行 gh unbind`;
  }
  const endpoint = getAdapter();
  const clientId = endpoint.getClientId();
  if (!clientId) {
    return [
      'Device Flow 不可用（App 未配置 client_id）',
      '',
      '改用 PAT：',
      '1. https://github.com/settings/tokens/new （repo, read:org）',
      '2. gh bind <token>',
    ].join('\n');
  }
  const host = endpoint.getHost();
  let codeResp: Awaited<ReturnType<typeof GhClient.deviceFlowRequestCode>>;
  try {
    codeResp = await GhClient.deviceFlowRequestCode(clientId, host);
  } catch (error) {
    return [
      `Device Flow 失败: ${error instanceof Error ? error.message : String(error)}`,
      '',
      '也可: gh bind <PAT>',
    ].join('\n');
  }

  void GhClient.deviceFlowPollToken(
    clientId,
    codeResp.device_code,
    codeResp.interval,
    codeResp.expires_in,
    host,
  ).then(async (tokenData) => {
    if (!tokenData) return;
    const userGh = new GhClient({ host, token: tokenData.access_token });
    const auth = await userGh.verifyAuth();
    const login = auth.ok ? auth.user : 'unknown';
    const still = await findOauthBinding(model, platform, uid);
    if (still) return;
    await model.insert({
      id: Date.now(),
      platform,
      platform_uid: uid,
      github_login: login,
      access_token: tokenData.access_token,
      created_at: Date.now(),
    });
    if (reply) await reply(`GitHub 绑定成功\n用户: ${login}`);
  }).catch(() => {
    /* poll errors are non-fatal for the initial reply */
  });

  return [
    '请在浏览器打开：',
    `  ${codeResp.verification_uri}`,
    '',
    `输入验证码: ${codeResp.user_code}`,
    '',
    `${Math.floor(codeResp.expires_in / 60)} 分钟内有效`,
  ].join('\n');
}

export async function unbindOauth(
  model: DatabaseHostModel,
  platform: string,
  uid: string,
): Promise<string> {
  const existing = await findOauthBinding(model, platform, uid);
  if (!existing) return '尚未绑定 GitHub 账号';
  await model.delete().where({ id: existing.id });
  return `已解绑: ${existing.github_login}`;
}

export async function whoamiOauth(
  model: DatabaseHostModel,
  platform: string,
  uid: string,
): Promise<string> {
  const existing = await findOauthBinding(model, platform, uid);
  const endpoint = getAdapter();
  const appAuth = await endpoint.getAPI().verifyAuth();
  const appLine = appAuth.ok ? `Bot / App: ${appAuth.user}` : `Bot / App: ${appAuth.message}`;
  if (!existing) {
    return `${appLine}\n用户绑定: 无（gh bind <PAT> 或 Device Flow）`;
  }
  const userGh = new GhClient({ host: endpoint.getHost(), token: existing.access_token });
  const auth = await userGh.verifyAuth();
  if (auth.ok) {
    return [
      appLine,
      `用户绑定: ${auth.user}`,
      `绑定时间: ${new Date(existing.created_at).toLocaleString('zh-CN')}`,
    ].join('\n');
  }
  return [
    appLine,
    `用户绑定: ${existing.github_login}（Token 已失效，请 gh unbind 后重绑）`,
  ].join('\n');
}
