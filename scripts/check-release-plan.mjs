#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  findMissingVersionTags,
  findUncoveredPackageChanges,
} from './release-version-coverage.mjs';

const root = path.resolve(import.meta.dirname, '..');
const changesetDir = path.join(root, '.changeset');
const versionPolicyPath = path.join(changesetDir, 'version-policy.json');

function readChangesetDeclarations() {
  const declarations = [];

  for (const entry of fs.readdirSync(changesetDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === 'README.md') {
      continue;
    }

    const text = fs.readFileSync(path.join(changesetDir, entry.name), 'utf8');
    const sections = text.split(/^---\s*$/m);
    if (sections.length < 3) continue;

    for (const line of sections[1].split('\n')) {
      const match = line.match(/^\s*['"]?([^'"]+)['"]?\s*:\s*(major|minor|patch)\s*$/);
      if (match) {
        declarations.push({
          changeset: entry.name,
          package: match[1],
          type: match[2],
        });
      }
    }
  }

  return declarations;
}

function readWorkspacePackagesWithVersionTags(plannedPackages) {
  const listed = spawnSync(
    'pnpm',
    ['-r', 'ls', '--json', '--depth', '-1'],
    { cwd: root, encoding: 'utf8' },
  );
  if (listed.status !== 0) {
    process.stderr.write(listed.stdout);
    process.stderr.write(listed.stderr);
    process.exit(listed.status ?? 1);
  }

  const packages = JSON.parse(listed.stdout)
    .filter((pkg) => !pkg.private && pkg.name && pkg.version && pkg.path);
  const tags = spawnSync('git', ['tag', '--list'], { cwd: root, encoding: 'utf8' });
  if (tags.status !== 0) {
    process.stderr.write(tags.stdout);
    process.stderr.write(tags.stderr);
    process.exit(tags.status ?? 1);
  }
  const existingTags = new Set(tags.stdout.trim().split('\n').filter(Boolean));
  const missingTags = findMissingVersionTags({ packages, plannedPackages, existingTags });
  if (missingTags.length > 0) {
    console.error('Unplanned publishable packages are missing current version tags:');
    for (const tag of missingTags) console.error(`- ${tag}`);
    process.exit(1);
  }

  return packages
    .filter((pkg) => !plannedPackages.has(pkg.name))
    .map((pkg) => {
      const tag = `${pkg.name}@${pkg.version}`;
      const directory = path.relative(root, pkg.path).replaceAll('\\', '/');
      const diff = spawnSync(
        'git',
        ['diff', '--name-only', `${tag}..HEAD`, '--', directory],
        { cwd: root, encoding: 'utf8' },
      );
      if (diff.status !== 0) {
        process.stderr.write(diff.stdout);
        process.stderr.write(diff.stderr);
        process.exit(diff.status ?? 1);
      }

      return {
        name: pkg.name,
        version: pkg.version,
        directory,
        changedFiles: diff.stdout.trim().split('\n').filter(Boolean),
      };
    });
}

const versionPolicy = JSON.parse(fs.readFileSync(versionPolicyPath, 'utf8'));
if (versionPolicy.defaultReleaseType !== 'patch') {
  console.error('.changeset/version-policy.json must keep defaultReleaseType=patch');
  process.exit(1);
}

const declarations = readChangesetDeclarations();
const approvals = versionPolicy.approvedNonPatchReleases ?? [];
if (approvals.length > 0) {
  console.error('Version policy must not contain non-patch approvals.');
  process.exit(1);
}

const nonPatchDeclarations = declarations.filter((declaration) => declaration.type !== 'patch');
if (nonPatchDeclarations.length > 0) {
  console.error('Every changeset declaration must use patch:');
  for (const declaration of nonPatchDeclarations) {
    console.error(`- ${declaration.changeset}: ${declaration.package} (${declaration.type})`);
  }
  process.exit(1);
}

const isChangesetsVersionPr =
  process.env.GITHUB_HEAD_REF === 'changeset-release/main' &&
  process.env.GITHUB_BASE_REF === 'main';

if (declarations.length === 0 && isChangesetsVersionPr) {
  const diff = spawnSync(
    'git',
    ['diff', '--name-only', 'origin/main...HEAD'],
    { cwd: root, encoding: 'utf8' },
  );
  if (diff.status !== 0) {
    process.stderr.write(diff.stderr);
    process.exit(diff.status ?? 1);
  }

  const changedManifests = diff.stdout
    .trim()
    .split('\n')
    .filter((file) =>
      /^(basic|packages|plugins)\/.+\/package\.json$/.test(file),
    );
  const failures = [];

  for (const manifestFile of changedManifests) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, manifestFile), 'utf8'));
    if (manifest.private) continue;
    const changelogFile = path.join(path.dirname(manifestFile), 'CHANGELOG.md');
    const changelogPath = path.join(root, changelogFile);
    if (
      typeof manifest.version !== 'string' ||
      !fs.existsSync(changelogPath) ||
      !fs.readFileSync(changelogPath, 'utf8').includes(`## ${manifest.version}`)
    ) {
      failures.push(`${manifest.name}: missing CHANGELOG entry for ${manifest.version}`);
    }
  }

  if (changedManifests.length === 0 || failures.length > 0) {
    console.error('Changesets version PR output is incomplete:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(
    `Release plan check passed (${changedManifests.length} versioned package manifests with changelogs).`,
  );
  process.exit(0);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-release-plan-'));
const outputPath = path.join(tempDir, 'release-plan.json');

try {
  const result = spawnSync(
    'pnpm',
    ['changeset', 'status', '--output', outputPath],
    { cwd: root, encoding: 'utf8' },
  );

  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  const plan = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  const nonPatchReleases = plan.releases
    .filter((release) => release.type === 'minor' || release.type === 'major')
    .map((release) => `${release.name} (${release.oldVersion} -> ${release.newVersion})`);

  if (nonPatchReleases.length > 0) {
    console.error('Release plan contains forbidden minor or major bumps:');
    for (const release of nonPatchReleases) console.error(`- ${release}`);
    process.exit(1);
  }

  const plannedReleases = plan.releases.filter((release) => release.type !== 'none');
  const plannedPackages = new Set(plannedReleases.map((release) => release.name));
  const uncovered = findUncoveredPackageChanges({
    packages: readWorkspacePackagesWithVersionTags(plannedPackages),
    plannedPackages,
  });
  if (uncovered.length > 0) {
    console.error('Publishable package changes are missing patch changesets:');
    for (const pkg of uncovered) {
      console.error(`- ${pkg.name}@${pkg.version}`);
      for (const file of pkg.changedFiles) console.error(`  - ${file}`);
    }
    process.exit(1);
  }

  console.log(
    `Release plan check passed (${plannedReleases.length} patch releases).`,
  );
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
