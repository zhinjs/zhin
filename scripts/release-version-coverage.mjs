import { spawnSync } from 'node:child_process';

const NON_RELEASE_PATH = /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)CHANGELOG\.md$/;

const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Strict `X.Y.Z` (no prerelease / build metadata) → `[X, Y, Z]`, otherwise `undefined`. */
export function parseReleaseVersion(version) {
  const match = typeof version === 'string' ? RELEASE_VERSION.exec(version) : null;
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

/** A version a minor bump can produce: `X.Y.0` with `Y >= 1` (`X.0.0` would be a major). */
export function isMinorReleaseVersion(version) {
  const parsed = parseReleaseVersion(version);
  return Boolean(parsed && parsed[1] >= 1 && parsed[2] === 0);
}

/** Semver order of two strict `X.Y.Z` versions; `undefined` when either is not one. */
export function compareReleaseVersions(left, right) {
  const a = parseReleaseVersion(left);
  const b = parseReleaseVersion(right);
  if (!a || !b) return undefined;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

/**
 * Planned `minor` releases without an approval for exactly that target version.
 * `approvedMinors`: `Map<package, { version }>` from `.changeset/version-policy.json`.
 */
export function findUnapprovedMinorReleases({ releases, approvedMinors }) {
  return releases
    .filter((release) => release.type === 'minor' && approvedMinors.get(release.name)?.version !== release.newVersion)
    .map((release) => ({
      name: release.name,
      oldVersion: release.oldVersion,
      newVersion: release.newVersion,
      approvedVersion: approvedMinors.get(release.name)?.version,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Approvals that no longer authorize anything and must be deleted from
 * `approvedNonPatchReleases`. An approval `{ package, version }` is live only while
 * `${package}@${version}` is still unpublished AND one of these holds:
 *   (a) the release plan bumps `package` as a minor right now (whether the planned
 *       `newVersion` equals `version` is checked by `findUnapprovedMinorReleases`), or
 *   (b) package.json already carries `version` (a version PR / merged version commit
 *       waiting for `changeset publish` to create the tag).
 * Everything else is stale, checked in this order:
 *   - `package` is not a publishable workspace package;
 *   - the tag `${package}@${version}` exists (already published — delete after publishing);
 *   - `version` is lower than the current package.json version (a later release already
 *     went out, so this approval can never be used again);
 *   - neither (a) nor (b): an orphan approval that a future minor could silently reuse.
 * Note: `version === current` with no tag and only a planned patch is still case (b): the
 * minor version commit is merged but unpublished, and a follow-up patch was added on top.
 *
 * `plannedMinors`: `Map<package, newVersion>`; `currentVersions`: `Map<package, version>`
 * for publishable workspace packages; `existingTags`: `Set<'name@version'>`.
 */
export function findStaleApprovals({ approvedMinors, plannedMinors, currentVersions, existingTags }) {
  const stale = [];
  for (const [name, { version }] of approvedMinors) {
    const current = currentVersions.get(name);
    let problem;
    if (current === undefined) {
      problem = 'is not a publishable workspace package';
    } else if (existingTags.has(`${name}@${version}`)) {
      problem = `is already published (tag ${name}@${version} exists)`;
    } else if (compareReleaseVersions(version, current) === -1) {
      problem = `is lower than the current version ${current}`;
    } else if (!plannedMinors.has(name) && version !== current) {
      problem = `is not used: the release plan has no minor for ${name} and its current version is ${current}`;
    }
    if (problem) stale.push({ package: name, version, problem });
  }
  return stale.sort((left, right) => left.package.localeCompare(right.package));
}

/** A version with a prerelease or build identifier (`1.2.0-beta.0`, `1.2.0+sha`). */
export function isPrereleaseVersion(version) {
  return typeof version === 'string' && /^\d+\.\d+\.\d+[-+]/u.test(version);
}

/** Planned releases whose old or new version carries a prerelease identifier (unsupported). */
export function findPrereleaseReleases(releases) {
  return releases
    .filter((release) => release.type !== 'none'
      && (isPrereleaseVersion(release.oldVersion) || isPrereleaseVersion(release.newVersion)))
    .map(({ name, oldVersion, newVersion }) => ({ name, oldVersion, newVersion }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * The most recently released stable version per package: `Map<'name@x.y.z', commitDate>` →
 * `Map<name, 'x.y.z'>`. The tag whose commit is newest wins (ties: the higher version), so an
 * abandoned version line with higher numbers but older releases (this repository's pre-1.x
 * architecture went up to e.g. `@zhin.js/cli@4.0.1` before the 1.x reset) is not the baseline.
 * Tags without a readable date rank behind dated ones. Prerelease tags and tags that are not
 * `name@X.Y.Z` are ignored.
 */
export function findLatestReleasedVersions(tagDates) {
  const latest = new Map();
  for (const [tag, rawDate] of tagDates) {
    const at = tag.lastIndexOf('@');
    if (at <= 0) continue;
    const name = tag.slice(0, at);
    const version = tag.slice(at + 1);
    if (!parseReleaseVersion(version)) continue;
    const date = Number.isFinite(rawDate) ? rawDate : -Infinity;
    const previous = latest.get(name);
    if (previous === undefined || date > previous.date
      || (date === previous.date && compareReleaseVersions(version, previous.version) === 1)) {
      latest.set(name, { version, date });
    }
  }
  return new Map([...latest].map(([name, { version }]) => [name, version]));
}

/**
 * Planned releases that leave the minor line of the package's latest published (tagged) version
 * without an approval. The plan's `type` alone is not enough: a patch on top of a hand-edited
 * package.json (1.9.1 → 1.10.3, then patch → 1.10.4) would otherwise cross a minor unapproved.
 * For every planned release whose package has a stable tag (`latestReleased`, see
 * `findLatestReleasedVersions`):
 *   - a different major than the latest tag is always rejected (`problem: 'major'`);
 *   - a higher minor needs the approval `version === newVersion` (`problem: 'minor'`), with one
 *     exception: a follow-up patch on top of an unpublished approved minor version commit, i.e.
 *     package.json already carries the approved `X.Y.0`, `newVersion` stays on that `X.Y` line,
 *     and `hasVersionCommit(name, X.Y.0)` confirms a real version commit produced it.
 * Staying on the latest tag's minor line (any higher patch, e.g. a version-collision skip) is fine.
 * Packages without any stable tag have never been released from this repository and are not
 * compared here (their first publish is manual, see docs/contributing/publishing.md).
 */
export function findMinorLineViolations({
  releases,
  latestReleased,
  approvedMinors,
  currentVersions = new Map(),
  hasVersionCommit = () => false,
}) {
  const violations = [];
  for (const release of releases) {
    if (release.type === 'none') continue;
    const released = latestReleased.get(release.name);
    const base = parseReleaseVersion(released);
    const next = parseReleaseVersion(release.newVersion);
    if (!base || !next) continue;
    const approvedVersion = approvedMinors.get(release.name)?.version;
    const violation = { name: release.name, oldVersion: release.oldVersion, newVersion: release.newVersion, released, approvedVersion };
    if (next[0] !== base[0]) {
      violations.push({ ...violation, problem: 'major' });
      continue;
    }
    if (next[1] <= base[1] || approvedVersion === release.newVersion) continue;
    const approved = parseReleaseVersion(approvedVersion);
    const current = currentVersions.get(release.name);
    const followUpPatch = Boolean(approved)
      && approved[0] === next[0] && approved[1] === next[1]
      && current === approvedVersion
      && hasVersionCommit(release.name, approvedVersion);
    if (!followUpPatch) violations.push({ ...violation, problem: 'minor' });
  }
  return violations.sort((left, right) => left.name.localeCompare(right.name));
}

// Tags are created only after publishing. Until then, use verified Changesets
// output as the baseline, and still check for package changes after that commit.
// A package may also be versioned X.Y.Z → X.(Y+1).0 from its own minor declaration, but only
// when `approvedMinors.get(name).version` is exactly the version package.json now carries.
export function findVersionedReleaseBaseline({ root, directory, name, version, evidenceCache = new Map(), approvedMinors = new Map() }) {
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || 'Failed to read release history');
    return result.stdout;
  };
  const readAt = (ref, file) => {
    const result = spawnSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8' });
    return result.status === 0 ? result.stdout : undefined;
  };
  const manifestFile = `${directory}/package.json`;
  const commits = git('log', '--format=%H', 'HEAD', '--', manifestFile).trim().split('\n').filter(Boolean);
  for (const commit of commits) {
    const currentText = readAt(commit, manifestFile);
    const previousText = readAt(`${commit}^`, manifestFile);
    if (!currentText || !previousText) return undefined;
    const current = JSON.parse(currentText);
    const previous = JSON.parse(previousText);
    if (current.name !== name || current.version !== version || previous.name !== name) return undefined;
    if (previous.version === version) continue;

    const before = /^(\d+)\.(\d+)\.(\d+)$/.exec(previous.version);
    const after = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!before || !after || before[1] !== after[1]) return undefined;
    const patchBump = before[2] === after[2] && Number(after[3]) > Number(before[3]);
    const minorBump = Number(after[2]) === Number(before[2]) + 1 && after[3] === '0';
    if (!patchBump && !(minorBump && approvedMinors.get(name)?.version === version)) return undefined;

    const changelogFile = `${directory}/CHANGELOG.md`;
    const hasHeading = (text) => (text ?? '').split(/\r?\n/).some((line) => line.trim() === `## ${version}`);
    if (!hasHeading(readAt(commit, changelogFile)) || hasHeading(readAt(`${commit}^`, changelogFile))) return undefined;

    let evidence = evidenceCache.get(commit);
    if (evidence === undefined) {
      const deleted = git('diff', '--name-only', '--diff-filter=D', `${commit}^`, commit, '--', '.changeset')
        .trim().split('\n').filter((file) => /^\.changeset\/[^/]+\.md$/.test(file) && file !== '.changeset/README.md');
      const declarations = deleted.flatMap((file) => {
        const frontmatter = readAt(`${commit}^`, file)?.split(/^---\s*$/m)[1] ?? '';
        return frontmatter.split(/\r?\n/).flatMap((line) => {
          if (line.trimStart().startsWith('#')) return [];
          const match = line.match(/^[ \t]*(?:"([^"]+)"|'([^']+)'|([^:#\s][^:]*?))[ \t]*:[ \t]*(major|minor|patch)[ \t]*$/);
          return match ? [{ name: match[1] ?? match[2] ?? match[3], type: match[4] }] : [];
        });
      });
      // Other packages' minor declarations only need an approval entry here; each of those
      // packages is matched against its own approved version when it is validated itself.
      const allowed = ({ name: packageName, type }) => type === 'patch' || (type === 'minor' && approvedMinors.has(packageName));
      const declaredPackages = declarations.length > 0 && declarations.every(allowed)
        ? new Set(declarations.map(({ name: packageName }) => packageName))
        : null;
      if (declaredPackages) {
        // Use the dependency graph from the version commit being validated.
        // Later manifest edits cannot change the provenance of that release.
        const files = git('ls-tree', '-r', '--name-only', commit)
          .trim().split('\n').filter((file) => file === 'package.json' || file.endsWith('/package.json'));
        const workspacePackages = files.map((file) => JSON.parse(readAt(commit, file)))
          .filter((pkg) => !pkg.private && pkg.name);
        const related = new Set(declaredPackages);
        const minors = new Set(declarations.filter(({ type }) => type === 'minor').map(({ name: packageName }) => packageName));
        let expanded = true;
        while (expanded) {
          expanded = false;
          for (const pkg of workspacePackages) {
            if (related.has(pkg.name)) continue;
            const dependencies = { ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies };
            if (Object.keys(dependencies).some((dependency) => related.has(dependency))) {
              related.add(pkg.name);
              expanded = true;
            }
          }
        }
        evidence = { related, minors };
      } else {
        evidence = null;
      }
      evidenceCache.set(commit, evidence);
    }
    if (!evidence?.related.has(name)) return undefined;
    // A minor output needs this package's own minor declaration, not just propagation.
    if (minorBump && !patchBump && !evidence.minors.has(name)) return undefined;
    return commit;
  }
  return undefined;
}

export function isReleaseRelevantPath(file) {
  return !NON_RELEASE_PATH.test(file.replaceAll('\\', '/'));
}

export function findUncoveredPackageChanges({ packages, plannedPackages }) {
  const failures = [];

  for (const pkg of packages) {
    if (plannedPackages.has(pkg.name)) continue;
    const changedFiles = pkg.changedFiles.filter(isReleaseRelevantPath);
    if (changedFiles.length === 0) continue;
    failures.push({
      name: pkg.name,
      version: pkg.version,
      changedFiles,
    });
  }

  return failures.sort((left, right) => left.name.localeCompare(right.name));
}

export function findMissingVersionTags({ packages, plannedPackages, existingTags }) {
  return packages
    .filter((pkg) => (
      !plannedPackages.has(pkg.name)
      && !existingTags.has(`${pkg.name}@${pkg.version}`)
    ))
    .map((pkg) => `${pkg.name}@${pkg.version}`)
    .sort();
}
