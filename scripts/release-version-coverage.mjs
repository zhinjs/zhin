const NON_RELEASE_PATH = /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.test\.[cm]?[jt]sx?$|(?:^|\/)CHANGELOG\.md$/;

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
