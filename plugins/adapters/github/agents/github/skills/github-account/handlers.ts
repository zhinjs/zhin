import { resolveLocale, type Locale } from 'zhin.js/i18n';
import { messages as t } from "../../messages.js";
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

export async function executeGithubBind(_args: Record<string, never>, client: GithubClient, commMessage?: Message, preference?: Locale) {
  const log = depsLogger();
  const msg = commMessage ?? getCurrentCommMessage();
  const locale = resolveLocale(preference ?? msg?.locale);
  if (!msg?.clientAdapter || !msg?.sender?.id) return t(locale, 'missingUser');

  const clientId = client.clientId;
  if (!clientId) return t(locale, 'missingClientId');

  const model = oauthModel(client);
  if (!model) return t(locale, 'dbNotReady');

  const [existing] = await model.select().where({ platform: msg.clientAdapter, platform_uid: msg.sender.id });
  if (existing) {
    return t(locale, 'alreadyBound', { login: existing.github_login });
  }

  try {
    const host = client.host;
    const codeResp = await GhClient.deviceFlowRequestCode(clientId, host);
    const tokenPromise = GhClient.deviceFlowPollToken(
      clientId, codeResp.device_code, codeResp.interval, codeResp.expires_in, host,
    );

    const replyMsg = [
      t(locale, 'openDeviceLink'),
      `   ${codeResp.verification_uri}`,
      '',
      t(locale, 'deviceCode', { code: codeResp.user_code }),
      '',
      t(locale, 'waiting', { minutes: Math.floor(codeResp.expires_in / 60) }),
    ].join('\n');

    tokenPromise.then(async (tokenData) => {
      if (!tokenData) {
        log.warn(formatCompact({ op: 'device_flow', ok: false, platform: msg.clientAdapter, sender: msg.sender!.id }));
        return;
      }

      const userGh = new GhClient({ host, token: tokenData.access_token });
      const authResult = await userGh.verifyAuth();
      const login = authResult.ok ? authResult.user : 'unknown';

      await model.insert({
        id: Date.now(),
        platform: msg.clientAdapter,
        platform_uid: msg.sender!.id,
        github_login: login,
        access_token: tokenData.access_token,
        created_at: Date.now(),
      });
      log.debug(formatCompact({ op: 'bind', platform: msg.clientAdapter, sender: msg.sender!.id, login }));

      if (msg?.$reply) {
        await msg.$reply(t(locale, 'bound', { login }));
      }
    }).catch((err) => {
      log.error('GitHub Device Flow 错误:', err);
    });

    return replyMsg;
  } catch (e: unknown) {
    return t(locale, 'flowFailed', { error: e instanceof Error ? e.message : String(e) });
  }
}

export async function executeGithubUnbind(_args: Record<string, never>, client: GithubClient, commMessage?: Message, preference?: Locale) {
  const msg = commMessage ?? getCurrentCommMessage();
  const locale = resolveLocale(preference ?? msg?.locale);
  if (!msg?.clientAdapter || !msg?.sender?.id) return t(locale, 'missingUser');

  const model = oauthModel(client);
  if (!model) return t(locale, 'dbNotReady');

  const [existing] = await model.select().where({ platform: msg.clientAdapter, platform_uid: msg.sender.id });
  if (!existing) return t(locale, 'notBound');

  await model.delete().where({ id: existing.id });
  return t(locale, 'unbound', { login: existing.github_login });
}

export async function executeGithubWhoami(_args: Record<string, never>, client: GithubClient, commMessage?: Message, preference?: Locale) {
  const msg = commMessage ?? getCurrentCommMessage();
  const locale = resolveLocale(preference ?? msg?.locale);
  if (!msg?.clientAdapter || !msg?.sender?.id) return t(locale, 'missingUser');

  const model = oauthModel(client);
  if (!model) return t(locale, 'dbNotReady');

  const [existing] = await model.select().where({ platform: msg.clientAdapter, platform_uid: msg.sender.id });
  if (!existing) return t(locale, 'bindHint');

  const userGh = new GhClient({ host: client.host, token: existing.access_token });
  const auth = await userGh.verifyAuth();
  if (auth.ok) {
    return t(locale, 'account', { login: auth.user, date: new Date(existing.created_at).toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN') });
  }
  return t(locale, 'expired', { login: existing.github_login });
}

export async function executeGithubInstall(client: GithubClient, locale?: Locale) {
  const slug = client.appSlug;
  if (!slug) return t(locale, 'missingApp');
  const host = client.host || 'github.com';
  const installations = client.installations;
  let msg = t(locale, 'install', { url: `https://${host}/apps/${slug}/installations/new` });
  if (installations.length) {
    msg += t(locale, 'installed', { count: installations.length });
    for (const inst of installations) {
      msg += `\n  • ${inst.account.login} (${inst.account.type})`;
    }
  }
  return msg;
}
