import React, { useEffect, useState } from 'react';
import { ReviewResourceList, type CommentReviewSpec, type ReviewContext, type ReviewDraftBase, type ReviewEndpointBase } from '@zhin.js/client';
import { Badge, Button } from '@zhin.js/client/ui';

/** 与插件 `src/console.ts` 返回的结构保持一致（只读视图）。 */
interface BilibiliDraft extends ReviewDraftBase {
  /** 评论区标签（兼容旧字段名）：`av123` / `cv456` / `dynamic 789`。 */
  readonly video: string;
  readonly resource?: string;
}
interface BilibiliEndpoint extends ReviewEndpointBase<BilibiliDraft> {
  readonly login: { readonly state: 'none' | 'ok' | 'expired'; readonly source?: 'config' | 'qr'; readonly mid?: string; readonly uname?: string; readonly expiresAt?: number };
  readonly qr: { readonly state: 'idle' | 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'failed'; readonly image?: string; readonly expiresAt?: number; readonly error?: string };
  readonly videos: readonly { readonly ref: string; readonly url: string }[];
  readonly resources?: readonly { readonly kind: 'dynamic' | 'article'; readonly ref: string; readonly url: string; readonly error?: string }[];
}

const scanning = (endpoint: BilibiliEndpoint) => endpoint.qr.state === 'waiting' || endpoint.qr.state === 'scanned';

function QrLogin({ endpoint, context }: { endpoint: BilibiliEndpoint; context: ReviewContext }) {
  const { t, pending, act } = context;
  const { login, qr } = endpoint;
  const [now, setNow] = useState(Date.now());
  const active = scanning(endpoint);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const configCookie = login.source === 'config';

  if (active && qr.image) {
    return (
      <div className="zk-media">
        <img className="zk-qr" src={qr.image} alt={t('登录二维码')} />
        <div className="zk-media__body">
          <strong>{t(qr.state === 'scanned' ? '已扫码，请在手机上确认登录' : '用 B 站 App 扫一扫')}</strong>
          {qr.expiresAt && <span className="zk-hint">{t('剩余 {0} 秒', Math.max(0, Math.ceil((qr.expiresAt - now) / 1000)))}</span>}
          <span className="zk-hint">{t('登录凭据只保存在运行机器人的这台机器上，不会写进配置文件。')}</span>
          <div><Button busy={pending === 'login-cancel'} disabled={pending !== undefined} onClick={() => act('login-cancel')}>{t('取消')}</Button></div>
        </div>
      </div>
    );
  }
  const retry = qr.state === 'expired' || qr.state === 'failed';
  return (
    <div className="zk-row">
      {qr.state === 'expired' && <Badge tone="warning">{t('二维码已过期')}</Badge>}
      {qr.state === 'failed' && qr.error && <Badge tone="danger">{qr.error}</Badge>}
      {login.state !== 'ok' && !configCookie && (
        <Button variant="primary" busy={pending === 'login'} disabled={pending !== undefined} onClick={() => act('login')}>{t(retry ? '重新扫码' : '扫码登录 B 站')}</Button>
      )}
      {login.state === 'ok' && login.source === 'qr' && (
        <>
          <Button busy={pending === 'login'} disabled={pending !== undefined} onClick={() => act('login')}>{t('重新扫码')}</Button>
          <Button busy={pending === 'logout'} disabled={pending !== undefined} onClick={() => act('logout')}>{t('退出登录')}</Button>
        </>
      )}
    </div>
  );
}

export const spec: CommentReviewSpec<BilibiliEndpoint, BilibiliDraft> = {
  adapter: 'bilibili',
  platform: { zh: 'B 站', en: 'Bilibili' },
  mark: 'B',
  resource: { zh: '视频', en: 'videos' },
  account: endpoint => ({ id: endpoint.login.mid, name: endpoint.login.uname }),
  draftResource: draft => draft.resource ?? draft.video,
  isLoginPending: scanning,
  loginHint: ({ login }, t) => {
    const config = login.source === 'config';
    const expiry = login.expiresAt ? ` · ${t('{0} 过期', new Date(login.expiresAt).toLocaleDateString())}` : '';
    if (login.state === 'ok') return login.source ? `${t(config ? 'Cookie 来自配置 / 环境变量' : '扫码登录')}${expiry}` : undefined;
    if (login.state === 'expired') return t(config ? 'Cookie 来自配置 / 环境变量且已失效：请更新环境变量，或去掉后在这里扫码登录。' : '登录已失效，草稿都保留着。重新扫码登录后就能继续发送。');
    return t('未登录时只能读取公开评论，不能发送回复。');
  },
  renderLoginExtras: (endpoint, context) => <QrLogin endpoint={endpoint} context={context} />,
  renderResources: (endpoint, { t, noun }) => (
    <>
      <ReviewResourceList title={t('管理的{0}', noun)} items={endpoint.videos.map(video => ({ key: video.ref, label: video.ref, url: video.url }))}
        empty={t('还没有配置视频。要管理哪些视频请在配置的 videos 里填写 BV 号。')} footnote={t('{0}列表来自配置，要增删请改配置文件。', noun)} />
      {(endpoint.resources ?? []).length > 0 && (
        <ReviewResourceList title={t('管理的动态 / 专栏')} items={(endpoint.resources ?? []).map(resource => ({
          key: `${resource.kind}:${resource.ref}`, url: resource.url,
          label: resource.kind === 'article' ? `cv${resource.ref}` : `${t('动态')} ${resource.ref}`,
          ...(resource.error !== undefined ? { note: t('无法解析，已跳过') } : {}),
        }))} />
      )}
    </>
  ),
  dictionary: {
    '登录二维码': 'Login QR code',
    'Cookie 来自配置 / 环境变量': 'Cookie from config or environment',
    '扫码登录': 'QR login',
    '{0} 过期': 'Expires {0}',
    '未登录时只能读取公开评论，不能发送回复。': 'Without signing in, only public comments are read and replies cannot be posted.',
    '登录已失效，草稿都保留着。重新扫码登录后就能继续发送。': 'Login expired. Drafts are kept; sign in again to keep sending.',
    'Cookie 来自配置 / 环境变量且已失效：请更新环境变量，或去掉后在这里扫码登录。': 'The configured cookie has expired. Update the environment variables, or remove them and sign in here.',
    '扫码登录 B 站': 'Sign in with QR code',
    '重新扫码': 'Scan again',
    '退出登录': 'Sign out',
    '用 B 站 App 扫一扫': 'Scan with the Bilibili app',
    '已扫码，请在手机上确认登录': 'Scanned. Confirm the login on your phone.',
    '二维码已过期': 'The QR code has expired',
    '剩余 {0} 秒': '{0}s left',
    '登录凭据只保存在运行机器人的这台机器上，不会写进配置文件。': 'Credentials are stored only on the machine running the bot, never in the config file.',
    '还没有配置视频。要管理哪些视频请在配置的 videos 里填写 BV 号。': 'No videos configured. Add BV IDs under videos in the config.',
    '管理的动态 / 专栏': 'Watched dynamics / articles',
    '动态': 'Dynamic',
    '无法解析，已跳过': 'Cannot be resolved; skipped',
  },
};
