/**
 * npm 上已存在的版本号不能再发：`changeset publish` 遇到已发布的版本只打一句
 * "already published" 的警告就跳过，发版仍显示成功（1.2 发版中 core / agent 的
 * 1.2.0 撞上旧架构的同号版本，依赖它们的包却照常发出）。这里在两处拦截：
 *
 * - 发版计划（`check:release-plan`）：计划要发的新版本号已在 npm 上 → 失败。
 * - 发布前（`check:version-collisions`）：本地版本号已在 npm 上、且高于 npm 的
 *   `latest` → 这是旧版本线占用的号，不是本仓库发过的版本 → 失败。
 */

/** @param {string} version */
function parse(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Compares `x.y.z` prefixes; prerelease suffixes are ignored. */
export function compareVersions(a, b) {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** Lowest `major.minor+1.0` (then next patch) above every published version of the same major. */
export function suggestFreeVersion(version, published) {
  const target = parse(version);
  if (!target) return undefined;
  const sameMajor = published.map(parse).filter((v) => v && v[0] === target[0]);
  const highestMinor = Math.max(target[1], ...sameMajor.map((v) => v[1]));
  return `${target[0]}.${highestMinor + 1}.0`;
}

/**
 * Registry metadata for one package: `{ versions: string[], latest?: string }`, or `null` when the
 * package does not exist yet (first publish is handled by `check:unpublished`).
 * @param {string} name
 * @param {typeof fetch} fetchImpl
 */
export async function readRegistryVersions(name, fetchImpl = fetch) {
  const response = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}`, {
    headers: { Accept: 'application/vnd.npm.install-v1+json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`npm registry ${name}: HTTP ${response.status}`);
  const body = await response.json();
  return { versions: Object.keys(body.versions ?? {}), latest: body['dist-tags']?.latest };
}

/**
 * Planned releases whose new version is already on npm.
 * @param {ReadonlyArray<{ name: string, newVersion: string }>} releases
 * @param {(name: string) => Promise<{ versions: string[], latest?: string } | null>} lookup
 */
export async function findPlannedCollisions(releases, lookup) {
  const results = await Promise.all(releases.map(async (release) => {
    const registry = await lookup(release.name);
    if (!registry || !registry.versions.includes(release.newVersion)) return null;
    return { ...release, suggestion: suggestFreeVersion(release.newVersion, registry.versions) };
  }));
  return results.filter(Boolean);
}

/**
 * Local package versions that npm already has from another release line: the version exists on
 * npm and is above `latest`, so `changeset publish` would silently skip it.
 * @param {ReadonlyArray<{ name: string, version: string }>} packages
 * @param {(name: string) => Promise<{ versions: string[], latest?: string } | null>} lookup
 */
export async function findLocalCollisions(packages, lookup) {
  const results = await Promise.all(packages.map(async (pkg) => {
    const registry = await lookup(pkg.name);
    if (!registry || !registry.versions.includes(pkg.version) || !registry.latest) return null;
    if (compareVersions(pkg.version, registry.latest) <= 0) return null;
    return { ...pkg, latest: registry.latest, suggestion: suggestFreeVersion(pkg.version, registry.versions) };
  }));
  return results.filter(Boolean);
}
