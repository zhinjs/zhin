export interface TurnSandboxAuthority {
  readonly workingDirectory: string;
  readonly access: 'read-only' | 'workspace-write' | 'danger-full-access';
  readonly networkAccess: boolean;
}

const authorityKey = Symbol('zhin.agent.turn-sandbox-authority');
const legacyWireKey = '__zhinTurnSandbox';

type AuthorityBearingInput = Readonly<Record<string | symbol, unknown>>;

/**
 * Adds process-local execution authority without placing it in serializable
 * model/tool input. The reserved legacy wire field is always discarded.
 */
export function attachTurnSandboxAuthority(
  input: Readonly<Record<string, unknown>>,
  authority: TurnSandboxAuthority,
): Readonly<Record<string, unknown>> {
  const copy = Object.fromEntries(
    Object.entries(input).filter(([key]) => key !== legacyWireKey),
  ) as Record<string | symbol, unknown>;
  Object.defineProperty(copy, authorityKey, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: freezeAuthority(authority),
  });
  return Object.freeze(copy) as Readonly<Record<string, unknown>>;
}

/** Only an object issued by attachTurnSandboxAuthority carries this symbol. */
export function readTurnSandboxAuthority(
  input: Readonly<Record<string, unknown>>,
): TurnSandboxAuthority | undefined {
  const value = (input as AuthorityBearingInput)[authorityKey];
  return value && typeof value === 'object'
    ? value as TurnSandboxAuthority
    : undefined;
}

function freezeAuthority(authority: TurnSandboxAuthority): TurnSandboxAuthority {
  if (typeof authority.workingDirectory !== 'string' || !authority.workingDirectory.trim()) {
    throw new TypeError('Turn sandbox workingDirectory must be non-empty');
  }
  if (authority.access !== 'read-only'
    && authority.access !== 'workspace-write'
    && authority.access !== 'danger-full-access') {
    throw new TypeError('Turn sandbox access is invalid');
  }
  if (typeof authority.networkAccess !== 'boolean') {
    throw new TypeError('Turn sandbox networkAccess must be boolean');
  }
  return Object.freeze({
    workingDirectory: authority.workingDirectory,
    access: authority.access,
    networkAccess: authority.networkAccess,
  });
}
