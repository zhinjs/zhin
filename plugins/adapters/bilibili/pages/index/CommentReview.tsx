import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { call, type ReviewDraft, type ReviewEndpoint, type ReviewStatus } from './rpc';
import { detectLocale, text, type ReviewLocale } from './messages';

const COMMENT_LIMIT = 1000;

type Notice = { readonly kind: 'ok' | 'error'; readonly message: string; readonly link?: string };

function errorMessage(error: unknown, locale: ReviewLocale): string {
  if (error instanceof Error && error.message) return error.message;
  return text(locale, '操作失败');
}

function ago(at: number, locale: ReviewLocale): string {
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return text(locale, '刚刚');
  if (minutes < 60) return text(locale, '{0} 分钟前', minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return text(locale, '{0} 小时前', hours);
  return text(locale, '{0} 天前', Math.floor(hours / 24));
}

function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'muted'; children: React.ReactNode }) {
  const color = tone === 'ok' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
    : tone === 'warn' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
      : 'bg-muted text-muted-foreground';
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{children}</span>;
}

function Button({ children, onClick, disabled, variant = 'default', title }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; variant?: 'default' | 'primary' | 'danger'; title?: string;
}) {
  const style = variant === 'primary' ? 'bg-primary text-primary-foreground hover:opacity-90'
    : variant === 'danger' ? 'border border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400'
      : 'border hover:bg-accent';
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${style}`}>
      {children}
    </button>
  );
}

function LoginPanel({ endpoint, locale, onChanged, setNotice }: {
  endpoint: ReviewEndpoint; locale: ReviewLocale; onChanged: () => void; setNotice: (notice: Notice) => void;
}) {
  const [busy, setBusy] = useState(false);
  const { login, qr } = endpoint;
  const [now, setNow] = useState(Date.now());
  const scanning = qr.state === 'waiting' || qr.state === 'scanned';
  useEffect(() => {
    if (!scanning) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [scanning]);

  const run = async (method: string) => {
    setBusy(true);
    try {
      await call(method, { endpoint: endpoint.id, locale });
      onChanged();
    } catch (error) {
      setNotice({ kind: 'error', message: errorMessage(error, locale) });
    } finally {
      setBusy(false);
    }
  };

  const name = login.uname ? `${login.uname} · uid ${login.mid}` : login.mid ? `uid ${login.mid}` : '';
  const configCookie = login.source === 'config';
  const canScan = !(login.state === 'ok' && configCookie);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {login.state === 'ok' ? <Badge tone="ok">{text(locale, '已登录')}</Badge>
          : login.state === 'expired' ? <Badge tone="warn">{text(locale, '登录已失效')}</Badge>
            : <Badge tone="muted">{text(locale, '未登录')}</Badge>}
        {name && <span className="text-sm">{name}</span>}
        {login.source && (
          <span className="text-xs text-muted-foreground">
            {text(locale, configCookie ? 'Cookie 来自配置 / 环境变量' : '扫码登录')}
            {login.expiresAt ? ` · ${text(locale, '{0} 过期', new Date(login.expiresAt).toLocaleDateString())}` : ''}
          </span>
        )}
      </div>
      {login.state === 'none' && <p className="text-sm text-muted-foreground">{text(locale, '未登录时只能读取公开评论，不能发送回复。')}</p>}
      {login.state === 'expired' && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          {text(locale, configCookie ? 'Cookie 来自配置 / 环境变量且已失效：请更新环境变量，或去掉后在这里扫码登录。' : '登录已失效，草稿都保留着。重新扫码登录后就能继续发送。')}
        </p>
      )}

      {scanning && qr.image ? (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border p-4">
          <img src={qr.image} alt="QR" width={180} height={180} className="rounded bg-white p-1" />
          <div className="space-y-2">
            <p className="font-medium">{text(locale, qr.state === 'scanned' ? '已扫码，请在手机上确认登录' : '用 B 站 App 扫一扫')}</p>
            {qr.expiresAt && <p className="text-xs text-muted-foreground">{text(locale, '剩余 {0} 秒', Math.max(0, Math.ceil((qr.expiresAt - now) / 1000)))}</p>}
            <p className="text-xs text-muted-foreground">{text(locale, '登录凭据只保存在运行机器人的这台机器上，不会写进配置文件。')}</p>
            <Button disabled={busy} onClick={() => run('login-cancel')}>{text(locale, '取消')}</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {qr.state === 'expired' && <span className="text-sm text-muted-foreground">{text(locale, '二维码已过期')}</span>}
          {qr.state === 'failed' && qr.error && <span className="text-sm text-red-600 dark:text-red-400">{qr.error}</span>}
          {canScan && login.state !== 'ok' && (
            <Button variant="primary" disabled={busy} onClick={() => run('login')}>
              {text(locale, qr.state === 'expired' || qr.state === 'failed' ? '重新扫码' : '扫码登录 B 站')}
            </Button>
          )}
          {login.state === 'ok' && login.source === 'qr' && (
            <>
              <Button disabled={busy} onClick={() => run('login')}>{text(locale, '重新扫码')}</Button>
              <Button disabled={busy} onClick={() => run('logout')}>{text(locale, '退出登录')}</Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function DraftCard({ draft, endpoint, locale, onChanged, setNotice }: {
  draft: ReviewDraft; endpoint: ReviewEndpoint; locale: ReviewLocale; onChanged: () => void; setNotice: (notice: Notice) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(draft.message);
  const [busy, setBusy] = useState<'' | 'send' | 'save' | 'drop'>('');
  useEffect(() => { if (!editing) setValue(draft.message); }, [draft.message, editing]);
  const length = [...value].length;
  const sending = draft.status === 'sending' || busy === 'send';
  const canSend = endpoint.sendMode !== 'off' && endpoint.login.state === 'ok' && !endpoint.circuit;

  const act = async (kind: 'send' | 'save' | 'drop') => {
    if (kind === 'drop' && !window.confirm(text(locale, '确定丢弃这条回复？不会发送。'))) return;
    setBusy(kind);
    try {
      if (kind === 'save') {
        await call('edit', { id: draft.id, message: value, locale });
        setEditing(false);
        setNotice({ kind: 'ok', message: text(locale, '已保存修改') });
      } else if (kind === 'drop') {
        await call('drop', { id: draft.id, locale });
        setNotice({ kind: 'ok', message: text(locale, '已丢弃') });
      } else {
        if (editing && value.trim() !== draft.message) {
          await call('edit', { id: draft.id, message: value, locale });
          setEditing(false);
        }
        const result = await call<{ url: string }>('send', { id: draft.id, locale });
        setNotice({ kind: 'ok', message: text(locale, '已发出'), link: result.url });
      }
      onChanged();
    } catch (error) {
      setNotice({ kind: 'error', message: errorMessage(error, locale) });
    } finally {
      setBusy('');
    }
  };

  return (
    <li className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{draft.video}</span>
        <span>·</span>
        <span>{ago(draft.createdAt, locale)}</span>
        <a href={draft.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">{text(locale, '查看原评论')}</a>
      </div>
      {draft.interrupted && (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          {text(locale, '上次发送时程序中断了，这条可能已经发出。请先到 B 站确认，避免重复回复。')}
        </p>
      )}
      {draft.original !== undefined && (
        <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
          <div className="mb-1 text-xs text-muted-foreground">{text(locale, '原评论')} · {draft.author}</div>
          <div className="whitespace-pre-wrap break-words">{draft.original}</div>
        </div>
      )}
      <div className="text-sm">
        <div className="mb-1 text-xs text-muted-foreground">{text(locale, '拟回复')}</div>
        {editing ? (
          <>
            <textarea value={value} onChange={(event) => setValue(event.target.value)} rows={4}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            <div className={`text-right text-xs ${length > COMMENT_LIMIT ? 'text-red-600' : 'text-muted-foreground'}`}>{text(locale, '{0} 字', length)} / {COMMENT_LIMIT}</div>
          </>
        ) : <div className="whitespace-pre-wrap break-words">{draft.message}</div>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={!canSend || sending || busy !== '' || !value.trim() || length > COMMENT_LIMIT} onClick={() => act('send')}>
          {sending ? text(locale, '发送中…') : text(locale, '发送')}
        </Button>
        {editing
          ? <Button disabled={busy !== '' || !value.trim() || length > COMMENT_LIMIT} onClick={() => act('save')}>{text(locale, '保存')}</Button>
          : <Button disabled={busy !== '' || sending} onClick={() => setEditing(true)}>{text(locale, '修改')}</Button>}
        {editing && <Button disabled={busy !== ''} onClick={() => { setEditing(false); setValue(draft.message); }}>{text(locale, '取消')}</Button>}
        <Button variant="danger" disabled={busy !== '' || sending} onClick={() => act('drop')}>{text(locale, '丢弃')}</Button>
      </div>
    </li>
  );
}

function EndpointSection({ endpoint, locale, showTitle, onChanged, setNotice }: {
  endpoint: ReviewEndpoint; locale: ReviewLocale; showTitle: boolean; onChanged: () => void; setNotice: (notice: Notice) => void;
}) {
  return (
    <div className="space-y-6">
      {showTitle && <h2 className="text-lg font-semibold">{text(locale, '账号 {0}', endpoint.id)}</h2>}
      <LoginPanel endpoint={endpoint} locale={locale} onChanged={onChanged} setNotice={setNotice} />
      {endpoint.circuit && (
        <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {text(locale, '触发了 B 站风控（错误码 {0}），已暂停轮询和发送。请到网页端确认账号状态，处理后重启。', endpoint.circuit.code)}
        </p>
      )}
      {endpoint.sendMode === 'off' && <p className="text-sm text-muted-foreground">{text(locale, '出站已关闭（sendMode: off），草稿无法发送。')}</p>}

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="font-medium">{text(locale, '待审回复')}</h3>
          {endpoint.pendingCount > 0 && <Badge tone="warn">{endpoint.pendingCount}</Badge>}
        </div>
        {!endpoint.persistent && <p className="text-xs text-muted-foreground">{text(locale, '草稿只存在内存里，重启会丢失。')}</p>}
        {endpoint.drafts.length === 0
          ? <p className="text-sm text-muted-foreground">{text(locale, '没有待审的回复。新的 AI 回复会自动出现在这里。')}</p>
          : (
            <ul className="space-y-3">
              {endpoint.drafts.map(draft => (
                <DraftCard key={draft.id} draft={draft} endpoint={endpoint} locale={locale} onChanged={onChanged} setNotice={setNotice} />
              ))}
            </ul>
          )}
      </section>

      <section className="space-y-2">
        <h3 className="font-medium">{text(locale, '管理的视频')}</h3>
        {endpoint.videos.length === 0
          ? <p className="text-sm text-muted-foreground">{text(locale, '还没有配置视频。要管理哪些视频请在配置的 videos 里填写 BV 号。')}</p>
          : (
            <ul className="flex flex-wrap gap-2">
              {endpoint.videos.map(video => (
                <li key={video.ref}>
                  <a href={video.url} target="_blank" rel="noreferrer" className="rounded-md border px-2 py-1 text-sm hover:bg-accent">{video.ref}</a>
                </li>
              ))}
            </ul>
          )}
        <p className="text-xs text-muted-foreground">{text(locale, '视频列表来自配置，要增删请改配置文件。')}</p>
      </section>
    </div>
  );
}

export default function CommentReview() {
  const locale = useMemo(detectLocale, []);
  const [status, setStatus] = useState<ReviewStatus | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [notice, setNotice] = useState<Notice | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const next = await call<ReviewStatus>('status');
      setStatus(next);
      setLoadError(undefined);
    } catch (error) {
      setLoadError(errorMessage(error, locale));
    }
  }, [locale]);

  const scanning = status?.endpoints.some(endpoint => endpoint.qr.state === 'waiting' || endpoint.qr.state === 'scanned') ?? false;
  useEffect(() => {
    let cancelled = false;
    const loop = async () => {
      if (cancelled) return;
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') await refresh();
      if (!cancelled) timer.current = setTimeout(loop, scanning ? 2_000 : 10_000);
    };
    void loop();
    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current); };
  }, [refresh, scanning]);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(undefined), 6_000);
    return () => clearTimeout(id);
  }, [notice]);

  const endpoints = status?.endpoints ?? [];
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{text(locale, '评论审批')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{text(locale, 'AI 写好的 B 站评论回复先停在这里，你点「发送」才会真的发出去。')}</p>
        </div>
        <Button onClick={() => void refresh()}>{text(locale, '刷新')}</Button>
      </header>
      {notice && (
        <div className={`rounded-md px-3 py-2 text-sm ${notice.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/10 text-red-700 dark:text-red-300'}`}>
          {notice.message}
          {notice.link && <> · <a href={notice.link} target="_blank" rel="noreferrer" className="underline">{text(locale, '查看')}</a></>}
        </div>
      )}
      {loadError && <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>}
      {!status && !loadError && <p className="text-sm text-muted-foreground">{text(locale, '加载中…')}</p>}
      {status && endpoints.length === 0 && <p className="text-sm text-muted-foreground">{text(locale, 'B 站适配器还没有启动。请先在配置里添加 bilibili 插件和至少一个账号。')}</p>}
      {endpoints.map(endpoint => (
        <EndpointSection key={endpoint.id} endpoint={endpoint} locale={locale} showTitle={endpoints.length > 1}
          onChanged={() => void refresh()} setNotice={setNotice} />
      ))}
    </div>
  );
}
