import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

/** Host top-level `console.terminal` block (ADR 0051). */
export interface TerminalSshTargetConfig {
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly label?: string;
  readonly privateKeyPath?: string;
  readonly privateKeyEnv?: string;
  readonly passwordEnv?: string;
  readonly passphraseEnv?: string;
  /** Normalized `SHA256:<base64 without padding>`. */
  readonly hostFingerprint?: string;
}

export interface TerminalConfig {
  readonly enabled: boolean;
  readonly shell: string;
  /** Absolute working directory for local shells. */
  readonly cwd: string;
  /** Seconds without input before the session is closed. */
  readonly idleTimeout: number;
  readonly maxSessions: number;
  readonly ssh: readonly TerminalSshTargetConfig[];
}

export class TerminalConfigError extends Error {
  constructor(path: string, message: string) {
    super(`console.terminal${path ? `.${path}` : ''}: ${message}`);
    this.name = 'TerminalConfigError';
  }
}

const TARGET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const KNOWN_KEYS = new Set(['enabled', 'shell', 'cwd', 'idleTimeout', 'maxSessions', 'ssh']);
const KNOWN_SSH_KEYS = new Set([
  'name', 'label', 'host', 'port', 'username', 'privateKeyPath', 'privateKeyEnv',
  'passwordEnv', 'passphraseEnv', 'hostFingerprint',
]);

export interface ParseTerminalConfigOptions {
  readonly projectRoot: string;
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
}

export function defaultShell(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string {
  if (platform === 'win32') return 'powershell.exe';
  return env.SHELL?.trim() || '/bin/sh';
}

/** Parses and validates the raw `console.terminal` value. Missing or `enabled: false` → disabled. */
export function parseTerminalConfig(raw: unknown, options: ParseTerminalConfigOptions): TerminalConfig {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  if (raw === undefined || raw === null) return disabledConfig(options.projectRoot, platform, env);
  const value = record(raw, '');
  for (const key of Object.keys(value)) {
    if (!KNOWN_KEYS.has(key)) throw new TerminalConfigError(key, 'unknown key');
  }
  const enabled = optionalBoolean(value.enabled, 'enabled') ?? false;
  const shell = optionalString(value.shell, 'shell') ?? defaultShell(platform, env);
  const cwdRaw = optionalString(value.cwd, 'cwd') ?? '.';
  const idleTimeout = optionalInteger(value.idleTimeout, 'idleTimeout', 0, 7 * 24 * 3600) ?? 900;
  const maxSessions = optionalInteger(value.maxSessions, 'maxSessions', 1, 256) ?? 4;
  const sshRaw = value.ssh ?? [];
  if (!Array.isArray(sshRaw)) throw new TerminalConfigError('ssh', 'must be an array');
  const names = new Set<string>();
  const ssh = sshRaw.map((entry, index) => {
    const target = parseSshTarget(entry, `ssh[${index}]`);
    if (names.has(target.name)) throw new TerminalConfigError(`ssh[${index}].name`, `duplicate target "${target.name}"`);
    names.add(target.name);
    return target;
  });
  return Object.freeze({
    enabled,
    shell,
    cwd: resolve(options.projectRoot, cwdRaw),
    idleTimeout,
    maxSessions,
    ssh: Object.freeze(ssh),
  });
}

function disabledConfig(projectRoot: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): TerminalConfig {
  return Object.freeze({
    enabled: false,
    shell: defaultShell(platform, env),
    cwd: resolve(projectRoot),
    idleTimeout: 900,
    maxSessions: 4,
    ssh: Object.freeze([]),
  });
}

function parseSshTarget(raw: unknown, path: string): TerminalSshTargetConfig {
  const value = record(raw, path);
  for (const key of Object.keys(value)) {
    if (!KNOWN_SSH_KEYS.has(key)) throw new TerminalConfigError(`${path}.${key}`, 'unknown key');
  }
  const name = requiredString(value.name, `${path}.name`);
  if (!TARGET_NAME.test(name) || name === 'local') {
    throw new TerminalConfigError(`${path}.name`, 'must match [A-Za-z0-9._-] (max 64) and must not be "local"');
  }
  const host = requiredString(value.host, `${path}.host`);
  const port = optionalInteger(value.port, `${path}.port`, 1, 65535) ?? 22;
  const username = requiredString(value.username, `${path}.username`);
  const label = optionalString(value.label, `${path}.label`);
  const privateKeyPath = optionalString(value.privateKeyPath, `${path}.privateKeyPath`);
  const privateKeyEnv = optionalEnvName(value.privateKeyEnv, `${path}.privateKeyEnv`);
  const passwordEnv = optionalEnvName(value.passwordEnv, `${path}.passwordEnv`);
  const passphraseEnv = optionalEnvName(value.passphraseEnv, `${path}.passphraseEnv`);
  if (privateKeyPath && privateKeyEnv) {
    throw new TerminalConfigError(path, 'privateKeyPath and privateKeyEnv are mutually exclusive');
  }
  if (!privateKeyPath && !privateKeyEnv && !passwordEnv) {
    throw new TerminalConfigError(path, 'one of privateKeyPath, privateKeyEnv or passwordEnv is required');
  }
  const fingerprintRaw = optionalString(value.hostFingerprint, `${path}.hostFingerprint`);
  const hostFingerprint = fingerprintRaw === undefined ? undefined : normalizeFingerprint(fingerprintRaw);
  if (fingerprintRaw !== undefined && !hostFingerprint) {
    throw new TerminalConfigError(`${path}.hostFingerprint`, 'must be "SHA256:<base64>"');
  }
  return Object.freeze({
    name, host, port, username,
    ...(label ? { label } : {}),
    ...(privateKeyPath ? { privateKeyPath } : {}),
    ...(privateKeyEnv ? { privateKeyEnv } : {}),
    ...(passwordEnv ? { passwordEnv } : {}),
    ...(passphraseEnv ? { passphraseEnv } : {}),
    ...(hostFingerprint ? { hostFingerprint } : {}),
  });
}

/** `SHA256:abc=` / `sha256:abc` → `SHA256:abc`; undefined when not a SHA256 base64 fingerprint. */
export function normalizeFingerprint(value: string): string | undefined {
  const match = /^sha256:([A-Za-z0-9+/]+)=*$/iu.exec(value.trim());
  if (!match) return undefined;
  const body = match[1]!;
  // A SHA-256 digest is 32 bytes → 43 base64 chars without padding.
  if (body.length !== 43) return undefined;
  return `SHA256:${body}`;
}

/** OpenSSH-style fingerprint of a raw host key blob. */
export function hostKeyFingerprint(key: Uint8Array): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/u, '')}`;
}

export interface SshCredentials {
  readonly privateKey?: Buffer | string;
  readonly passphrase?: string;
  readonly password?: string;
}

export class SshCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SshCredentialError';
  }
}

export interface CredentialSources {
  readonly env?: NodeJS.ProcessEnv;
  readonly projectRoot: string;
  readonly readFile?: (path: string) => Promise<Buffer>;
  readonly homedir?: () => string;
}

export function resolveKeyPath(path: string, projectRoot: string, home: () => string = homedir): string {
  if (path === '~') return home();
  if (path.startsWith('~/') || path.startsWith('~\\')) return resolve(home(), path.slice(2));
  return isAbsolute(path) ? path : resolve(projectRoot, path);
}

/**
 * Loads SSH credentials from env / local key file. Error messages name the
 * variable or file, never its value.
 */
export async function resolveSshCredentials(
  target: TerminalSshTargetConfig,
  sources: CredentialSources,
): Promise<SshCredentials> {
  const env = sources.env ?? process.env;
  const read = sources.readFile ?? ((path: string) => readFile(path));
  let privateKey: Buffer | string | undefined;
  if (target.privateKeyPath) {
    const path = resolveKeyPath(target.privateKeyPath, sources.projectRoot, sources.homedir);
    try {
      privateKey = await read(path);
    } catch {
      throw new SshCredentialError(`无法读取私钥文件 ${target.privateKeyPath}`);
    }
  } else if (target.privateKeyEnv) {
    const value = env[target.privateKeyEnv];
    if (!value) throw new SshCredentialError(`环境变量 ${target.privateKeyEnv} 未设置`);
    privateKey = value;
  }
  let passphrase: string | undefined;
  if (target.passphraseEnv) {
    passphrase = env[target.passphraseEnv];
    if (!passphrase) throw new SshCredentialError(`环境变量 ${target.passphraseEnv} 未设置`);
  }
  let password: string | undefined;
  if (target.passwordEnv) {
    password = env[target.passwordEnv] || undefined;
    // With a key configured too, the password is only a fallback.
    if (!password && privateKey === undefined) throw new SshCredentialError(`环境变量 ${target.passwordEnv} 未设置`);
  }
  return Object.freeze({
    ...(privateKey !== undefined ? { privateKey } : {}),
    ...(passphrase ? { passphrase } : {}),
    ...(password ? { password } : {}),
  });
}

/** Cheap availability check for the targets list (no file contents are read). */
export function sshCredentialProblem(target: TerminalSshTargetConfig, env: NodeJS.ProcessEnv): string | undefined {
  if (target.privateKeyEnv && !env[target.privateKeyEnv]) return `环境变量 ${target.privateKeyEnv} 未设置`;
  if (target.passphraseEnv && !env[target.passphraseEnv]) return `环境变量 ${target.passphraseEnv} 未设置`;
  if (target.passwordEnv && !target.privateKeyPath && !target.privateKeyEnv && !env[target.passwordEnv]) {
    return `环境变量 ${target.passwordEnv} 未设置`;
  }
  return undefined;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TerminalConfigError(path, 'must be an object');
  }
  return value as Record<string, unknown>;
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new TerminalConfigError(path, 'must be a boolean');
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new TerminalConfigError(path, 'must be a non-empty string');
  return value.trim();
}

function requiredString(value: unknown, path: string): string {
  const result = optionalString(value, path);
  if (result === undefined) throw new TerminalConfigError(path, 'is required');
  return result;
}

function optionalEnvName(value: unknown, path: string): string | undefined {
  const name = optionalString(value, path);
  if (name !== undefined && !ENV_NAME.test(name)) throw new TerminalConfigError(path, 'must be an environment variable name');
  return name;
}

function optionalInteger(value: unknown, path: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new TerminalConfigError(path, `must be an integer between ${min} and ${max}`);
  }
  return value;
}
