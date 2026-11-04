import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { adapterConsoleStyles } from '@zhin.js/client';
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
  return <span className={`ac-badge ac-badge-${tone}`}>{children}</span>;
}

function Button({ children, onClick, disabled, variant = 'default', title }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; variant?: 'default' | 'primary' | 'danger'; title?: string;
}) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick}
      className={`ac-button ac-button-${variant}`}>
      {children}
    </button>
  );
}

function LoginPanel({ endpoint, locale, onChanged, setNotice }: {
  endpoint: ReviewEndpoint; locale: ReviewLocale; onChanged: () => void; setNotice: (notice: Notice) => void;
}) {
  const [busy, setBusy] = useState(false);
  const { login } = endpoint;
  const recheck = async () => {
    setBusy(true);
    try {
      await call('login-check', { endpoint: endpoint.id, locale });
      onChanged();
    } catch (error) {
      setNotice({ kind: 'error', message: errorMessage(error, locale) });
    } finally {
      setBusy(false);
    }
  };
  const name = login.userName ? `${login.userName} · uid ${login.userId}` : login.userId ? `uid ${login.userId}` : '';
  return (
    <section className="ac-review-login">
      <div className="ac-actions">
        {login.state === 'ok' ? <Badge tone="ok">{text(locale, '已登录')}</Badge>
          : login.state === 'expired' ? <Badge tone="warn">{text(locale, '登录已失效')}</Badge>
            : <Badge tone="muted">{text(locale, '未登录')}</Badge>}
        {name && <span className="text-sm">{name}</span>}
        {login.state !== 'none' && <span className="text-xs text-muted-foreground">{text(locale, 'Cookie 来自配置 / 环境变量')}</span>}
        <Button disabled={busy} onClick={() => void recheck()}>{text(locale, '重新检查登录')}</Button>
      </div>
      {login.state === 'none' && <p className="text-sm text-muted-foreground">{text(locale, '未登录时只能读取公开评论，不能发送回复。请用 JUEJIN_COOKIE 环境变量注入 Cookie。')}</p>}
      {login.state === 'expired' && (
        <p className="text-sm text-amber-700 dark:text-amber-300">{text(locale, 'Cookie 已失效，草稿都保留着。更新 JUEJIN_COOKIE 后重启就能继续发送。')}</p>
      )}
      <p className="text-xs text-muted-foreground">{text(locale, 'Cookie 只来自配置 / 环境变量，不会经过这个页面，也不会写进数据目录。')}</p>
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
    <li className="ac-draft">
      <div className="ac-draft-meta">
        <span>{text(locale, '文章 {0}', draft.articleId)}</span>
        <span>·</span>
        <span>{ago(draft.createdAt, locale)}</span>
        <a href={draft.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">{text(locale, '打开文章')}</a>
      </div>
      {draft.interrupted && (
        <p className="ac-warning">{text(locale, '上次发送的结果未知，这条可能已经发出。请先到掘金文章评论区确认，避免重复回复。')}</p>
      )}
      {draft.original !== undefined && (
        <div className="ac-draft-original">
          <div className="ac-draft-label">{text(locale, '原评论')} · {draft.author}</div>
          <div className="ac-draft-body">{draft.original}</div>
        </div>
      )}
      <div className="text-sm">
        <div className="ac-draft-label">{text(locale, '拟回复')}</div>
        {editing ? (
          <>
            <textarea aria-label={text(locale, '拟回复')} autoFocus value={value} onChange={(event) => setValue(event.target.value)} rows={4}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30" />
            <div className={`text-right text-xs ${length > COMMENT_LIMIT ? 'text-red-600' : 'text-muted-foreground'}`}>{text(locale, '{0} 字', length)} / {COMMENT_LIMIT}</div>
          </>
        ) : <div className="ac-draft-body">{draft.message}</div>}
      </div>
      <div className="ac-actions">
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
    <div className="ac-review-endpoint">
      {showTitle && <h2 className="text-lg font-semibold">{text(locale, '账号 {0}', endpoint.id)}</h2>}
      <LoginPanel endpoint={endpoint} locale={locale} onChanged={onChanged} setNotice={setNotice} />
      {endpoint.circuit && (
        <p className="ac-notice ac-notice-error" role="alert">
          {text(locale, '触发了掘金风控或账号异常（错误码 {0}），已暂停轮询和发送。请到网页端确认账号状态，处理后重启。', endpoint.circuit.code)}
        </p>
      )}
      {endpoint.sendMode === 'off' && <p className="text-sm text-muted-foreground">{text(locale, '出站已关闭（sendMode: off），草稿无法发送。')}</p>}

      <section className="ac-review-drafts">
        <div className="flex items-center gap-2">
          <h3 className="font-medium">{text(locale, '待审回复')}</h3>
          {endpoint.pendingCount > 0 && <Badge tone="warn">{endpoint.pendingCount}</Badge>}
        </div>
        {!endpoint.persistent && <p className="text-xs text-muted-foreground">{text(locale, '草稿只存在内存里，重启会丢失。')}</p>}
        {endpoint.drafts.length === 0
          ? <div className="ac-empty"><p>{text(locale, '没有待审的回复。新的 AI 回复会自动出现在这里。')}</p></div>
          : (
            <ul className="space-y-3">
              {endpoint.drafts.map(draft => (
                <DraftCard key={draft.id} draft={draft} endpoint={endpoint} locale={locale} onChanged={onChanged} setNotice={setNotice} />
              ))}
            </ul>
          )}
      </section>

      <section className="ac-review-videos">
        <h3 className="font-medium">{text(locale, '管理的文章')}</h3>
        {endpoint.articles.length === 0
          ? <p className="text-sm text-muted-foreground">{text(locale, '还没有配置文章。要管理哪些文章请在配置的 articles 里填写文章 id 或链接。')}</p>
          : (
            <ul className="flex flex-wrap gap-2">
              {endpoint.articles.map(article => (
                <li key={article.id}>
                  <a href={article.url} target="_blank" rel="noreferrer" className="rounded-md border px-2 py-1 text-sm hover:bg-accent">{article.id}</a>
                </li>
              ))}
            </ul>
          )}
        <p className="text-xs text-muted-foreground">{text(locale, '文章列表来自配置，要增删请改配置文件。')}</p>
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

  useEffect(() => {
    let cancelled = false;
    const loop = async () => {
      if (cancelled) return;
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') await refresh();
      if (!cancelled) timer.current = setTimeout(loop, 10_000);
    };
    void loop();
    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current); };
  }, [refresh]);

  useEffect(() => {
    if (!notice || notice.kind === 'error') return;
    const id = setTimeout(() => setNotice(undefined), 6_000);
    return () => clearTimeout(id);
  }, [notice]);

  const endpoints = status?.endpoints ?? [];
  return (
    <div className="zhin-console-surface zhin-review-page">
      <style>{adapterConsoleStyles}</style>
      <header className="ac-header">
        <div className="ac-identity">
          <span className="ac-platform-mark" aria-hidden="true">掘</span>
          <div><h1>{text(locale, '掘金评论审批')}</h1><p>{text(locale, 'AI 写好的掘金评论回复先停在这里，你点「发送」才会真的发出去。')}</p></div>
        </div>
        <Button onClick={() => void refresh()}>{text(locale, '刷新')}</Button>
      </header>
      {notice && (
        <div role={notice.kind === 'ok' ? 'status' : 'alert'} className={`ac-notice ${notice.kind === 'ok' ? '' : 'ac-notice-error'}`}>
          {notice.message}
          {notice.link && <> · <a href={notice.link} target="_blank" rel="noreferrer" className="underline">{text(locale, '查看')}</a></>}
        </div>
      )}
      {loadError && <p role="alert" className="ac-notice ac-notice-error">{loadError}</p>}
      {!status && !loadError && <div className="ac-loading" role="status" aria-busy="true"><p>{text(locale, '加载中…')}</p><span aria-hidden="true" /></div>}
      {status && endpoints.length === 0 && <div className="ac-empty"><p>{text(locale, '掘金适配器还没有启动。请先在配置里添加 juejin 插件和至少一个账号。')}</p></div>}
      {endpoints.map(endpoint => (
        <EndpointSection key={endpoint.id} endpoint={endpoint} locale={locale} showTitle={endpoints.length > 1}
          onChanged={() => void refresh()} setNotice={setNotice} />
      ))}
    </div>
  );
}
