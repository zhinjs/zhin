#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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

const versionPolicy = JSON.parse(fs.readFileSync(versionPolicyPath, 'utf8'));
if (versionPolicy.defaultReleaseType !== 'patch') {
  console.error('.changeset/version-policy.json must keep defaultReleaseType=patch');
  process.exit(1);
}

const declarations = readChangesetDeclarations();
const approvals = versionPolicy.approvedNonPatchReleases ?? [];
const malformedApprovals = approvals.filter(
  (approval) =>
    approval.approvedBy !== versionPolicy.owner ||
    typeof approval.reason !== 'string' ||
    approval.reason.trim() === '' ||
    (approval.type !== 'minor' && approval.type !== 'major'),
);

if (malformedApprovals.length > 0) {
  console.error('Version policy contains malformed non-patch approvals:');
  for (const approval of malformedApprovals) {
    console.error(`- ${approval.changeset}: ${approval.package} (${approval.type})`);
  }
  process.exit(1);
}

const activeApprovals = approvals.filter((approval) =>
  declarations.some(
    (declaration) =>
      declaration.changeset === approval.changeset &&
      declaration.package === approval.package &&
      declaration.type === approval.type,
  ),
);

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
  const unauthorizedNonPatchReleases = plan.releases
    .filter((release) => release.type === 'minor' || release.type === 'major')
    .filter(
      (release) =>
        !activeApprovals.some(
          (approval) =>
            approval.package === release.name && approval.type === release.type,
        ),
    )
    .map((release) => `${release.name} (${release.oldVersion} -> ${release.newVersion})`);

  if (unauthorizedNonPatchReleases.length > 0) {
    console.error('Release plan contains unauthorized minor or major bumps:');
    for (const release of unauthorizedNonPatchReleases) console.error(`- ${release}`);
    console.error(
      'Record explicit owner approval in .changeset/version-policy.json before merging.',
    );
    process.exit(1);
  }

  const plannedReleases = plan.releases.filter((release) => release.type !== 'none');
  const nonPatchCount = plannedReleases.filter(
    (release) => release.type === 'minor' || release.type === 'major',
  ).length;
  console.log(
    `Release plan check passed (${plannedReleases.length} releases, ${nonPatchCount} approved non-patch releases).`,
  );
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
