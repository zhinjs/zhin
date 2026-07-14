import {
  AGENT_STREAM_MEDIA_TYPE,
  ZHIN_AGENT_SESSION_API_PREFIX,
  ZHIN_SESSION_ID_HEADER,
  foldAgentStreamNdjson,
  iterateAgentStreamNdjson,
  type AgentStreamEvent,
  type AgentStreamReduceState,
  type ContinueAgentSessionResponse,
  type FoldAgentStreamOptions,
  type StartAgentSessionResponse,
} from "@zhin.js/contract";
import { getToken, resolveApiUrl } from "./console-utils/remoteApi.js";

export type AgentStreamClientOptions = {
  fetch?: typeof fetch;
};

function resolveFetch(options?: AgentStreamClientOptions): typeof fetch {
  const impl = options?.fetch ?? globalThis.fetch;
  if (!impl) throw new Error("fetch is not available");
  return impl;
}

async function authedFetch(
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const url = path.startsWith("/") ? resolveApiUrl(path) : path;
  const res = await fetchImpl(url, { ...init, headers });
  if (res.status === 401 && typeof localStorage !== "undefined") {
    sessionStorage.removeItem("zhin_api_token");
    localStorage.removeItem("zhin_api_token");
    window.dispatchEvent(new CustomEvent("zhin:auth-required"));
  }
  return res;
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/** POST /zhin/v1/session — start a Host agent session turn. */
export async function startAgentSession(
  message: string,
  options?: AgentStreamClientOptions,
): Promise<StartAgentSessionResponse> {
  const fetchImpl = resolveFetch(options);
  const res = await authedFetch(`${ZHIN_AGENT_SESSION_API_PREFIX}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  }, fetchImpl);
  return readJson<StartAgentSessionResponse>(res);
}

/** POST /zhin/v1/session/:sessionId — continue with continuationToken + message. */
export async function continueAgentSession(
  sessionId: string,
  continuationToken: string,
  message: string,
  options?: AgentStreamClientOptions,
): Promise<ContinueAgentSessionResponse> {
  const fetchImpl = resolveFetch(options);
  const res = await authedFetch(
    `${ZHIN_AGENT_SESSION_API_PREFIX}/session/${encodeURIComponent(sessionId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ continuationToken, message }),
    },
    fetchImpl,
  );
  return readJson<ContinueAgentSessionResponse>(res);
}

export type SubscribeAgentStreamOptions = FoldAgentStreamOptions & {
  startIndex?: number;
  fetch?: typeof fetch;
  onEvent?: (event: AgentStreamEvent, state: AgentStreamReduceState) => void;
};

/** GET /zhin/v1/session/:sessionId/stream — consume NDJSON until the stream closes. */
export async function subscribeAgentStream(
  sessionId: string,
  options?: SubscribeAgentStreamOptions,
): Promise<AgentStreamReduceState> {
  const fetchImpl = resolveFetch(options);
  const startIndex = options?.startIndex ?? 0;
  const query = startIndex > 0 ? `?startIndex=${startIndex}` : "";
  const res = await authedFetch(
    `${ZHIN_AGENT_SESSION_API_PREFIX}/session/${encodeURIComponent(sessionId)}/stream${query}`,
    {
      method: "GET",
      headers: { Accept: AGENT_STREAM_MEDIA_TYPE },
    },
    fetchImpl,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  const headerSessionId = res.headers.get(ZHIN_SESSION_ID_HEADER);
  if (headerSessionId && headerSessionId !== sessionId) {
    throw new Error(`stream session id mismatch: ${headerSessionId}`);
  }
  if (!res.body) {
    throw new Error("stream response has no body");
  }
  return foldAgentStreamNdjson(res.body, options);
}

export { iterateAgentStreamNdjson, foldAgentStreamNdjson };
