import { jsonResponse, readJsonBody, type ConsolePrincipal } from '@zhin.js/host-http';
import { parseTerminalConfig, type TerminalConfig } from './config.js';
import type { TerminalModuleLoaders } from './modules.js';
import {
  TerminalRequestError,
  TerminalService,
  type TerminalAuditEvent,
  type TerminalEndReason,
  type TerminalLogger,
  type TerminalPrincipal,
  type TerminalConnection,
  type TerminalSessionInfo,
} from './service.js';

export * from './config.js';
export * from './tickets.js';
export * from './service.js';
export type { TerminalModuleLoaders, PtyModule, SshModule } from './modules.js';

/** Structural subset of `HttpHost` (`@zhin.js/host-http`). */
export interface TerminalHttpHost {
  route(
    method: string,
    path: string,
    handler: (
      request: Request,
      context: { readonly url: URL; readonly principal?: ConsolePrincipal; readonly remoteAddress?: string },
    ) => Response | Promise<Response>,
    meta?: { summary?: string; tags?: string[] },
  ): () => void;
  ws(path: string, options?: { readonly auth?: 'host' | 'protocol' }): {
    onConnection(listener: (connection: TerminalConnection & { readonly headers: Headers }) => void): () => void;
    close(): void;
  };
}

export interface TerminalPrincipalContext {
  readonly headers: Headers;
  readonly remoteAddress?: string;
  /** Principal the Host already authenticated (HTTP routes); absent on WebSocket upgrades. */
  readonly principal?: ConsolePrincipal;
}

export interface InstallConsoleTerminalOptions {
  /** Raw `console.terminal` block, or an already parsed config. */
  readonly config: unknown;
  readonly projectRoot: string;
  /** API base the Console uses (default `/api`). */
  readonly base?: string;
  /** Must return true only for principals holding `ops.terminal`. Errors deny. */
  readonly authorize: (principal: TerminalPrincipal) => boolean | Promise<boolean>;
  /** Maps a bearer credential to a principal; `null` → 401. */
  readonly resolvePrincipal: (
    bearerToken: string,
    context: TerminalPrincipalContext,
  ) => TerminalPrincipal | null | Promise<TerminalPrincipal | null>;
  readonly audit?: (event: TerminalAuditEvent) => void;
  readonly logger?: TerminalLogger;
  /** Test seam for `node-pty` / `ssh2`. */
  readonly modules?: TerminalModuleLoaders;
  readonly env?: NodeJS.ProcessEnv;
  readonly readFile?: (path: string) => Promise<Buffer>;
}

export interface ConsoleTerminalHandle {
  readonly enabled: boolean;
  readonly config: TerminalConfig;
  /** Ends every session and pending ticket of a principal (credential revoked, user disabled…). */
  terminatePrincipal(principalId: string, reason?: TerminalEndReason): number;
  sessions(): TerminalSessionInfo[];
  /** Unregisters routes and ends all sessions (`exit` reason `disabled`). Idempotent. */
  close(): void;
}

export function installConsoleTerminal(
  host: TerminalHttpHost,
  options: InstallConsoleTerminalOptions,
): ConsoleTerminalHandle {
  // Parsing is idempotent, so an already parsed TerminalConfig is accepted too.
  const config = parseTerminalConfig(options.config, {
    projectRoot: options.projectRoot,
    ...(options.env ? { env: options.env } : {}),
  });
  if (!config.enabled) {
    // ADR 0051: disabled → no routes, optional modules never loaded.
    return Object.freeze({
      enabled: false,
      config,
      terminatePrincipal: () => 0,
      sessions: () => [],
      close: () => undefined,
    });
  }
  const base = normalizeBase(options.base ?? '/api');
  const service = new TerminalService({
    config,
    projectRoot: options.projectRoot,
    authorize: options.authorize,
    ...(options.audit ? { audit: options.audit } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.modules ? { modules: options.modules } : {}),
    ...(options.env ? { env: options.env } : {}),
    ...(options.readFile ? { readFile: options.readFile } : {}),
  });

  const authenticate = async (
    request: Request,
    context: { readonly url: URL; readonly principal?: ConsolePrincipal; readonly remoteAddress?: string },
  ): Promise<TerminalPrincipal> => {
    const token = bearerToken(request.headers, context.url);
    let principal: TerminalPrincipal | null = null;
    try {
      principal = await options.resolvePrincipal(token, {
        headers: request.headers,
        ...(context.remoteAddress ? { remoteAddress: context.remoteAddress } : {}),
        ...(context.principal ? { principal: context.principal } : {}),
      });
    } catch {
      principal = null;
    }
    return service.requireAuthorized(principal, context.remoteAddress);
  };

  const fail = (error: unknown): Response => {
    if (error instanceof TerminalRequestError) {
      return jsonResponse(error.status, { success: false, code: error.code, error: error.message });
    }
    throw error;
  };

  const unregister: Array<() => void> = [];
  unregister.push(host.route('GET', `${base}/console/terminal/targets`, async (request, context) => {
    try {
      await authenticate(request, context);
      return jsonResponse(200, { success: true, data: await service.listTargets() });
    } catch (error) {
      return fail(error);
    }
  }, { summary: 'List Console terminal targets', tags: ['console', 'terminal'] }));

  unregister.push(host.route('POST', `${base}/console/terminal/tickets`, async (request, context) => {
    try {
      const principal = await authenticate(request, context);
      const body = await readJsonBody(request, { limit: 4096 });
      return jsonResponse(200, { success: true, data: await service.issueTicket(principal, body, context.remoteAddress) });
    } catch (error) {
      return fail(error);
    }
  }, { summary: 'Issue a one-time Console terminal WebSocket ticket', tags: ['console', 'terminal'] }));

  // Browsers cannot set Authorization on WebSocket upgrades: the ticket is the credential.
  const ws = host.ws(`${base}/console/terminal`, { auth: 'protocol' });
  const stopWs = ws.onConnection((connection) => {
    void (async () => {
      let presented: TerminalPrincipal | null | undefined;
      const header = connection.headers.get('authorization');
      if (typeof header === 'string' && header.startsWith('Bearer ')) {
        try {
          presented = await options.resolvePrincipal(header.slice(7).trim(), {
            headers: connection.headers,
            ...(connection.remoteAddress ? { remoteAddress: connection.remoteAddress } : {}),
          });
        } catch {
          presented = null;
        }
        // A bearer that resolves to nobody must not fall back to ticket-only auth.
        if (!presented) presented = { id: '\u0000invalid' };
      }
      await service.handleConnection(connection, presented);
    })().catch((error: unknown) => {
      options.logger?.warn?.(`terminal connection failed: ${error instanceof Error ? error.message : String(error)}`);
      try {
        connection.close(1011, 'internal-error');
      } catch {
        /* ignore */
      }
    });
  });
  unregister.push(stopWs, () => ws.close());

  let closed = false;
  return Object.freeze({
    enabled: true,
    config,
    terminatePrincipal: (principalId: string, reason?: TerminalEndReason) => service.terminatePrincipal(principalId, reason),
    sessions: () => service.sessions(),
    close: () => {
      if (closed) return;
      closed = true;
      for (const stop of unregister) stop();
      service.closeAll('disabled', true);
    },
  });
}

function bearerToken(headers: Headers, url: URL): string {
  const header = headers.get('authorization');
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7).trim();
  return url.searchParams.get('token')?.trim() ?? '';
}

function normalizeBase(value: string): string {
  const withSlash = value.startsWith('/') ? value : `/${value}`;
  let end = withSlash.length;
  while (end > 1 && withSlash[end - 1] === '/') end -= 1;
  return withSlash.slice(0, end);
}
