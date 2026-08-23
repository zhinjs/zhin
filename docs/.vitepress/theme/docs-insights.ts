import type { Router } from 'vitepress';

export const DOCS_INSIGHTS_CONSENT_KEY = 'zhin:docs-insights-consent:v1';
export const DOCS_INSIGHTS_CONSENT_EVENT = 'zhin:docs-insights-consent-change';

export type DocsInsightsConsent = 'granted' | 'denied';
export type DocsInsightEvent = 'page_view' | 'page_exit' | 'not_found' | 'search' | 'search_no_results';
export type ViewportBucket = 'phone' | 'tablet' | 'desktop';
export type DwellBucket = 'under_10s' | '10s_to_60s' | '1m_to_5m' | 'over_5m';

export type DocsInsight = {
  schemaVersion: 1;
  event: DocsInsightEvent;
  path: string;
  previousPath?: string;
  locale: 'zh' | 'en';
  viewport: ViewportBucket;
  siteId: string;
  dwell?: DwellBucket;
  searchTerm?: string;
  searchRedacted?: boolean;
  resultCount?: number;
};

type BuildDocsInsightInput = {
  event: DocsInsightEvent;
  path: string;
  previousPath?: string;
  viewportWidth: number;
  siteId: string;
  dwellMs?: number;
  search?: string;
  resultCount?: number;
};

const SENSITIVE_SEARCH_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /\b(?:https?|ftp):\/\//iu,
  /\b(?:bearer|token|password|passwd|secret|api[\s_-]?key)\s*[:=]?\s*\S+/iu,
  /\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|AKIA[A-Z0-9]{12,}|AIza[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/u,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u,
  /\b[0-9a-f]{32,}\b/iu,
  /\b[A-Za-z0-9+/=_-]{48,}\b/u,
];
const SAFE_SEARCH_TERM = /^[\p{L}\p{N}\p{M}]+(?:[ -][\p{L}\p{N}\p{M}]+)*$/u;

export function sanitizeDocsPath(value: string): string {
  try {
    const parsed = new URL(value, 'https://docs.invalid');
    return parsed.pathname.replace(/\/{2,}/gu, '/') || '/';
  } catch {
    return '/';
  }
}

export function sanitizeSearchTerm(value: string): { term?: string; redacted: boolean } {
  const normalized = value.replace(/\s+/gu, ' ').trim().slice(0, 64);
  if (!normalized) return { term: undefined, redacted: false };
  const hasSuspiciousMixedToken = normalized.split(/[ -]+/u).some((token) => (
    token.length >= 24 || (token.length >= 7 && /\p{L}/u.test(token) && /\p{N}/u.test(token))
  ));
  if (!SAFE_SEARCH_TERM.test(normalized) || hasSuspiciousMixedToken || SENSITIVE_SEARCH_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { term: undefined, redacted: true };
  }
  return { term: normalized, redacted: false };
}

export function viewportBucket(width: number): ViewportBucket {
  if (width < 768) return 'phone';
  if (width < 1280) return 'tablet';
  return 'desktop';
}

export function dwellBucket(milliseconds: number): DwellBucket {
  if (milliseconds < 10_000) return 'under_10s';
  if (milliseconds < 60_000) return '10s_to_60s';
  if (milliseconds < 300_000) return '1m_to_5m';
  return 'over_5m';
}

export function shouldCollectDocsInsights(input: {
  endpoint: string;
  consent: DocsInsightsConsent | null;
  doNotTrack?: string | null;
}): boolean {
  const dnt = input.doNotTrack?.toLowerCase();
  return Boolean(input.endpoint) && input.consent === 'granted' && dnt !== '1' && dnt !== 'yes';
}

export function buildDocsInsight(input: BuildDocsInsightInput): DocsInsight {
  const search = input.search === undefined ? undefined : sanitizeSearchTerm(input.search);
  const path = sanitizeDocsPath(input.path);
  return {
    schemaVersion: 1,
    event: input.event,
    path,
    ...(input.previousPath ? { previousPath: sanitizeDocsPath(input.previousPath) } : {}),
    locale: path === '/en' || path.startsWith('/en/') ? 'en' : 'zh',
    viewport: viewportBucket(input.viewportWidth),
    siteId: input.siteId.slice(0, 40) || 'zhin-docs',
    ...(input.dwellMs === undefined ? {} : { dwell: dwellBucket(input.dwellMs) }),
    ...(search?.term ? { searchTerm: search.term } : {}),
    ...(search ? { searchRedacted: search.redacted } : {}),
    ...(input.resultCount === undefined ? {} : { resultCount: Math.max(0, Math.min(100, Math.trunc(input.resultCount))) }),
  };
}

export function readDocsInsightsConsent(storage: Pick<Storage, 'getItem'> = localStorage): DocsInsightsConsent | null {
  try {
    const value = storage.getItem(DOCS_INSIGHTS_CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch {
    return null;
  }
}

export function setDocsInsightsConsent(value: DocsInsightsConsent, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(DOCS_INSIGHTS_CONSENT_KEY, value);
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent(DOCS_INSIGHTS_CONSENT_EVENT, { detail: value }));
}

function validCollectorEndpoint(value: string): string {
  if (!value) return '';
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.protocol !== 'https:' && parsed.origin !== window.location.origin) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function sendInsight(endpoint: string, event: DocsInsight): void {
  const body = JSON.stringify(event);
  window.dispatchEvent(new CustomEvent('zhin:docs-insight', { detail: event }));
  void fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
    credentials: 'omit',
  }).catch(() => undefined);
}

export function installDocsInsights(router: Router, options: { endpoint: string; siteId: string }): () => void {
  const endpoint = validCollectorEndpoint(options.endpoint);
  let currentPath = sanitizeDocsPath(router.route.path || window.location.pathname);
  let previousPath: string | undefined;
  let pageStartedAt = performance.now();
  let searchTimer: number | undefined;
  let lastSearchKey = '';

  const enabled = () => shouldCollectDocsInsights({
    endpoint,
    consent: readDocsInsightsConsent(),
    doNotTrack: navigator.doNotTrack,
  });
  const emit = (input: Omit<BuildDocsInsightInput, 'viewportWidth' | 'siteId'>) => {
    if (!enabled()) return;
    sendInsight(endpoint, buildDocsInsight({
      ...input,
      viewportWidth: window.innerWidth,
      siteId: options.siteId,
    }));
  };
  const emitEntry = () => emit({
    event: router.route.data.isNotFound ? 'not_found' : 'page_view',
    path: currentPath,
    previousPath,
  });
  const emitExit = () => emit({
    event: 'page_exit',
    path: currentPath,
    previousPath,
    dwellMs: performance.now() - pageStartedAt,
  });

  const collectSearch = (target: HTMLInputElement, query: string, attempt = 0) => {
    if (!target.isConnected || target.value.trim() !== query) return;
    const root = target.closest('.VPLocalSearchBox');
    const resultCount = root?.querySelectorAll('.results .result').length ?? 0;
    const noResults = Boolean(root?.querySelector('.results .no-results'));
    if (resultCount === 0 && !noResults && attempt < 15) {
      searchTimer = window.setTimeout(() => collectSearch(target, query, attempt + 1), 100);
      return;
    }
    const key = `${query}\u0000${resultCount}\u0000${noResults}`;
    if (key === lastSearchKey) return;
    lastSearchKey = key;
    emit({
      event: noResults ? 'search_no_results' : 'search',
      path: currentPath,
      search: query,
      resultCount,
    });
  };

  const onInput = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.matches('.VPLocalSearchBox #localsearch-input')) return;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      const query = target.value.trim();
      if (query.length < 2) return;
      collectSearch(target, query);
    }, 400);
  };
  const onPageHide = () => emitExit();
  const onConsent = (event: Event) => {
    if ((event as CustomEvent<DocsInsightsConsent>).detail === 'granted' && enabled()) {
      pageStartedAt = performance.now();
      emitEntry();
    }
  };
  const previousAfterRouteChange = router.onAfterRouteChange;
  const routeChangeWrapper: NonNullable<Router['onAfterRouteChange']> = async (to) => {
    await previousAfterRouteChange?.(to);
    emitExit();
    previousPath = currentPath;
    currentPath = sanitizeDocsPath(to);
    pageStartedAt = performance.now();
    lastSearchKey = '';
    emitEntry();
  };
  router.onAfterRouteChange = routeChangeWrapper;

  document.addEventListener('input', onInput);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener(DOCS_INSIGHTS_CONSENT_EVENT, onConsent);
  emitEntry();

  return () => {
    window.clearTimeout(searchTimer);
    document.removeEventListener('input', onInput);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener(DOCS_INSIGHTS_CONSENT_EVENT, onConsent);
    if (router.onAfterRouteChange === routeChangeWrapper) router.onAfterRouteChange = previousAfterRouteChange;
  };
}
