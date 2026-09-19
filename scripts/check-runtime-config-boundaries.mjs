#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const canonicalConsumers = [
  'basic/cli/src/commands/doctor.ts',
  'basic/cli/src/commands/onboard.ts',
  'basic/cli/src/commands/packages.ts',
  'basic/cli/src/commands/setup.ts',
  'basic/cli/src/commands/uninstall.ts',
  'basic/cli/src/plugin-runtime/console/configuration.ts',
  'basic/cli/src/plugin-runtime/start-command.ts',
  'packages/toolkit/scaffold-wizard/src/apply.ts',
  'packages/toolkit/scaffold-wizard/src/optional-peers.ts',
  'packages/toolkit/scaffold-wizard/src/project-config-plan.ts',
  'packages/toolkit/scaffold-wizard/src/zhin-stack-deps.ts',
];
const canonicalAiConsumers = [
  'basic/cli/src/commands/onboard.ts',
  'basic/cli/src/commands/setup.ts',
  'packages/toolkit/create-zhin/src/index.ts',
  'packages/toolkit/scaffold-wizard/src/ai.ts',
  'packages/toolkit/scaffold-wizard/src/project-deps.ts',
];

const violations = [];
for (const relative of canonicalConsumers) {
  const source = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
  if (/Array\.isArray\((?:(?:config|document|next|state\.config)\.plugins|plugins)\)/u.test(source)) {
    violations.push(`${relative}: normal runtime/configuration paths must not interpret plugins arrays`);
  }
  if (/\bnormalizePluginsMap\b/u.test(source)) {
    violations.push(`${relative}: normal paths must not normalize legacy Plugin configuration`);
  }
}

for (const relative of canonicalAiConsumers) {
  const source = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
  if (/\bdefaultProvider\b/u.test(source)) {
    violations.push(`${relative}: normal setup and diagnosis paths must use agentProvider or ai.agents`);
  }
}

if (violations.length > 0) {
  console.error(`Runtime configuration boundary check failed:\n${violations.map((item) => `- ${item}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(
    'Runtime configuration boundary check passed '
    + '(canonical Plugin and AI configuration only; legacy fields remain explicit migration input).',
  );
}
