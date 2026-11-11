import { resolveLocale, type Locale } from 'zhin.js/i18n';
import { messages as t } from "../../messages.js";
import { formatCompact } from '@zhin.js/logger';
import type { Message } from 'zhin.js';
import { getCurrentCommMessage } from '@zhin.js/agent/security';
import { GhClient } from '../../../../src/gh-client.js';
import type { GithubEndpoint } from '../../../../src/endpoint.js';

function oauthModel(client: GithubEndpoint) {
  const db = client.database as {
    models?: Map<string, unknown>;
  } | null | undefined;
  return db?.models?.get('github_oauth_users') as {
    select: () => { where: (q: object) => Promise<any[]> };
    insert: (row: object) => Promise<void>;
    delete: () => { where: (q: object) => Promise<void> };
  } | undefined;
}

/** `platform\u0000uid` keys with a device flow still polling. */
const pendingBinds = new Set<string>();

function depsLogger() {
  return {
    debug: (...args: unknown[]) => console.debug(...args),
    warn: (...args: unknown[]) => console.warn(...args),
    error: (...args: unknown[]) => console.error(...args),
  };
}

export async function executeGithubBind(_args: Record<string, never>, client: GithubEndpoint, commMessage?: Message, preference?: Locale) {
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

  // One device flow per user: a second request would race the first one's insert.
  const flowKey = `${msg.clientAdapter}\u0000${msg.sender.id}`;
  if (pendingBinds.has(flowKey)) return t(locale, 'bindInProgress');
  pendingBinds.add(flowKey);

  const platform = msg.clientAdapter;
  const senderId = msg.sender.id;
  const reply = async (text: string): Promise<void> => {
    try {
      await msg.$reply?.(text);
    } catch (err) {
      log.warn(formatCompact({ op: 'device_flow_reply', ok: false, platform, sender: senderId, error: err instanceof Error ? err.message : String(err) }));
    }
  };

  try {
    const host = client.host;
    const codeResp = await GhClient.deviceFlowRequestCode(clientId, host);

    const replyMsg = [
      t(locale, 'openDeviceLink'),
      `   ${codeResp.verification_uri}`,
      '',
      t(locale, 'deviceCode', { code: codeResp.user_code }),
      '',
      t(locale, 'waiting', { minutes: Math.floor(codeResp.expires_in / 60) }),
    ].join('\n');

    void (async () => {
      try {
        const result = await GhClient.deviceFlowPollToken({
          clientId,
          deviceCode: codeResp.device_code,
          interval: codeResp.interval,
          expiresIn: codeResp.expires_in,
          host,
          signal: client.lifecycleSignal,
        });
        // Endpoint stopped: nothing to tell the user through a closed endpoint.
        if (result.status === 'aborted') return;
        if (result.status !== 'authorized') {
          log.warn(formatCompact({ op: 'device_flow', ok: false, status: result.status, platform, sender: senderId }));
          await reply(result.status === 'error'
            ? t(locale, 'bindFailed', { error: result.error })
            : result.status === 'expired'
              ? t(locale, 'bindExpired')
              : t(locale, 'bindDenied'));
          return;
        }

        const userGh = new GhClient({ host, token: result.access_token, signal: client.lifecycleSignal });
        const authResult = await userGh.verifyAuth();
        if (!authResult.ok || !authResult.user) {
          log.warn(formatCompact({ op: 'device_flow', ok: false, status: 'verify_failed', platform, sender: senderId }));
          await reply(t(locale, 'bindVerifyFailed'));
          return;
        }
        const login = authResult.user;

        await model.insert({
          id: Date.now(),
          platform,
          platform_uid: senderId,
          github_login: login,
          access_token: result.access_token,
          created_at: Date.now(),
        });
        log.debug(formatCompact({ op: 'bind', platform, sender: senderId, login }));
        await reply(t(locale, 'bound', { login }));
      } catch (err) {
        log.error('GitHub Device Flow 错误:', err);
        if (!client.lifecycleSignal?.aborted) {
          await reply(t(locale, 'bindFailed', { error: err instanceof Error ? err.message : String(err) }));
        }
      } finally {
        pendingBinds.delete(flowKey);
      }
    })();

    return replyMsg;
  } catch (e: unknown) {
    pendingBinds.delete(flowKey);
    return t(locale, 'flowFailed', { error: e instanceof Error ? e.message : String(e) });
  }
}

export async function executeGithubUnbind(_args: Record<string, never>, client: GithubEndpoint, commMessage?: Message, preference?: Locale) {
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

export async function executeGithubWhoami(_args: Record<string, never>, client: GithubEndpoint, commMessage?: Message, preference?: Locale) {
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

export async function executeGithubInstall(client: GithubEndpoint, locale?: Locale) {
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
