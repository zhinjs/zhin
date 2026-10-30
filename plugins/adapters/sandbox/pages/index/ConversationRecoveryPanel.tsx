import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MarkdownContent, type MessageSegment } from '@zhin.js/client';
import { sandboxText, type SandboxLocale } from './messages.js';
import { captureSandboxRequestContext, type SandboxRequestContext } from './sandboxTransport.js';
import { prependResultPage, readConversationResults, readPendingInteractions, resultDeliveryStatus,
  type PendingInteraction, type RecoveredResultPage } from './conversationRecovery.js';

export interface ConversationRecoveryProps {
  readonly connectionId: string;
  readonly sessionKey: string;
  readonly locale: SandboxLocale;
  readonly hidden?: boolean;
  readonly requestContext?: SandboxRequestContext;
  /** Existing transport activity invalidates this read; it is not an approval acknowledgement. */
  readonly pendingRefreshEpoch?: number;
  readonly onRetiredInteractions?: (interactions: readonly PendingInteraction[]) => void;
  readonly renderInteraction: (segments: MessageSegment[], id: string, submitted: boolean, onSubmitted: () => void) => React.ReactNode;
}

/** Mounted under an exact connection and scene key; its requests never outlive that owner. */
export default function ConversationRecoveryPanel(props: ConversationRecoveryProps) {
  const { connectionId, sessionKey, locale } = props;
  const [pending, setPending] = useState<readonly PendingInteraction[]>([]);
  const [page, setPage] = useState<RecoveredResultPage | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<ReadonlySet<string>>(new Set());
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const retiredListener = useRef(props.onRetiredInteractions);
  retiredListener.current = props.onRetiredInteractions;
  const owner = useRef<{ controller: AbortController; context: SandboxRequestContext; interactions: readonly PendingInteraction[]; pendingController?: AbortController; pending?: Promise<void>; results?: Promise<void> } | null>(null);
  const reloadPending = useCallback(async (explicit = false) => {
    const current = owner.current;
    if (!current) return;
    // A later transport event must not reuse a GET started before that event.
    current.pendingController?.abort();
    const controller = new AbortController();
    current.pendingController = controller;
    const active = () => owner.current === current && current.pendingController === controller
      && !current.controller.signal.aborted && !controller.signal.aborted;
    current.pending = (async () => {
      try {
        const data = await readPendingInteractions(connectionId, sessionKey, controller.signal, current.context);
        if (!active()) return;
        const pending = data?.pending ?? [];
        const retired = data ? current.interactions.filter(previous => !pending.some(next => next.generation === previous.generation && next.id === previous.id)) : [];
        if (data) current.interactions = pending;
        setPending(pending);
        // Only an explicit successful authority read can release a still-current submitted choice.
        const ids = new Set(pending.map(interaction => interaction.id));
        setSubmitted(previous => new Set([...previous].filter(id => !explicit && ids.has(id))));
        setPendingError(null);
        if (retired.length) retiredListener.current?.(retired);
      } catch (error) {
        if (active()) setPendingError(error instanceof Error ? error.message : String(error));
      } finally { if (current.pendingController === controller) current.pending = undefined; }
    })();
    return current.pending;
  }, [connectionId, sessionKey]);

  const reloadResults = useCallback(async () => {
    const current = owner.current;
    if (!current) return;
    if (current.results) return current.results;
    current.results = (async () => {
      try {
        const data = await readConversationResults(connectionId, sessionKey, current.controller.signal, undefined, current.context);
        if (owner.current !== current || current.controller.signal.aborted) return;
        if (data && data.sessionKey !== sessionKey) throw new Error('Result belongs to another conversation');
        setPage(data);
        setResultError(null);
      } catch (error) {
        if (owner.current === current && !current.controller.signal.aborted) setResultError(error instanceof Error ? error.message : String(error));
      } finally { current.results = undefined; }
    })();
    return current.results;
  }, [connectionId, sessionKey]);

  useEffect(() => {
    const current: NonNullable<typeof owner.current> = { controller: new AbortController(), context: props.requestContext ?? captureSandboxRequestContext(), interactions: [] };
    owner.current = current;
    return () => { current.pendingController?.abort(); if (owner.current === current) owner.current = null; current.controller.abort(); };
  }, [reloadPending, reloadResults, props.requestContext]);
  useEffect(() => { void reloadPending(); }, [reloadPending, props.pendingRefreshEpoch, props.requestContext]);
  useEffect(() => { void reloadResults(); }, [reloadResults, props.requestContext]);

  const earlier = async () => {
    const current = owner.current;
    if (!current || !page?.hasMore || !page.nextCursor || current.results) return;
    const previous = page;
    setLoadingEarlier(true);
    current.results = (async () => {
      try {
        const next = await readConversationResults(connectionId, sessionKey, current.controller.signal, previous.nextCursor!, current.context);
        if (owner.current !== current || current.controller.signal.aborted) return;
        if (!next) throw new Error('Result paging is unavailable');
        setPage(prependResultPage(previous, next));
        setResultError(null);
      } catch (error) {
        if (owner.current === current && !current.controller.signal.aborted) setResultError(error instanceof Error ? error.message : String(error));
      } finally {
        current.results = undefined;
        if (owner.current === current) setLoadingEarlier(false);
      }
    })();
    return current.results;
  };

  const results = page?.results.filter(result => resultDeliveryStatus(result) !== 'sent') ?? [];
  if (!pending.length && !results.length && !pendingError && !resultError && !page?.hasMore) return null;
  return <div className="agent-playground-recovery" hidden={props.hidden}>
    {pendingError ? <p role="alert">{pendingError} <button type="button" onClick={() => void reloadPending(true)}>{sandboxText(locale, '重试')}</button></p> : null}
    {pending.length ? <button type="button" onClick={() => void reloadPending(true)}>{sandboxText(locale, '重新读取')}</button> : null}
    {pending.map(interaction => <section key={`${interaction.generation}:${interaction.id}`}>
      <h3>{sandboxText(locale, '待处理操作')}</h3>
      {props.renderInteraction(interaction.segments, interaction.id, submitted.has(interaction.id), () => {
        setSubmitted(previous => new Set([...previous, interaction.id]));
        void reloadPending();
      })}
    </section>)}
    {resultError ? <p role="alert">{resultError} <button type="button" onClick={() => void reloadResults()}>{sandboxText(locale, '重试')}</button></p> : null}
    {page?.hasMore ? <button type="button" disabled={loadingEarlier} onClick={() => void earlier()}>{sandboxText(locale, '加载更早结果')}</button> : null}
    {results.map(result => {
      const status = resultDeliveryStatus(result);
      const resources = new Map(result.deliveries.flatMap(delivery => delivery.resources).map(resource => [resource.url, resource]));
      return <details key={result.turnId}>
        <summary>{sandboxText(locale, status === 'not_sent' ? '已完成，未投递' : status === 'partial' ? '已完成，部分内容未投递' : '已完成，投递结果未知')}
          <time>{new Date(result.completedAt).toLocaleString(locale)}</time></summary>
        <MarkdownContent text={result.message} />
        {[...resources.values()].map(resource => <a key={resource.url} href={resource.url} target="_blank" rel="noopener noreferrer">{resource.type}</a>)}
      </details>;
    })}
  </div>;
}
