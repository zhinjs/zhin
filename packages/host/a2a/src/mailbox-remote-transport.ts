/**
 * ADR 0048 §3.6 (H5) — Cross-process A2A Remote Mailbox transport.
 *
 * Carries a serialized `Mail` envelope, attenuated `Authority`, and carved-out
 * `BudgetAmounts` across process boundaries with HMAC-SHA256 signature
 * verification, replay protection, and Bearer authentication.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  BUDGET_KEYS,
  TRUST_LEVELS,
  type ActorId,
  type BudgetAmounts,
  type Mail,
  type RemoteMailResult,
  type RemoteMailTransport,
  type TrustLevel,
} from '@zhin.js/harness';
import { HttpBodyError, jsonResponse, readJsonBody, type HttpRouteHost } from '@zhin.js/host-http-contract';
import type { AgentHostPort } from '@zhin.js/agent/runtime';
import { verifyA2aBearer } from './auth.js';

export const DEFAULT_A2A_MAILBOX_PATH = '/a2a/mailbox';
const DEFAULT_MAX_BODY_BYTES = 262_144;
const DEFAULT_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_NONCE_CACHE_SIZE = 4096;

export interface A2AMailboxPeerConfig {
  readonly actor?: ActorId;
  readonly name?: ActorId;
  readonly url: string;
  readonly token?: string;
  readonly secret?: string;
  readonly timeoutMs?: number;
}

export interface RuntimeA2aMailboxConfig {
  readonly enabled?: boolean;
  readonly path?: string;
  readonly secret?: string;
  readonly maxBodyBytes?: number;
  readonly peers?: readonly A2AMailboxPeerConfig[];
}

export interface A2AMailboxUnsignedPayload {
  readonly mail: Mail;
  readonly grantedBudget: BudgetAmounts;
  readonly timestamp: number;
  readonly nonce: string;
}

export interface A2AMailboxEnvelope extends A2AMailboxUnsignedPayload {
  readonly signature: string;
}

export type A2AMailboxInboundHandler = (
  mail: Mail,
  grantedBudget: BudgetAmounts,
) => Promise<RemoteMailResult>;

export interface A2AMailboxTransportOptions {
  readonly peers?: readonly A2AMailboxPeerConfig[];
  readonly secret?: string;
  readonly token?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly maxClockSkewMs?: number;
  readonly onReceive?: A2AMailboxInboundHandler;
}

export interface InstallRuntimeA2aMailboxOptions {
  readonly http: HttpRouteHost;
  readonly agentHost?: AgentHostPort;
  readonly config?: RuntimeA2aMailboxConfig;
  readonly fallbackToken?: string;
  readonly production?: boolean;
  readonly onReceive?: A2AMailboxInboundHandler;
  readonly now?: () => number;
}

export interface RuntimeA2aMailboxInstallation {
  readonly transport: A2AMailboxTransport;
  readonly dispose: () => void;
}

function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalizeJson(v)}`).join(',')}}`;
}

export function signMailboxEnvelope(payload: A2AMailboxUnsignedPayload, secret: string): string {
  if (!secret) {
    throw new Error('A2A Mailbox signing requires a non-empty secret');
  }
  const canonical = canonicalizeJson({
    mail: payload.mail,
    grantedBudget: payload.grantedBudget,
    timestamp: payload.timestamp,
    nonce: payload.nonce,
  });
  const digest = createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
  return `sha256=${digest}`;
}

function isTrustLevel(value: unknown): value is TrustLevel {
  return typeof value === 'string' && (TRUST_LEVELS as readonly string[]).includes(value);
}

function trustIndex(level: TrustLevel): number {
  return TRUST_LEVELS.indexOf(level);
}

function validateBudgetAmounts(value: unknown): value is BudgetAmounts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  for (const key of BUDGET_KEYS) {
    const amount = record[key];
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      return false;
    }
  }
  return true;
}

function validateMailEnvelope(value: unknown): value is Mail {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const mail = value as Record<string, unknown>;
  if (typeof mail.id !== 'string' || !mail.id.trim()) return false;
  if (typeof mail.kind !== 'string' || !mail.kind.trim()) return false;
  if (typeof mail.engagementId !== 'string' || !mail.engagementId.trim()) return false;
  if (typeof mail.to !== 'string' || !mail.to.trim()) return false;
  if (typeof mail.grantId !== 'string' || !mail.grantId.trim()) return false;
  if (typeof mail.createdAt !== 'number' || !Number.isFinite(mail.createdAt)) return false;
  if (!mail.from || typeof mail.from !== 'object') return false;
  if (!mail.body || typeof mail.body !== 'object') return false;
  const authority = mail.authority as Record<string, unknown> | undefined;
  if (!authority || typeof authority !== 'object') return false;
  const principal = authority.principal as Record<string, unknown> | undefined;
  if (!principal || typeof principal !== 'object') return false;
  if (typeof principal.id !== 'string' || !principal.id.trim()) return false;
  if (!isTrustLevel(principal.trust) || !isTrustLevel(authority.trust)) return false;
  // Invariant 1: effective authority trust must never exceed principal trust.
  if (trustIndex(authority.trust) > trustIndex(principal.trust)) return false;
  return true;
}

function capConsumedBudget(
  consumed: Partial<BudgetAmounts> | undefined,
  granted: BudgetAmounts,
): Partial<BudgetAmounts> | undefined {
  if (!consumed) return undefined;
  const out: Partial<Record<keyof BudgetAmounts, number>> = {};
  for (const key of BUDGET_KEYS) {
    const raw = consumed[key];
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
      out[key] = Math.min(raw, granted[key]);
    }
  }
  return Object.freeze(out);
}

export type VerifyMailboxEnvelopeResult =
  | { readonly ok: true; readonly mail: Mail; readonly grantedBudget: BudgetAmounts }
  | { readonly ok: false; readonly status: 400 | 401 | 403; readonly error: string };

export function verifyMailboxEnvelope(
  raw: unknown,
  secret: string,
  options: {
    readonly headerSignature?: string;
    readonly now?: number;
    readonly maxClockSkewMs?: number;
    readonly seenNonces?: Set<string>;
  } = {},
): VerifyMailboxEnvelopeResult {
  if (!secret) {
    return { ok: false, status: 401, error: 'A2A Mailbox secret is not configured' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, status: 400, error: 'Invalid A2A Mailbox envelope' };
  }
  const envelope = raw as Record<string, unknown>;
  const signature = typeof options.headerSignature === 'string' && options.headerSignature.trim()
    ? options.headerSignature.trim()
    : typeof envelope.signature === 'string'
      ? envelope.signature.trim()
      : '';
  if (!signature.startsWith('sha256=')) {
    return { ok: false, status: 401, error: 'Missing or malformed A2A Mailbox signature' };
  }
  const timestamp = envelope.timestamp;
  const nonce = envelope.nonce;
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || typeof nonce !== 'string' || !nonce.trim()) {
    return { ok: false, status: 400, error: 'Missing timestamp or nonce in A2A Mailbox envelope' };
  }
  const now = options.now ?? Date.now();
  const maxSkew = options.maxClockSkewMs ?? DEFAULT_MAX_CLOCK_SKEW_MS;
  if (Math.abs(now - timestamp) > maxSkew) {
    return { ok: false, status: 401, error: 'A2A Mailbox envelope timestamp outside allowed skew window' };
  }
  if (!validateMailEnvelope(envelope.mail)) {
    return { ok: false, status: 403, error: 'Invalid or unattenuated Mail authority in A2A Mailbox envelope' };
  }
  if (!validateBudgetAmounts(envelope.grantedBudget)) {
    return { ok: false, status: 400, error: 'Invalid grantedBudget in A2A Mailbox envelope' };
  }
  const expected = signMailboxEnvelope(
    {
      mail: envelope.mail,
      grantedBudget: envelope.grantedBudget,
      timestamp,
      nonce,
    },
    secret,
  );
  const actualBuf = Buffer.from(signature, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    return { ok: false, status: 401, error: 'A2A Mailbox signature verification failed' };
  }
  if (options.seenNonces) {
    if (options.seenNonces.has(nonce)) {
      return { ok: false, status: 401, error: 'Replayed A2A Mailbox nonce rejected' };
    }
    if (options.seenNonces.size >= MAX_NONCE_CACHE_SIZE) {
      const oldest = options.seenNonces.values().next().value;
      if (oldest !== undefined) options.seenNonces.delete(oldest);
    }
    options.seenNonces.add(nonce);
  }
  return {
    ok: true,
    mail: envelope.mail,
    grantedBudget: envelope.grantedBudget,
  };
}

export class A2AMailboxTransport implements RemoteMailTransport {
  readonly #peers = new Map<string, A2AMailboxPeerConfig>();
  readonly #secret: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #maxClockSkewMs: number;
  readonly #seenNonces = new Set<string>();
  #onReceive?: A2AMailboxInboundHandler;

  constructor(options: A2AMailboxTransportOptions = {}) {
    for (const peer of options.peers ?? []) {
      const actor = (peer.actor ?? peer.name ?? '').trim();
      if (actor && peer.url.trim()) {
        this.#peers.set(actor, Object.freeze({ ...peer, actor, url: peer.url.trim() }));
      }
    }
    // `||`: an empty string means "not configured" and must fall through.
    this.#secret = options.secret || options.token || '';
    this.#token = options.token || options.secret || '';
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#now = options.now ?? Date.now;
    this.#maxClockSkewMs = options.maxClockSkewMs ?? DEFAULT_MAX_CLOCK_SKEW_MS;
    this.#onReceive = options.onReceive;
  }

  setInboundHandler(handler: A2AMailboxInboundHandler): void {
    this.#onReceive = handler;
  }

  canRoute(target: ActorId): boolean {
    return this.#resolvePeer(target) !== undefined;
  }

  hasPeer(target: ActorId): boolean {
    return this.canRoute(target);
  }

  async send(mail: Mail, grantedBudget: BudgetAmounts): Promise<RemoteMailResult> {
    const peer = this.#resolvePeer(mail.to);
    if (!peer) {
      return {
        status: 'rejected',
        content: `No remote A2A mailbox peer configured for actor "${mail.to}"`,
      };
    }
    const secret = peer.secret || this.#secret || peer.token || this.#token;
    if (!secret) {
      return {
        status: 'rejected',
        content: `Remote A2A mailbox peer "${peer.actor}" is missing signing secret`,
      };
    }
    const unsignedPayload: A2AMailboxUnsignedPayload = {
      mail,
      grantedBudget,
      timestamp: this.#now(),
      nonce: randomUUID(),
    };
    const signature = signMailboxEnvelope(unsignedPayload, secret);
    const envelope: A2AMailboxEnvelope = {
      ...unsignedPayload,
      signature,
    };
    const bearer = peer.token || this.#token || secret;
    const headers: Record<string, string> = {
      'content-type': 'application/json; charset=utf-8',
      'x-zhin-mailbox-signature': signature,
    };
    if (bearer) {
      headers.authorization = `Bearer ${bearer}`;
    }

    const controller = new AbortController();
    const timeoutMs = peer.timeoutMs ?? Math.max(1_000, grantedBudget.wallMs || 30_000);
    const timer = setTimeout(() => controller.abort(new Error('A2A Mailbox request timed out')), timeoutMs);
    timer.unref?.();

    try {
      const response = await this.#fetch(peer.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(envelope),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok || !body) {
        const errorText = typeof body?.error === 'string'
          ? body.error
          : `Remote A2A mailbox returned HTTP ${response.status}`;
        return {
          status: response.status === 499 ? 'cancelled' : 'rejected',
          content: errorText,
        };
      }
      const status = body.status === 'completed' || body.status === 'cancelled' || body.status === 'rejected'
        ? body.status
        : 'rejected';
      const content = typeof body.content === 'string' ? body.content : '';
      const consumed = capConsumedBudget(
        body.consumed as Partial<BudgetAmounts> | undefined,
        grantedBudget,
      );
      return Object.freeze({
        status,
        content,
        ...(consumed ? { consumed } : {}),
      });
    } catch (error) {
      if (controller.signal.aborted) {
        return {
          status: 'cancelled',
          content: error instanceof Error ? error.message : 'A2A Mailbox request aborted',
        };
      }
      return {
        status: 'rejected',
        content: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async receiveEnvelope(
    rawEnvelope: unknown,
    options: { readonly headerSignature?: string } = {},
  ): Promise<{ readonly httpStatus: number; readonly body: RemoteMailResult | { readonly error: string } }> {
    const verified = verifyMailboxEnvelope(rawEnvelope, this.#secret, {
      headerSignature: options.headerSignature,
      now: this.#now(),
      maxClockSkewMs: this.#maxClockSkewMs,
      seenNonces: this.#seenNonces,
    });
    if (!verified.ok) {
      return {
        httpStatus: verified.status,
        body: { error: verified.error },
      };
    }
    if (!this.#onReceive) {
      return {
        httpStatus: 503,
        body: { error: 'A2A Mailbox inbound handler is not ready' },
      };
    }
    try {
      const result = await this.#onReceive(verified.mail, verified.grantedBudget);
      const consumed = capConsumedBudget(result.consumed, verified.grantedBudget);
      return {
        httpStatus: 200,
        body: Object.freeze({
          status: result.status,
          content: result.content,
          ...(consumed ? { consumed } : {}),
        }),
      };
    } catch (error) {
      return {
        httpStatus: 200,
        body: {
          status: 'rejected',
          content: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  #resolvePeer(target: ActorId): A2AMailboxPeerConfig | undefined {
    const direct = this.#peers.get(target);
    if (direct) return direct;
    const hash = target.indexOf('#');
    if (hash > 0) {
      return this.#peers.get(target.slice(0, hash));
    }
    return undefined;
  }
}

function mailPromptText(mail: Mail): string {
  switch (mail.body.kind) {
    case 'ask':
      return mail.body.question;
    case 'delegate':
      return mail.body.deliverable
        ? `${mail.body.brief}\n\nDeliverable: ${mail.body.deliverable}`
        : mail.body.brief;
    case 'tell':
      return mail.body.content;
    case 'human':
      return mail.body.text;
    case 'timer':
      return mail.body.content;
    default:
      return JSON.stringify(mail.body);
  }
}

function createAgentHostInboundHandler(agentHost: AgentHostPort): A2AMailboxInboundHandler {
  return async (mail, grantedBudget) => {
    const bindingName = mail.to.includes('#') ? mail.to.slice(0, mail.to.indexOf('#')) : mail.to;
    const outcome = await agentHost.protocol.execute(bindingName, {
      identity: {
        turnId: `a2a-mail:${mail.id}`,
        traceId: `engagement:${mail.engagementId}`,
      },
      origin: {
        kind: 'a2a',
        platform: 'a2a',
        endpoint: bindingName,
        scope: 'private',
        sceneId: mail.engagementId,
      },
      principal: {
        subjectId: mail.authority.principal.id,
        roles: [mail.authority.trust],
      },
      session: {
        key: `a2a:engagement:${mail.engagementId}:${mail.to}`,
      },
      input: {
        text: mailPromptText(mail),
        metadata: {
          a2aMail: {
            mailId: mail.id,
            engagementId: mail.engagementId,
            kind: mail.kind,
            authority: mail.authority,
            grantedBudget,
          },
        },
      },
      policy: {
        permissions: [mail.authority.trust],
        unattended: true,
        network: {
          enabled: mail.authority.egress.network,
          ...(mail.authority.egress.hosts.kind === 'only'
            ? { allowedDomains: [...mail.authority.egress.hosts.names] }
            : {}),
        },
      },
      ports: {},
      intent: { kind: 'new' },
      signal: AbortSignal.timeout(Math.max(1_000, grantedBudget.wallMs || 30_000)),
    } as never);

    const tokens = outcome.usage?.total_tokens ?? 0;
    if (outcome.status !== 'completed') {
      const errorText = outcome.status === 'failed'
        ? outcome.error.message
        : outcome.status === 'cancelled'
          ? outcome.reason
          : `Agent budget exceeded: ${outcome.budget}`;
      return {
        status: outcome.status === 'cancelled' ? 'cancelled' : 'rejected',
        content: errorText,
        consumed: {
          modelCalls: 1,
          tokens: Math.min(tokens, grantedBudget.tokens),
        },
      };
    }

    const text = outcome.output
      .filter((item): item is { readonly type: 'text'; readonly content: string } => item.type === 'text')
      .map((item) => item.content)
      .join('\n')
      .trim();

    return {
      status: 'completed',
      content: text,
      consumed: {
        modelCalls: 1,
        tokens: Math.min(tokens, grantedBudget.tokens),
      },
    };
  };
}

export function installRuntimeA2aMailbox(
  options: InstallRuntimeA2aMailboxOptions,
): RuntimeA2aMailboxInstallation {
  const config = options.config;
  const secret = config?.secret || options.fallbackToken || '';
  if (options.production === true && config?.enabled !== false && !secret) {
    throw new Error('A2A Mailbox requires a2a.mailbox.secret or a2a.token/http.token in production');
  }
  const onReceive = options.onReceive
    ?? (options.agentHost ? createAgentHostInboundHandler(options.agentHost) : undefined);
  const transport = new A2AMailboxTransport({
    peers: config?.peers,
    secret,
    token: options.fallbackToken || secret,
    now: options.now,
    onReceive,
  });

  if (config?.enabled === false) {
    return { transport, dispose: () => undefined };
  }

  const routePath = normalizeMailboxPath(config?.path ?? DEFAULT_A2A_MAILBOX_PATH);
  const maxBodyBytes = typeof config?.maxBodyBytes === 'number' && config.maxBodyBytes > 0
    ? config.maxBodyBytes
    : DEFAULT_MAX_BODY_BYTES;
  const bearerToken = options.fallbackToken || secret;

  const unregister = options.http.route('POST', routePath, async (request) => {
    if (bearerToken && !verifyA2aBearer(request, bearerToken)) {
      return jsonResponse(401, { error: 'Unauthorized - Bearer token required' });
    }
    let rawBody: unknown;
    try {
      // Drains an oversized body before failing, so the 413 reaches the client.
      rawBody = await readJsonBody(request, { limit: maxBodyBytes });
    } catch (error) {
      if (!(error instanceof HttpBodyError)) throw error;
      return jsonResponse(error.statusCode, { error: error.message });
    }
    if (rawBody === undefined) {
      return jsonResponse(400, { error: 'Invalid JSON body' });
    }
    const headerSignature = request.headers.get('x-zhin-mailbox-signature') ?? undefined;
    const result = await transport.receiveEnvelope(rawBody, { headerSignature });
    return jsonResponse(result.httpStatus, result.body);
  }, { summary: 'A2A Remote Mailbox transport (ADR 0048 §3.6)', tags: ['a2a', 'mailbox'] });

  return {
    transport,
    dispose: () => {
      unregister();
    },
  };
}


function normalizeMailboxPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return DEFAULT_A2A_MAILBOX_PATH;
  const leading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  let end = leading.length;
  while (end > 0 && leading.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return end > 0 ? leading.slice(0, end) : DEFAULT_A2A_MAILBOX_PATH;
}
