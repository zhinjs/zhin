import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const shaPattern = /^[a-f0-9]{40}$/;
export function comparison(eventName, event, sha) {
  if (eventName === 'pull_request') return { base: event.pull_request?.base?.sha, head: sha };
  if (eventName === 'merge_group') return { base: event.merge_group?.base_sha, head: sha };
  if (eventName === 'push') return { base: event.before, head: sha };
  return {};
}

export function versionCandidate(changes) {
  return changes.length > 0
    && changes.some(({ status, path }) => status === 'D' && /^\.changeset\/(?!README\.md$)[^/]+\.md$/.test(path))
    && changes.every(({ status, path }) =>
      status === 'D' && /^\.changeset\/(?!README\.md$)[^/]+\.md$/.test(path)
      || ['M', 'A'].includes(status) && /^(?:.+\/)?(?:package\.json|CHANGELOG\.md)$/.test(path)
      || status === 'M' && path === 'pnpm-lock.yaml');
}

export async function successfulRun({ repository, workflow, sha, token, currentRun, events = ['push', 'merge_group'], fetcher = fetch }) {
  if (!shaPattern.test(sha ?? '') || !token) return undefined;
  const url = new URL(`https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/runs`);
  url.search = new URLSearchParams({ head_sha: sha, status: 'success', per_page: '100' }).toString();
  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Workflow evidence request failed (${response.status})`);
  const data = await response.json();
  // PR workflow head_sha identifies the PR head, while checkout tests its merge ref.
  // Only push/merge_group runs prove the exact SHA requested here. Never reuse a
  // merely queued, failed, cancelled, other-repository or same-title run.
  return data.workflow_runs?.find(run => run.head_sha === sha
    && run.repository?.full_name === repository && String(run.id) !== String(currentRun)
    && events.includes(run.event)
    && run.status === 'completed' && run.conclusion === 'success');
}

export async function planValidation({ eventName, event, sha, repository, workflow, token, currentRun, git, findRun = successfulRun }) {
  const full = reason => ({ mode: 'full', reason });
  try {
    if (eventName === 'push' && event.ref === 'refs/heads/main') {
      const existing = await findRun({ repository, workflow, sha, token, currentRun });
      if (existing) return { mode: 'reuse', reason: `Exact commit already passed ${workflow}: run ${existing.id}` };
    }
    const { base, head } = comparison(eventName, event, sha);
    if (!shaPattern.test(base ?? '') || !shaPattern.test(head ?? '') || /^0+$/.test(base)) return full('No comparable candidate');
    const changes = git('diff', '--no-renames', '--name-status', '-z', base, head).split('\0');
    const files = [];
    for (let index = 0; index + 1 < changes.length; index += 2) files.push({ status: changes[index], path: changes[index + 1] });
    if (!versionCandidate(files)) return full('Source or non-generated content requires complete validation');
    // Pure generated metadata is useful only when its source baseline already passed.
    const baseline = await findRun({ repository, workflow, sha: base, token, currentRun });
    if (!baseline) return full('Version baseline has no successful validation evidence');
    return { mode: 'version', base, head, reason: `Verify generated version tree against validated baseline ${base}` };
  } catch (error) {
    return full(`Cannot prove reuse; run complete validation (${error.message})`);
  }
}

/** Locate a generated-only release delta; refuse retries after any source drift. */
export function versionSource(git, head) {
  const tree = git('rev-parse', `${head}^{tree}`).trim();
  for (const commit of git('rev-list', '--first-parent', '-n', '50', head).trim().split('\n')) {
    if (git('rev-parse', `${commit}^{tree}`).trim() !== tree) break;
    const parents = git('rev-list', '--parents', '-n', '1', commit).trim().split(' ');
    if (parents.length < 2) break;
    const base = parents[1];
    const fields = git('diff', '--no-renames', '--name-status', '-z', base, head).split('\0');
    const changes = [];
    for (let index = 0; index + 1 < fields.length; index += 2) changes.push({ status: fields[index], path: fields[index + 1] });
    if (versionCandidate(changes)) return base;
  }
  throw new Error('No unchanged generated release tree; start a new validated release batch');
}

export async function requireReleaseBatch({ result, eventName, event, repository, token, currentRun, findRun = successfulRun }) {
  const versionPR = eventName === 'pull_request' && event.pull_request?.head?.ref === 'changeset-release/main';
  const versionQueue = eventName === 'merge_group' && result.mode === 'version';
  if (!versionPR && !versionQueue) return;
  if (result.mode !== 'version') throw new Error('Version PR is not reproducible against current main; rerun the explicit release batch');
  const receipt = await findRun({ repository, workflow: 'publish.yml', sha: result.base, token, currentRun, events: ['workflow_dispatch'] });
  if (!receipt) throw new Error('No successful full release batch for current main; run Build and Publish manually before merging versions');
}

export function writeOutputs(values, output = process.env.GITHUB_OUTPUT) {
  if (output) for (const [key, value] of Object.entries(values)) appendFileSync(output, `${key}=${String(value).replaceAll(/[\r\n]/g, ' ')}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  const publication = env.RELEASE_PROOF === 'true';
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
  const event = publication ? { merge_group: { base_sha: versionSource(git, env.GITHUB_SHA) } }
    : JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const result = await planValidation({
    eventName: publication ? 'merge_group' : env.GITHUB_EVENT_NAME, event,
    sha: env.GITHUB_SHA, repository: env.GITHUB_REPOSITORY, workflow: env.VALIDATION_WORKFLOW,
    token: env.GH_TOKEN, currentRun: env.GITHUB_RUN_ID,
    git,
    findRun: options => successfulRun({ ...options, ...(publication ? { events: ['workflow_dispatch'] } : {}) }),
  });
  if (!publication && env.VALIDATION_WORKFLOW === 'ci.yml') await requireReleaseBatch({ result, eventName: env.GITHUB_EVENT_NAME, event, repository: env.GITHUB_REPOSITORY, token: env.GH_TOKEN, currentRun: env.GITHUB_RUN_ID });
  writeOutputs(result);
  console.log(result.reason);
}
