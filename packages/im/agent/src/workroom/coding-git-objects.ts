import { runCodingProcess, type CodingFile, type CodingObjectsPort } from './coding-assignment-executor.js';

/** Reads committed regular UTF-8 files without checking out or running repository code. */
export async function readCodingGitSnapshot(repository: string, commit: string, paths: readonly string[], signal: AbortSignal, maxBytes = 4 * 1024 * 1024): Promise<{ baseCommit: string; baseTree: string; files: CodingFile[] }> {
  if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error('Coding base requires exact SHA-1');
  if (!paths.length || paths.some(path => !path || path.startsWith('-') || path.includes('\0'))) throw new Error('Coding context paths required');
  const git = (args: string[]) => runCodingProcess('git', ['--no-replace-objects', '-c', 'core.fsmonitor=false', ...args], '', signal, maxBytes, repository);
  const baseCommit = (await git(['rev-parse', '--verify', `${commit}^{commit}`])).trim();
  if (baseCommit !== commit) throw new Error('Coding base commit mismatch');
  const baseTree = (await git(['rev-parse', `${commit}^{tree}`])).trim();
  const entries = (await git(['ls-tree', '-rz', '--full-tree', commit, '--', ...paths])).split('\0').filter(Boolean);
  const files: CodingFile[] = [];
  let total = 0;
  for (const entry of entries) {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/u.exec(entry);
    if (!match) throw new Error('Coding context forbids symlinks and submodules');
    const content = await git(['cat-file', 'blob', match[2]!]);
    // Binary files need a separate, explicit artifact channel.
    if (content.includes('\0') || content.includes('\ufffd')) throw new Error('Coding context requires UTF-8 text');
    total += Buffer.byteLength(content);
    if (total > maxBytes) throw new Error('Coding context exceeds byte budget');
    files.push({ path: match[3]!, content, mode: match[1] as CodingFile['mode'] });
  }
  return { baseCommit, baseTree, files };
}

export interface CodingGitHubObjectsOptions {
  readonly owner: string;
  readonly repository: string;
  /** Must return a short-lived service credential; never sent to the coding image. */
  readonly token: (signal: AbortSignal) => Promise<string>;
  readonly fetch?: typeof globalThis.fetch;
}

/** Unreachable object creation only; no branches, merges or protection administration. */
export function createCodingGitHubObjectsPort(options: CodingGitHubObjectsOptions): CodingObjectsPort {
  if (![options.owner, options.repository].every(value => /^[A-Za-z0-9_.-]+$/u.test(value))) throw new Error('Invalid Coding GitHub repository');
  const request = async (resource: string, body: unknown, signal: AbortSignal): Promise<string> => {
    signal.throwIfAborted();
    const token = await options.token(signal);
    signal.throwIfAborted();
    const response = await (options.fetch ?? globalThis.fetch)(`https://api.github.com/repos/${options.owner}/${options.repository}/git/${resource}`, {
      method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Coding GitHub objects ${resource} failed (${response.status})`);
    const value = await response.json() as { sha?: unknown };
    if (typeof value.sha !== 'string' || !/^[a-f0-9]{40}$/u.test(value.sha)) throw new Error('Coding GitHub objects returned invalid SHA');
    return value.sha;
  };
  return {
    createBlob: (content, signal) => request('blobs', { content, encoding: 'utf-8' }, signal),
    createTree: (baseTree, tree, signal) => request('trees', { base_tree: baseTree, tree }, signal),
    createCommit: (tree, parent, message, signal) => request('commits', { tree, parents: [parent], message }, signal),
  };
}
