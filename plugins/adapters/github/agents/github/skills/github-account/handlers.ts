import { formatCompact } from '@zhin.js/logger';
import type { Message } from 'zhin.js';
import { getCurrentCommMessage } from '@zhin.js/agent/security';
import { GhClient } from '../../../../src/gh-client.js';
import type { GithubClient } from '../../../../src/client.js';

function oauthModel(client: GithubClient) {
  const db = client.database as {
    models?: Map<string, unknown>;
  } | null | undefined;
  return db?.models?.get('github_oauth_users') as {
    select: () => { where: (q: object) => Promise<any[]> };
    insert: (row: object) => Promise<void>;
    delete: () => { where: (q: object) => Promise<void> };
  } | undefined;
}

function depsLogger() {
  return {
    debug: (...args: unknown[]) => console.debug(...args),
    warn: (...args: unknown[]) => console.warn(...args),
    error: (...args: unknown[]) => console.error(...args),
  };
}

export async function executeGithubBind(_args: Record<string, never>, client: GithubClient, commMessage?: Message) {
  const log = depsLogger();
  const msg = commMessage ?? getCurrentCommMessage();
  if (!msg?.$adapter || !msg?.$sender?.id) return '❌ 无法获取当前用户信息';

  const clientId = client.clientId;
  if (!clientId) return '❌ Endpoint 未配置 GitHub App 或 App 无 client_id，无法进行账号绑定';

  const model = oauthModel(client);
  if (!model) return '❌ 数据库未就绪';

  const [existing] = await model.select().where({ platform: msg.$adapter, platform_uid: msg.$sender.id });
  if (existing) {
    return `⚠️ 你已绑定 GitHub 账号: ${existing.github_login}\n如需重新绑定，请先执行 github_unbind`;
  }

  try {
    const host = client.host;
    const codeResp = await GhClient.deviceFlowRequestCode(clientId, host);
    const tokenPromise = GhClient.deviceFlowPollToken(
      clientId, codeResp.device_code, codeResp.interval, codeResp.expires_in, host,
    );

    const replyMsg = [
      '🔗 请在浏览器中打开以下链接进行授权：',
      `   ${codeResp.verification_uri}`,
      '',
      `📋 输入验证码: **${codeResp.user_code}**`,
      '',
      `⏳ 等待授权中…（${Math.floor(codeResp.expires_in / 60)} 分钟内有效）`,
    ].join('\n');

    tokenPromise.then(async (tokenData) => {
      if (!tokenData) {
        log.warn(formatCompact({ op: 'device_flow', ok: false, platform: msg.$adapter, sender: msg.$sender.id }));
        return;
      }

      const userGh = new GhClient({ host, token: tokenData.access_token });
      const authResult = await userGh.verifyAuth();
      const login = authResult.ok ? authResult.user : 'unknown';

      await model.insert({
        id: Date.now(),
        platform: msg.$adapter,
        platform_uid: msg.$sender.id,
        github_login: login,
        access_token: tokenData.access_token,
        created_at: Date.now(),
      });
      log.debug(formatCompact({ op: 'bind', platform: msg.$adapter, sender: msg.$sender.id, login }));

      if (msg?.$reply) {
        await msg.$reply(`✅ GitHub 账号绑定成功！\n👤 ${login}`);
      }
    }).catch((err) => {
      log.error('GitHub Device Flow 错误:', err);
    });

    return replyMsg;
  } catch (e: unknown) {
    return `❌ Device Flow 启动失败: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function executeGithubUnbind(_args: Record<string, never>, client: GithubClient, commMessage?: Message) {
  const msg = commMessage ?? getCurrentCommMessage();
  if (!msg?.$adapter || !msg?.$sender?.id) return '❌ 无法获取当前用户信息';

  const model = oauthModel(client);
  if (!model) return '❌ 数据库未就绪';

  const [existing] = await model.select().where({ platform: msg.$adapter, platform_uid: msg.$sender.id });
  if (!existing) return '📭 你尚未绑定 GitHub 账号';

  await model.delete().where({ id: existing.id });
  return `✅ 已解除 GitHub 账号绑定: ${existing.github_login}`;
}

export async function executeGithubWhoami(_args: Record<string, never>, client: GithubClient, commMessage?: Message) {
  const msg = commMessage ?? getCurrentCommMessage();
  if (!msg?.$adapter || !msg?.$sender?.id) return '❌ 无法获取当前用户信息';

  const model = oauthModel(client);
  if (!model) return '❌ 数据库未就绪';

  const [existing] = await model.select().where({ platform: msg.$adapter, platform_uid: msg.$sender.id });
  if (!existing) return '📭 你尚未绑定 GitHub 账号\n🔗 使用 github_bind 绑定你的账号';

  const userGh = new GhClient({ host: client.host, token: existing.access_token });
  const auth = await userGh.verifyAuth();
  if (auth.ok) {
    return `👤 已绑定 GitHub 账号: ${auth.user}\n📅 绑定时间: ${new Date(existing.created_at).toLocaleString('zh-CN')}`;
  }
  return `⚠️ 已绑定账号 ${existing.github_login}，但 Token 已失效\n🔗 请执行 github_unbind 后重新 github_bind`;
}

export async function executeGithubInstall(client: GithubClient) {
  const slug = client.appSlug;
  if (!slug) return '❌ Endpoint 未配置 GitHub App';
  const host = client.host || 'github.com';
  const installations = client.installations;
  let msg = `🔗 请点击以下链接安装 GitHub App 到你的仓库：\n   https://${host}/apps/${slug}/installations/new`;
  if (installations.length) {
    msg += `\n\n📋 当前已安装 (${installations.length}):`;
    for (const inst of installations) {
      msg += `\n  • ${inst.account.login} (${inst.account.type})`;
    }
  }
  return msg;
}
