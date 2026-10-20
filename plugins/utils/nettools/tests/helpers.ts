import { HttpClient, type FetchLike, type HttpDependencies, type RetryPolicy } from '../src/http.js';

export type Route = (url: URL, init: RequestInit) => Response | Promise<Response>;

export interface FakeNetwork {
  readonly dependencies: HttpDependencies;
  readonly calls: URL[];
  readonly sleeps: number[];
  readonly clock: { now: number };
  route(match: string, handler: Route): void;
}

/**
 * In-memory network: routes are matched by "host/path" prefix, in
 * registration order; an unmatched request fails like a refused connection.
 * Sleeps are recorded and resolve immediately (advancing the fake clock).
 */
export function createFakeNetwork(): FakeNetwork {
  const routes: { match: string; handler: Route }[] = [];
  const calls: URL[] = [];
  const sleeps: number[] = [];
  const clock = { now: 1_800_000_000_000 };
  const fetch: FetchLike = async (url, init) => {
    calls.push(url);
    const key = `${url.hostname}${url.pathname}`;
    const route = routes.find((candidate) => key.startsWith(candidate.match));
    if (!route) {
      throw new TypeError(`fetch failed: no route for ${key}`);
    }
    return route.handler(url, init);
  };
  const dependencies: HttpDependencies = {
    fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.now += ms;
    },
    random: () => 0.5,
    now: () => clock.now,
  };
  return {
    dependencies,
    calls,
    sleeps,
    clock,
    route(match, handler) {
      routes.push({ match, handler });
    },
  };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** Respond with each handler in turn; the last one repeats. */
export function sequence(...responses: (() => Response | Promise<Response>)[]): Route {
  let index = 0;
  return () => {
    const responder = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (!responder) {
      throw new Error('empty sequence');
    }
    return responder();
  };
}

/** A fetch that never answers until its signal aborts (simulates a hung upstream). */
export const hang: Route = (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('aborted')), { once: true });
  });

export const FAST_POLICY: RetryPolicy = {
  timeoutMs: 1_000,
  maxRetries: 2,
  baseDelayMs: 500,
  maxDelayMs: 4_000,
  maxRetryAfterMs: 10_000,
};

export function createClient(network: FakeNetwork, policy: Partial<RetryPolicy> = {}): HttpClient {
  return new HttpClient({ ...FAST_POLICY, ...policy }, network.dependencies);
}

export function doh(answers: { name: string; type: number; data: string }[], status = 0): unknown {
  return {
    Status: status,
    AD: false,
    Answer: answers.map((answer) => ({ ...answer, TTL: 60 })),
  };
}
