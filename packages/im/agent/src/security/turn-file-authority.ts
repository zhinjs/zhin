import { lstat, readlink, realpath } from 'node:fs/promises';
import * as path from 'node:path';
import { checkFileAccess, isBlockedDevicePath } from './file-policy.js';

export type AuthorizedFileInput =
  | Readonly<{ allowed: true; input: Readonly<Record<string, unknown>> }>
  | Readonly<{ allowed: false; reason: string }>;

const FILE_PATH_ARGUMENTS: Readonly<Record<string, string>> = Object.freeze({
  bash: 'cwd',
  read_file: 'file_path',
  write_file: 'file_path',
  edit_file: 'file_path',
  list_dir: 'path',
  glob: 'cwd',
  grep: 'path',
  analyze_media: 'file_path',
});

/**
 * Resolves one file invocation against its Turn-owned workspace authority.
 * Existing symlinks and the nearest existing parent are canonicalized before
 * containment is checked, so execution receives the exact path policy approved.
 */
export async function authorizeTurnFileInput(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  workspaceRoot: string | undefined,
  workingDirectory?: string,
): Promise<AuthorizedFileInput> {
  const argument = FILE_PATH_ARGUMENTS[toolName];
  if (!argument) return Object.freeze({ allowed: true, input });
  if (!workspaceRoot?.trim()) {
    return deny('Turn has no filesystem workspace authority');
  }

  const rawValue = input[argument];
  const defaultToWorkspace = (toolName === 'bash' || toolName === 'glob' || toolName === 'grep') && rawValue === undefined;
  if (!defaultToWorkspace && (typeof rawValue !== 'string' || !rawValue.trim())) {
    return deny(`${argument} is required`);
  }
  const rawPath = defaultToWorkspace ? '.' : String(rawValue);
  if (rawPath === '~' || rawPath.startsWith('~/') || rawPath.startsWith('~\\')) {
    return deny('Home-relative paths are outside the Turn workspace authority');
  }

  try {
    const canonicalRoot = await realpath(path.resolve(workspaceRoot));
    const baseDirectory = workingDirectory?.trim()
      ? await realpath(path.resolve(workingDirectory))
      : canonicalRoot;
    if (!isWithin(canonicalRoot, baseDirectory)) {
      return deny('Working directory is outside the authorized workspace');
    }
    const requested = path.isAbsolute(rawPath)
      ? path.resolve(rawPath)
      : path.resolve(baseDirectory, rawPath);
    const canonicalTarget = await canonicalizeTarget(requested);
    if (!isWithin(canonicalRoot, canonicalTarget)) {
      return deny(`Path is outside the authorized workspace: ${rawPath}`);
    }
    if (isBlockedDevicePath(canonicalTarget)) {
      return deny(`Blocked device path: ${rawPath}`);
    }
    const access = checkFileAccess(canonicalTarget, canonicalRoot);
    if (!access.allowed) return deny(access.reason ?? `Sensitive path denied: ${rawPath}`);
    return Object.freeze({
      allowed: true,
      input: Object.freeze({ ...input, [argument]: canonicalTarget }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return deny(`Cannot authorize file path: ${message}`);
  }
}

async function canonicalizeTarget(target: string): Promise<string> {
  const missing: string[] = [];
  let cursor = target;
  while (true) {
    try {
      const existing = await realpath(cursor);
      return path.resolve(existing, ...missing.reverse());
    } catch (error) {
      if (!isMissingPath(error)) throw error;
      try {
        const entry = await lstat(cursor);
        if (entry.isSymbolicLink()) {
          const link = await readlink(cursor);
          const target = path.resolve(path.dirname(cursor), link);
          const canonicalLinkTarget = await canonicalizeTarget(target);
          return path.resolve(canonicalLinkTarget, ...missing.reverse());
        }
      } catch (linkError) {
        if (!isMissingPath(linkError)) throw linkError;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missing.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function isMissingPath(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function deny(reason: string): Readonly<{ allowed: false; reason: string }> {
  return Object.freeze({ allowed: false, reason });
}
