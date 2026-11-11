import { globalPermissions, isUserPrincipal, requestMeta, type ConsoleUserPrincipal, type HttpHost } from '@zhin.js/host-http';
import type { ConsoleIamService } from '../iam/service.js';
import { installConsoleTerminal, type ConsoleTerminalHandle, type InstallConsoleTerminalOptions } from './index.js';
import type { TerminalPrincipal } from './service.js';

const TERMINAL_PERMISSION = 'ops.terminal';

export interface InstallHostConsoleTerminalOptions {
  /** Raw host config `console.terminal`. */
  readonly config: unknown;
  readonly projectRoot: string;
  readonly base?: string;
  /** IAM service of this process; `undefined` when the database cannot hold accounts. */
  readonly iam: () => ConsoleIamService | undefined;
  readonly logger?: InstallConsoleTerminalOptions['logger'];
  /** Test seams forwarded to {@link installConsoleTerminal}. */
  readonly modules?: InstallConsoleTerminalOptions['modules'];
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Wires the Console terminal (ADR 0051) to Console access control (ADR 0049): only user
 * sessions and user API tokens holding a global `ops.terminal` may use it (the bootstrap
 * token never), terminal events land in the IAM audit log, and revoking a user's
 * credentials ends their terminal sessions.
 */
export function installHostConsoleTerminal(http: HttpHost, options: InstallHostConsoleTerminalOptions): ConsoleTerminalHandle {
  // The Console principal behind each terminal principal, for authorization decisions.
  const grantsOf = new WeakMap<TerminalPrincipal, ConsoleUserPrincipal>();
  const handle = installConsoleTerminal(http, {
    config: options.config,
    projectRoot: options.projectRoot,
    ...(options.base ? { base: options.base } : {}),
    resolvePrincipal: async (token, context) => {
      if (!token) return null;
      const principal = await http.tokenRegistry.authenticate(token, requestMeta(context, context.remoteAddress)) ?? undefined;
      // Bootstrap (setup token or open Host) is not a person: terminal access needs a user.
      if (!isUserPrincipal(principal)) return null;
      const resolved: TerminalPrincipal = Object.freeze({ id: `user:${principal.userId}`, kind: principal.kind });
      grantsOf.set(resolved, principal);
      return resolved;
    },
    authorize: async (principal) => {
      const resolved = grantsOf.get(principal);
      // Global grant only (API tokens are already narrowed to their permission list).
      if (!resolved || !globalPermissions(resolved).includes(TERMINAL_PERMISSION)) return false;
      // The user may have been disabled or deleted since the credential was resolved.
      const user = await options.iam()?.getUser(resolved.userId);
      return user !== null && user !== undefined && !user.disabled;
    },
    audit: (event) => {
      options.iam()?.audit({
        actor: event.actor,
        action: event.action,
        ...(event.target ? { target: `terminal:${event.target}` } : {}),
        outcome: event.outcome,
        detail: event.detail,
        ...(event.ip ? { ip: event.ip } : {}),
      });
    },
    ...(options.logger ? { logger: options.logger } : {}),
    ...(options.modules ? { modules: options.modules } : {}),
    ...(options.env ? { env: options.env } : {}),
  });
  if (!handle.enabled) return handle;
  let stopRevocations: (() => void) | undefined;
  const subscribe = () => {
    if (stopRevocations) return;
    const iam = options.iam();
    if (!iam) return;
    stopRevocations = iam.onCredentialsRevoked(({ userId }) => {
      handle.terminatePrincipal(`user:${userId}`, 'revoked');
    });
  };
  subscribe();
  return Object.freeze({
    enabled: handle.enabled,
    config: handle.config,
    terminatePrincipal: handle.terminatePrincipal,
    sessions: handle.sessions,
    close: () => {
      stopRevocations?.();
      stopRevocations = undefined;
      handle.close();
    },
  });
}
