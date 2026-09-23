import { spawnSync } from 'node:child_process';

const NON_RELEASE_PATH = /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)CHANGELOG\.md$/;

// Tags are created only after publishing. Until then, use verified Changesets
// output as the baseline, and still check for package changes after that commit.
export function findVersionedReleaseBaseline({ root, directory, name, version, evidenceCache = new Map() }) {
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
    if (!before || !after || before[1] !== after[1] || before[2] !== after[2]
      || Number(after[3]) <= Number(before[3])) return undefined;

    const changelogFile = `${directory}/CHANGELOG.md`;
    const hasHeading = (text) => (text ?? '').split(/\r?\n/).some((line) => line.trim() === `## ${version}`);
    if (!hasHeading(readAt(commit, changelogFile)) || hasHeading(readAt(`${commit}^`, changelogFile))) return undefined;

    let related = evidenceCache.get(commit);
    if (related === undefined) {
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
      const declaredPackages = declarations.length > 0 && declarations.every(({ type }) => type === 'patch')
        ? new Set(declarations.map(({ name: packageName }) => packageName))
        : null;
      if (declaredPackages) {
        // Use the dependency graph from the version commit being validated.
        // Later manifest edits cannot change the provenance of that release.
        const files = git('ls-tree', '-r', '--name-only', commit)
          .trim().split('\n').filter((file) => file === 'package.json' || file.endsWith('/package.json'));
        const workspacePackages = files.map((file) => JSON.parse(readAt(commit, file)))
          .filter((pkg) => !pkg.private && pkg.name);
        related = new Set(declaredPackages);
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
      } else {
        related = null;
      }
      evidenceCache.set(commit, related);
    }
    if (!related?.has(name)) return undefined;
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
