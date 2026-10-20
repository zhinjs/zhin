import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const dryRun = process.argv.includes('--dry-run');
const repository = process.env.GITHUB_REPOSITORY || 'zhinjs/zhin';
const token = process.env.GITHUB_TOKEN;

function fail(message) {
  throw new Error(`[github-releases] ${message}`);
}

function parsePublishedPackages(value) {
  let parsed;
  try {
    parsed = JSON.parse(value || '[]');
  } catch (error) {
    fail(`PUBLISHED_PACKAGES is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed)) fail('PUBLISHED_PACKAGES must be a JSON array');
  return parsed.map((item) => {
    if (!item || typeof item.name !== 'string' || typeof item.version !== 'string') {
      fail('Each published package must contain string name and version fields');
    }
    return { name: item.name, version: item.version };
  });
}

function getWorkspacePackages() {
  const output = execFileSync('pnpm', ['-r', 'list', '--depth', '-1', '--json'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return new Map(JSON.parse(output).map((pkg) => [pkg.name, pkg]));
}

function changelogEntry(pkgPath, version) {
  const changelogPath = path.join(pkgPath, 'CHANGELOG.md');
  const changelog = readFileSync(changelogPath, 'utf8');
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^## ${escapedVersion}\\s*$`, 'm').exec(changelog);
  if (!match) fail(`No CHANGELOG entry found for ${pkgPath}@${version}`);
  const remainder = changelog.slice(match.index + match[0].length);
  const nextHeading = remainder.search(/^## /m);
  return remainder.slice(0, nextHeading === -1 ? undefined : nextHeading).trim();
}

async function github(pathname, options = {}) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'zhin-release-workflow',
      ...options.headers,
    },
  });
  return response;
}

async function createRelease({ tag, version, body }) {
  const existing = await github(`/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`);
  if (existing.ok) {
    console.log(`[github-releases] Release already exists: ${tag}`);
    return;
  }
  if (existing.status !== 404) {
    fail(`Failed to check ${tag}: HTTP ${existing.status} ${await existing.text()}`);
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await github(`/repos/${repository}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        name: tag,
        body,
        prerelease: version.includes('-'),
      }),
    });
    if (response.ok) {
      console.log(`[github-releases] Created Release: ${tag}`);
      return;
    }
    const detail = await response.text();
    if (attempt === 3 || ![409, 422, 500, 502, 503, 504].includes(response.status)) {
      fail(`Failed to create ${tag}: HTTP ${response.status} ${detail}`);
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
  }
}

const published = parsePublishedPackages(process.env.PUBLISHED_PACKAGES);
if (published.length === 0) {
  console.log('[github-releases] No published packages to process.');
  process.exit(0);
}
if (!dryRun && !token) fail('GITHUB_TOKEN is required');

const workspace = getWorkspacePackages();
const releases = published.map(({ name, version }) => {
  const pkg = workspace.get(name);
  if (!pkg) fail(`Published package is not in the workspace: ${name}`);
  if (pkg.version !== version) {
    fail(`Workspace version mismatch for ${name}: expected ${version}, found ${pkg.version}`);
  }
  return {
    name,
    version,
    tag: `${name}@${version}`,
    body: changelogEntry(pkg.path, version),
  };
});

if (dryRun) {
  for (const release of releases) {
    console.log(`[github-releases] Would publish ${release.tag} (${release.body.length} changelog bytes)`);
  }
  process.exit(0);
}

// `changeset publish` normally creates all annotated tags locally. Recreate a
// missing local tag to make recovery runs idempotent after a failed Action.
for (const { tag } of releases) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], { stdio: 'ignore' });
  } catch {
    execFileSync('git', ['tag', tag, '-m', tag], { stdio: 'inherit' });
  }
}

// Push all release tags in one atomic Git transaction so GitHub never receives
// dozens of concurrent ref updates. Retry only the whole transaction.
for (let attempt = 1; attempt <= 3; attempt += 1) {
  try {
    execFileSync(
      'git',
      ['push', '--atomic', 'origin', ...releases.map(({ tag }) => `refs/tags/${tag}`)],
      { stdio: 'inherit' },
    );
    break;
  } catch (error) {
    if (attempt === 3) throw error;
    console.warn(`[github-releases] Tag push failed; retrying transaction (${attempt}/3)`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
  }
}

// GitHub Release creation is deliberately serial to avoid the same ref-store
// contention in the Releases API. The existence check makes reruns idempotent.
for (const release of releases) {
  await createRelease(release);
}
