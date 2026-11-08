import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { pluginRpc, PluginRpcError } from '../console-utils/remoteApi.js';
import { Badge, Button, ConfirmButton, EmptyState, ErrorState, Field, LoadingState, Notice, PageHeader, PluginPage, Section, StaleNotice } from '../ui/components.js';
import { useLocale, type PluginUiText } from '../ui/locale.js';
import { resolvePluginId } from '../ui/plugin-id.js';
import { usePluginRpc } from '../ui/rpc.js';
import { pluginUiStyles } from '../ui/styles.js';
import { reviewMessages } from './messages.js';
import { reviewConsoleStyles } from './styles.js';
import type { CommentReviewSpec, ReviewContext, ReviewDraftBase, ReviewEndpointBase, ReviewStatus } from './types.js';

const COMMENT_LIMIT = 1000;
const DEFAULT_POLL_MS = 10_000;
const DEFAULT_PENDING_POLL_MS = 2_000;
const SUCCESS_NOTICE_MS = 6_000;

type AnySpec = CommentReviewSpec<ReviewEndpointBase, ReviewDraftBase>;
type PageNotice = { readonly tone: 'success' | 'danger'; readonly message: string; readonly link?: string };
type Busy = '' | 'send' | 'save' | 'drop';

/** 页面会话：把一次渲染里的 spec、文案与 RPC 能力传给子组件。 */
interface Session {
  readonly spec: AnySpec;
  readonly t: PluginUiText['t'];
  readonly locale: PluginUiText['locale'];
  readonly call: <T>(method: string, data?: Record<string, unknown>) => Promise<T>;
  readonly refresh: () => void;
  readonly notify: (notice: PageNotice) => void;
}

function failureText(error: unknown, t: PluginUiText['t']): string {
  if (error instanceof PluginRpcError && error.code === 'forbidden') return t('没有操作权限');
  return error instanceof Error && error.message ? error.message : t('操作失败');
}

function ago(at: number, t: PluginUiText['t']): string {
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return t('刚刚');
  if (minutes < 60) return t('{0} 分钟前', minutes);
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? t('{0} 小时前', hours) : t('{0} 天前', Math.floor(hours / 24));
}

/** 管理的资源（视频 / 文章…）链接列表，供 `renderResources` 使用。 */
export function ReviewResourceList({ title, items, empty, footnote }: {
  readonly title: string;
  readonly items: readonly { readonly key: string; readonly label: string; readonly url: string; readonly note?: string }[];
  readonly empty?: string;
  readonly footnote?: string;
}) {
  return (
    <Section title={title}>
      {items.length === 0
        ? (empty ? <p className="zk-hint">{empty}</p> : null)
        : (
          <ul className="zk-review-resources">
            {items.map(item => (
              <li key={item.key}>
                <a href={item.url} target="_blank" rel="noreferrer">{item.label}</a>
                {item.note && <span className="zk-hint"> {item.note}</span>}
              </li>
            ))}
          </ul>
        )}
      {footnote && <p className="zk-hint">{footnote}</p>}
    </Section>
  );
}

export function DraftCard({ draft, endpoint, session }: { draft: ReviewDraftBase; endpoint: ReviewEndpointBase; session: Session }) {
  const { spec, t, locale, call, refresh, notify } = session;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(draft.message);
  const [busy, setBusy] = useState<Busy>('');
  useEffect(() => { if (!editing) setValue(draft.message); }, [draft.message, editing]);
  const length = [...value].length;
  const over = length - COMMENT_LIMIT;
  const invalid = !value.trim() || over > 0;
  const sending = draft.status === 'sending' || busy === 'send';
  const canSend = endpoint.sendMode !== 'off' && endpoint.login.state === 'ok' && !endpoint.circuit;
  const platform = locale === 'en' ? spec.platform.en : spec.platform.zh;

  const act = async (kind: Exclude<Busy, ''>) => {
    setBusy(kind);
    try {
      if (kind === 'save') {
        await call('edit', { id: draft.id, message: value, locale });
        setEditing(false);
        notify({ tone: 'success', message: t('已保存修改') });
      } else if (kind === 'drop') {
        await call('drop', { id: draft.id, locale });
        notify({ tone: 'success', message: t('已丢弃') });
      } else {
        if (editing && value.trim() !== draft.message) {
          await call('edit', { id: draft.id, message: value, locale });
          setEditing(false);
        }
        const result = await call<{ url?: string }>('send', { id: draft.id, locale });
        notify({ tone: 'success', message: t('已发出'), ...(result?.url ? { link: result.url } : {}) });
      }
    } catch (error) {
      notify({ tone: 'danger', message: failureText(error, t) });
    } finally {
      setBusy('');
      refresh();
    }
  };

  return (
    <li className="zk-review-draft">
      <div className="zk-review-meta">
        <span>{spec.draftResource(draft, t)}</span>
        <span aria-hidden="true">·</span>
        <span>{ago(draft.createdAt, t)}</span>
        <a href={draft.url} target="_blank" rel="noreferrer">{t(spec.openLabel ?? '查看原评论')}</a>
      </div>
      {draft.interrupted && (
        <Notice tone="warning" title={t('结果未确认')}>{t('上次发送时程序中断或结果未知，这条可能已经发出。请先到{0}确认，避免重复回复。', platform)}</Notice>
      )}
      {draft.original !== undefined && (
        <div className="zk-review-quote">
          <div className="zk-review-label">{t('原评论')}{draft.author ? ` · ${draft.author}` : ''}</div>
          <div className="zk-review-body">{draft.original}</div>
        </div>
      )}
      {editing ? (
        <Field label={t('拟回复')} hint={t('{0} / {1} 字', length, COMMENT_LIMIT)} error={over > 0 ? t('超出 {0} 字', over) : undefined}>
          <textarea value={value} rows={4} onChange={event => setValue(event.target.value)} />
        </Field>
      ) : (
        <div>
          <div className="zk-review-label">{t('拟回复')}</div>
          <div className="zk-review-body">{draft.message}</div>
        </div>
      )}
      <div className="zk-review-actions">
        <Button variant="primary" busy={sending} disabled={!canSend || busy !== '' || invalid} onClick={() => act('send')}>
          {sending ? t('发送中…') : t('发送')}
        </Button>
        {editing
          ? <Button busy={busy === 'save'} disabled={busy !== '' || invalid} onClick={() => act('save')}>{t('保存')}</Button>
          : <Button disabled={busy !== '' || sending} onClick={() => setEditing(true)}>{t('修改')}</Button>}
        {editing && <Button variant="ghost" disabled={busy !== ''} onClick={() => { setEditing(false); setValue(draft.message); }}>{t('取消')}</Button>}
        <span className="zk-review-actions__end">
          <ConfirmButton confirmLabel={t('丢弃草稿')} message={t('确定丢弃这条回复？不会发送。')}
            busy={busy === 'drop'} disabled={busy !== '' || sending} onConfirm={() => act('drop')}>{t('丢弃草稿')}</ConfirmButton>
        </span>
      </div>
    </li>
  );
}

function DeclarativeLoginExtras({
  endpoint,
  context,
  loginMode,
}: {
  endpoint: ReviewEndpointBase & Record<string, any>;
  context: ReviewContext;
  loginMode?: 'qr' | 'cookie-check' | 'none';
}) {
  const { t, pending, act } = context;
  const qr = endpoint.qr as
    | {
        readonly state: 'idle' | 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'failed';
        readonly image?: string;
        readonly expiresAt?: number;
        readonly error?: string;
      }
    | undefined;
  const active = Boolean(qr && (qr.state === 'waiting' || qr.state === 'scanned'));
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  if (loginMode === 'cookie-check') {
    return (
      <div className="zk-row">
        <Button busy={pending === 'login-check'} disabled={pending !== undefined} onClick={() => act('login-check')}>
          {t('重新检查登录')}
        </Button>
      </div>
    );
  }

  if (loginMode === 'qr' && qr) {
    const login = endpoint.login as { readonly state: 'none' | 'ok' | 'expired'; readonly source?: 'config' | 'qr' };
    const configCookie = login.source === 'config';
    if (active && qr.image) {
      return (
        <div className="zk-media">
          <img className="zk-qr" src={qr.image} alt={t('登录二维码')} />
          <div className="zk-media__body">
            <strong>{t(qr.state === 'scanned' ? '已扫码，请在手机上确认登录' : '用 B 站 App 扫一扫')}</strong>
            {qr.expiresAt && (
              <span className="zk-hint">{t('剩余 {0} 秒', Math.max(0, Math.ceil((qr.expiresAt - now) / 1000)))}</span>
            )}
            <span className="zk-hint">{t('登录凭据只保存在运行机器人的这台机器上，不会写进配置文件。')}</span>
            <div>
              <Button busy={pending === 'login-cancel'} disabled={pending !== undefined} onClick={() => act('login-cancel')}>
                {t('取消')}
              </Button>
            </div>
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
          <Button variant="primary" busy={pending === 'login'} disabled={pending !== undefined} onClick={() => act('login')}>
            {t(retry ? '重新扫码' : '扫码登录 B 站')}
          </Button>
        )}
        {login.state === 'ok' && login.source === 'qr' && (
          <>
            <Button busy={pending === 'login'} disabled={pending !== undefined} onClick={() => act('login')}>
              {t('重新扫码')}
            </Button>
            <Button busy={pending === 'logout'} disabled={pending !== undefined} onClick={() => act('logout')}>
              {t('退出登录')}
            </Button>
          </>
        )}
      </div>
    );
  }

  return null;
}

function DeclarativeResources({
  endpoint,
  context,
  resourcesKey,
}: {
  endpoint: ReviewEndpointBase & Record<string, any>;
  context: ReviewContext;
  resourcesKey?: string;
}) {
  if (!resourcesKey) return null;
  const { t, noun } = context;
  const rawList = Array.isArray(endpoint[resourcesKey]) ? (endpoint[resourcesKey] as Array<Record<string, any>>) : [];
  const items = rawList.map((item) => {
    const key = String(item.ref ?? item.id ?? item.url ?? '');
    const label = String(item.ref ?? item.id ?? item.title ?? item.url ?? '');
    const url = String(item.url ?? '#');
    return { key, label, url };
  });
  const emptyText =
    resourcesKey === 'videos'
      ? t('还没有配置视频。要管理哪些视频请在配置的 videos 里填写 BV 号。')
      : resourcesKey === 'articles'
        ? t('还没有配置文章。要管理哪些文章请在配置的 articles 里填写文章 id 或链接。')
        : t('还没有配置{0}。', noun);
  const extraResources = Array.isArray(endpoint.resources)
    ? (endpoint.resources as Array<{ kind: 'dynamic' | 'article'; ref: string; url: string; error?: string }>)
    : [];

  return (
    <>
      <ReviewResourceList
        title={t('管理的{0}', noun)}
        items={items}
        empty={emptyText}
        footnote={t('{0}列表来自配置，要增删请改配置文件。', noun)}
      />
      {extraResources.length > 0 && (
        <ReviewResourceList
          title={t('管理的动态 / 专栏')}
          items={extraResources.map((resource) => ({
            key: `${resource.kind}:${resource.ref}`,
            url: resource.url,
            label: resource.kind === 'article' ? `cv${resource.ref}` : `${t('动态')} ${resource.ref}`,
            ...(resource.error !== undefined ? { note: t('无法解析，已跳过') } : {}),
          }))}
          footnote={t('列表来自配置（dynamics / articles），要增删请改配置文件。')}
        />
      )}
    </>
  );
}

export function EndpointSection({ endpoint, showTitle, session }: { endpoint: ReviewEndpointBase; showTitle: boolean; session: Session }) {
  const { spec, t, locale, call, refresh, notify } = session;
  const [pending, setPending] = useState<string | undefined>();
  const platform = locale === 'en' ? spec.platform.en : spec.platform.zh;
  const context: ReviewContext = {
    t, locale, pending,
    noun: locale === 'en' ? spec.resource.en : spec.resource.zh,
    act: async (method) => {
      setPending(method);
      try { await call(method, { endpoint: endpoint.id, locale }); refresh(); }
      catch (error) { notify({ tone: 'danger', message: failureText(error, t) }); }
      finally { setPending(undefined); }
    },
  };
  const { id, name } = spec.account(endpoint);
  const identity = name && id ? `${name} · uid ${id}` : id ? `uid ${id}` : name ?? '';
  const state = endpoint.login.state;
  const hint = spec.loginHint?.(endpoint, t);

  return (
    <div className="zk-card">
      {showTitle && <Section title={t('账号 {0}', endpoint.id)} />}
      <div className="zk-stack">
        <div className="zk-row">
          <Badge tone={state === 'ok' ? 'success' : state === 'expired' ? 'warning' : 'neutral'}>
            {state === 'ok' ? t('已登录') : state === 'expired' ? t('登录已失效') : t('未登录')}
          </Badge>
          {identity && <span>{identity}</span>}
        </div>
        {hint && <p className="zk-hint">{hint}</p>}
        {spec.renderLoginExtras
          ? spec.renderLoginExtras(endpoint, context)
          : <DeclarativeLoginExtras endpoint={endpoint as ReviewEndpointBase & Record<string, any>} context={context} loginMode={spec.loginMode} />}
      </div>
      {endpoint.circuit && <Notice tone="danger">{t('触发了{0}风控或账号异常（错误码 {1}），已暂停轮询和发送。请到网页端确认账号状态，处理后重启。', platform, endpoint.circuit.code)}</Notice>}
      {endpoint.sendMode === 'off' && <p className="zk-hint">{t('出站已关闭（sendMode: off），草稿无法发送。')}</p>}

      <Section title={<>{t('待审回复')} {endpoint.pendingCount > 0 && <Badge tone="warning">{endpoint.pendingCount}</Badge>}</>}>
        {!endpoint.persistent && <p className="zk-hint">{t('草稿只存在内存里，重启会丢失。')}</p>}
        {endpoint.drafts.length === 0
          ? <EmptyState title={t('没有待审的回复。新的 AI 回复会自动出现在这里。')} />
          : <ul className="zk-list">{endpoint.drafts.map(draft => <DraftCard key={draft.id} draft={draft} endpoint={endpoint} session={session} />)}</ul>}
      </Section>
      {spec.renderResources
        ? spec.renderResources(endpoint, context)
        : <DeclarativeResources endpoint={endpoint as ReviewEndpointBase & Record<string, any>} context={context} resourcesKey={spec.resourcesKey} />}
    </div>
  );
}

export function CommentReviewSession({ spec }: { spec: AnySpec }) {
  const dictionary = useMemo(() => ({ ...reviewMessages, ...spec.dictionary }), [spec]);
  const { t, locale } = useLocale(dictionary);
  const [pluginId, setPluginId] = useState<string | undefined>();
  const [notice, setNotice] = useState<PageNotice | undefined>();
  const [manual, setManual] = useState(false);
  const [fast, setFast] = useState(false);
  const platform = locale === 'en' ? spec.platform.en : spec.platform.zh;

  useEffect(() => {
    let alive = true;
    void resolvePluginId({ adapter: spec.adapter, fallback: `root/${spec.adapter}` }).then(id => { if (alive) setPluginId(id); }, () => undefined);
    return () => { alive = false; };
  }, [spec.adapter]);

  const resource = usePluginRpc<ReviewStatus>(pluginId, 'status', undefined, {
    pollMs: fast ? (spec.pendingPollMs ?? DEFAULT_PENDING_POLL_MS) : (spec.pollMs ?? DEFAULT_POLL_MS),
    isEmpty: status => status.endpoints.length === 0,
  });
  const pending = resource.data?.endpoints.some(endpoint => spec.isLoginPending?.(endpoint)) ?? false;
  useEffect(() => { setFast(pending); }, [pending]);

  useEffect(() => {
    if (!notice || notice.tone === 'danger') return;
    const timer = setTimeout(() => setNotice(undefined), SUCCESS_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const { refresh } = resource;
  const call = useCallback(<T,>(method: string, data?: Record<string, unknown>) => pluginRpc<T>(pluginId as string, method, data), [pluginId]);
  const session: Session = { spec, t, locale, call, refresh: () => { void refresh(); }, notify: setNotice };
  const manualRefresh = async () => { setManual(true); try { await refresh(); } finally { setManual(false); } };

  const endpoints = resource.data?.endpoints ?? [];
  return (
    <PluginPage>
      <style>{pluginUiStyles}{reviewConsoleStyles}</style>
      <PageHeader mark={spec.mark} title={t('{0}评论审批', platform)}
        description={t('AI 写好的{0}评论回复先停在这里，你点「发送」才会真的发出去。', platform)}
        actions={<Button busy={manual} onClick={manualRefresh}>{t('刷新')}</Button>} />
      {notice && (
        <Notice tone={notice.tone} onDismiss={() => setNotice(undefined)}>
          {notice.message}
          {notice.link && <> · <a href={notice.link} target="_blank" rel="noreferrer">{t('查看')}</a></>}
        </Notice>
      )}
      {resource.state === 'loading' && <LoadingState />}
      {resource.state === 'error' && (
        <ErrorState title={t('无法读取评论审批状态')} message={failureText(resource.error, t)} details={resource.error?.message} onRetry={manualRefresh} retrying={manual} />
      )}
      {resource.state === 'stale' && <StaleNotice lastSuccessAt={resource.lastSuccessAt} error={resource.error?.message} />}
      {resource.state === 'empty' && <EmptyState title={t('{0}适配器还没有启动。请先在配置里添加 {1} 插件和至少一个账号。', platform, spec.adapter)} />}
      {endpoints.map(endpoint => <EndpointSection key={endpoint.id} endpoint={endpoint} showTitle={endpoints.length > 1} session={session} />)}
    </PluginPage>
  );
}

/** 约定页工厂：`pages/index/index.tsx` 默认导出它的结果。 */
export function createCommentReviewPage<E extends ReviewEndpointBase<D>, D extends ReviewDraftBase = ReviewDraftBase>(
  spec: CommentReviewSpec<E, D>,
): React.ComponentType {
  return function CommentReviewRoute() {
    return <CommentReviewSession spec={spec as unknown as AnySpec} />;
  };
}
