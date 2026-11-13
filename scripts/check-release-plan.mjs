#!/usr/bin/env node

import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  findMissingVersionTags,
  findVersionedReleaseBaseline,
  findUncoveredPackageChanges,
} from './release-version-coverage.mjs';
import { findPlannedCollisions, readRegistryVersions } from './registry-version-collisions.mjs';

const root = path.resolve(import.meta.dirname, '..');
const changesetDir = path.join(root, '.changeset');
const versionPolicyPath = path.join(changesetDir, 'version-policy.json');

function expandBrace(glob) {
  const match = /\{([^}]+)\}/u.exec(glob);
  if (!match) return [glob];
  const [whole, body] = match;
  return body.split(',').flatMap((alt) =>
    expandBrace(glob.slice(0, match.index) + alt.trim() + glob.slice(match.index + whole.length)));
}

function listWorkspacePackages() {
  const workspacePath = path.join(root, 'pnpm-workspace.yaml');
  const globs = [];
  if (fs.existsSync(workspacePath)) {
    const yaml = fs.readFileSync(workspacePath, 'utf8');
    const packagesSection = /^packages:\s*$/m.exec(yaml);
    if (packagesSection) {
      const tail = yaml.slice(packagesSection.index + packagesSection[0].length);
      for (const line of tail.split(/\r?\n/)) {
        if (!line.trim() || line.trim().startsWith('#')) continue;
        const match = /^\s+-\s+(?:'([^']+)'|"([^"]+)"|([^\s#]+))/.exec(line);
        if (!match) break;
        globs.push(match[1] ?? match[2] ?? match[3]);
      }
    }
  }
  const seenDirs = new Set();
  const packages = [];
  for (const glob of globs) {
    for (const pattern of expandBrace(glob)) {
      const starAt = pattern.indexOf('*');
      const dirs = [];
      if (starAt === -1) {
        if (fs.existsSync(path.join(root, pattern, 'package.json'))) dirs.push(pattern);
      } else {
        const parent = pattern.slice(0, starAt).replace(/\/$/u, '');
        const absParent = path.join(root, parent);
        if (fs.existsSync(absParent)) {
          for (const entry of fs.readdirSync(absParent, { withFileTypes: true })) {
            if (entry.isDirectory() && fs.existsSync(path.join(absParent, entry.name, 'package.json'))) {
              dirs.push(parent ? `${parent}/${entry.name}` : entry.name);
            }
          }
        }
      }
      for (const dir of dirs) {
        const normalizedDir = dir.replaceAll('\\', '/');
        if (seenDirs.has(normalizedDir)) continue;
        seenDirs.add(normalizedDir);
        const pkgPath = path.join(root, normalizedDir);
        const manifest = JSON.parse(fs.readFileSync(path.join(pkgPath, 'package.json'), 'utf8'));
        if (!manifest.private && manifest.name && manifest.version) {
          packages.push({
            name: manifest.name,
            version: manifest.version,
            path: pkgPath,
            directory: normalizedDir,
          });
        }
      }
    }
  }
  return packages;
}

function resolveChangesetBin() {
  const searchBases = [
    import.meta.url,
    ...(process.env.INIT_CWD ? [path.join(process.env.INIT_CWD, 'package.json')] : []),
    ...(process.env.PATH ?? '')
      .split(path.delimiter)
      .filter((entry) => entry.endsWith(path.join('node_modules', '.bin')))
      .map((entry) => path.join(entry, '..', '..', 'package.json')),
  ];
  for (const base of searchBases) {
    try {
      return createRequire(base).resolve('@changesets/cli/bin.js');
    } catch {
      // continue searching
    }
  }
  return null;
}

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

function readWorkspacePackagesWithVersionTags(plannedPackages, approvedMinors) {
  const packages = listWorkspacePackages();
  const tags = spawnSync(
    'git',
    ['for-each-ref', '--format=%(objectname) %(*objectname) %(refname:strip=2)', 'refs/tags'],
    { cwd: root, encoding: 'utf8' },
  );
  if (tags.status !== 0) {
    process.stderr.write(tags.stdout);
    process.stderr.write(tags.stderr);
    process.exit(tags.status ?? 1);
  }
  const existingTags = new Set();
  const tagToCommit = new Map();
  for (const line of tags.stdout.trim().split('\n').filter(Boolean)) {
    const match = /^([0-9a-f]+)\s+([0-9a-f]*)\s+(.+)$/.exec(line);
    if (match) {
      const [, obj, peeled, tagName] = match;
      existingTags.add(tagName);
      tagToCommit.set(tagName, peeled || obj);
    }
  }
  const evidenceCache = new Map();
  const versionedBaselines = new Map();
  for (const pkg of packages) {
    if (plannedPackages.has(pkg.name) || existingTags.has(`${pkg.name}@${pkg.version}`)) continue;
    const baseline = findVersionedReleaseBaseline({
      root,
      directory: pkg.directory,
      name: pkg.name,
      version: pkg.version,
      evidenceCache,
      approvedMinors,
    });
    if (baseline) versionedBaselines.set(pkg.name, baseline);
  }
  const missingTags = findMissingVersionTags({
    packages: packages.filter((pkg) => !versionedBaselines.has(pkg.name)),
    plannedPackages,
    existingTags,
  });
  if (missingTags.length > 0) {
    console.error('Unplanned publishable packages are missing current version tags:');
    for (const tag of missingTags) console.error(`- ${tag}`);
    process.exit(1);
  }

  const diffByBaseline = new Map();
  const coveragePackages = packages
    .filter((pkg) => !plannedPackages.has(pkg.name))
    .map((pkg) => {
      const baselineRef = versionedBaselines.get(pkg.name) ?? `${pkg.name}@${pkg.version}`;
      const baselineCommit = tagToCommit.get(baselineRef) ?? baselineRef;
      let allChanged = diffByBaseline.get(baselineCommit);
      if (!allChanged) {
        const diff = spawnSync(
          'git',
          ['diff', '--name-only', `${baselineCommit}..HEAD`],
          { cwd: root, encoding: 'utf8' },
        );
        if (diff.status !== 0) {
          process.stderr.write(diff.stdout);
          process.stderr.write(diff.stderr);
          process.exit(diff.status ?? 1);
        }
        allChanged = diff.stdout.trim().split('\n').filter(Boolean);
        diffByBaseline.set(baselineCommit, allChanged);
      }
      const directory = pkg.directory;
      const prefix = `${directory}/`;
      return {
        name: pkg.name,
        version: pkg.version,
        directory,
        changedFiles: allChanged.filter((file) => file.startsWith(prefix)),
      };
    });
  return { packages: coveragePackages, versionedCount: versionedBaselines.size };
}

const versionPolicy = JSON.parse(fs.readFileSync(versionPolicyPath, 'utf8'));
if (versionPolicy.defaultReleaseType !== 'patch') {
  console.error('.changeset/version-policy.json must keep defaultReleaseType=patch');
  process.exit(1);
}

/**
 * `approvedNonPatchReleases`: `[{ package, type: 'minor', reason }]`. Only listed packages may
 * release a minor; a major is never allowed, approved or not. Clear the list after publishing.
 */
function readApprovedMinors(policy) {
  const approvals = policy.approvedNonPatchReleases ?? [];
  if (!Array.isArray(approvals)) {
    console.error('.changeset/version-policy.json approvedNonPatchReleases must be an array');
    process.exit(1);
  }
  const approved = new Map();
  const problems = [];
  for (const [index, approval] of approvals.entries()) {
    const where = `approvedNonPatchReleases[${index}]`;
    if (!approval || typeof approval !== 'object' || Array.isArray(approval)) {
      problems.push(`${where} must be an object`);
      continue;
    }
    const { package: name, type, reason } = approval;
    if (typeof name !== 'string' || !name.trim()) problems.push(`${where}.package must be a package name`);
    else if (approved.has(name)) problems.push(`${where}.package ${name} is listed twice`);
    if (type !== 'minor') problems.push(`${where}.type must be "minor" (major releases are never allowed)`);
    if (typeof reason !== 'string' || !reason.trim()) problems.push(`${where}.reason must explain the breaking change`);
    for (const key of Object.keys(approval)) {
      if (!['package', 'type', 'reason'].includes(key)) problems.push(`${where} has unknown key ${key}`);
    }
    if (typeof name === 'string' && name.trim() && type === 'minor') approved.set(name, reason);
  }
  if (problems.length > 0) {
    console.error('Invalid .changeset/version-policy.json:');
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }
  return approved;
}

const declarations = readChangesetDeclarations();
const approvedMinors = readApprovedMinors(versionPolicy);

const forbiddenDeclarations = declarations.filter((declaration) => declaration.type === 'major'
  || (declaration.type === 'minor' && !approvedMinors.has(declaration.package)));
if (forbiddenDeclarations.length > 0) {
  console.error('Changeset declarations must use patch, or minor for packages in approvedNonPatchReleases (never major):');
  for (const declaration of forbiddenDeclarations) {
    console.error(`- ${declaration.changeset}: ${declaration.package} (${declaration.type})`);
  }
  process.exit(1);
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhin-release-plan-'));
const outputPath = path.join(tempDir, 'release-plan.json');

try {
  // With no declarations, versioning has already consumed the plan (or there
  // are no releases). Changesets status would reject version PR diffs against
  // main before our history-based coverage check can validate them.
  let plan = { releases: [] };
  if (declarations.length > 0) {
    const changesetBin = resolveChangesetBin();
    const result = changesetBin
      ? spawnSync(process.execPath, [changesetBin, 'status', '--output', outputPath], { cwd: root, encoding: 'utf8' })
      : spawnSync('pnpm', ['changeset', 'status', '--output', outputPath], { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) {
      process.stderr.write(result.stdout);
      process.stderr.write(result.stderr);
      process.exit(result.status ?? 1);
    }
    plan = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  }
  // Covers dependents bumped by Changesets too: only approved packages may go minor, nothing major.
  const forbiddenReleases = plan.releases
    .filter((release) => release.type === 'major' || (release.type === 'minor' && !approvedMinors.has(release.name)))
    .map((release) => `${release.name} (${release.type}: ${release.oldVersion} -> ${release.newVersion})`);

  if (forbiddenReleases.length > 0) {
    console.error('Release plan contains forbidden bumps (unapproved minor, or any major):');
    for (const release of forbiddenReleases) console.error(`- ${release}`);
    process.exit(1);
  }

  const plannedReleases = plan.releases.filter((release) => release.type !== 'none');
  const plannedPackages = new Set(plannedReleases.map((release) => release.name));
  const coverage = readWorkspacePackagesWithVersionTags(plannedPackages, approvedMinors);
  const uncovered = findUncoveredPackageChanges({
    packages: coverage.packages,
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

  // A planned version already on npm would be skipped by `changeset publish` with only a warning.
  // Offline runs (no registry) warn locally and fail in CI, so the gate is never silently off there.
  if (process.env.ZHIN_RELEASE_REGISTRY_CHECK === 'off') {
    console.warn('Registry version check skipped (ZHIN_RELEASE_REGISTRY_CHECK=off).');
  } else try {
    const collisions = await findPlannedCollisions(plannedReleases, (name) => readRegistryVersions(name));
    if (collisions.length > 0) {
      console.error('Planned versions already exist on npm (changeset publish would skip them):');
      for (const hit of collisions) {
        console.error(`- ${hit.name}: ${hit.oldVersion} -> ${hit.newVersion}; first free minor is ${hit.suggestion}. `
          + 'Set the package.json version just below it and keep the bump, or pick another version.');
      }
      process.exit(1);
    }
  } catch (error) {
    const message = `Could not check planned versions against the npm registry: ${error instanceof Error ? error.message : String(error)}`;
    if (process.env.CI) {
      console.error(message);
      process.exit(1);
    }
    console.warn(`${message} (skipped outside CI)`);
  }

  const minorCount = plannedReleases.filter((release) => release.type === 'minor').length;
  console.log(
    `Release plan check passed (${plannedReleases.length - minorCount} pending patch releases, ${minorCount} approved minor releases, ${coverage.versionedCount} versioned packages awaiting tags).`,
  );
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
