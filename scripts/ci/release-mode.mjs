import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { versionCandidate, writeOutputs } from './validation-plan.mjs';

export function releaseMode({ git, manual = false, before }) {
  const files = git('ls-files', '-z').split('\0').filter(Boolean);
  const pending = files.some(file => /^\.changeset\/(?!README\.md$)[^/]+\.md$/.test(file));
  if (manual) return pending ? 'prepare' : 'publish';
  if (pending || !/^[a-f0-9]{40}$/.test(before ?? '') || /^0+$/.test(before)) return 'none';
  const fields = git('diff', '--no-renames', '--name-status', '-z', before, 'HEAD').split('\0');
  const changes = [];
  for (let i = 0; i + 1 < fields.length; i += 2) changes.push({ status: fields[i], path: fields[i + 1] });
  return versionCandidate(changes) ? 'publish' : 'none';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const event = JSON.parse((await import('node:fs')).readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const mode = releaseMode({ manual: process.env.GITHUB_EVENT_NAME === 'workflow_dispatch', before: event.before,
    git: (...args) => execFileSync('git', args, { encoding: 'utf8' }) });
  writeOutputs({ mode });
  console.log(`Release work: ${mode}`);
}
