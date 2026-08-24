#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const adaptersRoot = path.join(repoRoot, 'plugins/adapters');
const errors = [];
const legacyAgentEndpointRegistries = new Set([
  'plugins/adapters/dingtalk/src/dingtalk-agent-deps.ts',
  'plugins/adapters/discord/src/discord-agent-deps.ts',
  'plugins/adapters/github/src/github-agent-deps.ts',
  'plugins/adapters/icqq/src/icqq-agent-deps.ts',
  'plugins/adapters/kook/src/kook-agent-deps.ts',
  'plugins/adapters/lark/src/lark-agent-deps.ts',
  'plugins/adapters/line/src/line-agent-deps.ts',
  'plugins/adapters/milky/src/milky-agent-deps.ts',
  'plugins/adapters/napcat/src/napcat-agent-deps.ts',
  'plugins/adapters/onebot11/src/onebot11-agent-deps.ts',
  'plugins/adapters/qq/src/qq-agent-deps.ts',
  'plugins/adapters/slack/src/slack-agent-deps.ts',
  'plugins/adapters/telegram/src/telegram-agent-deps.ts',
  'plugins/adapters/wecom/src/wecom-agent-deps.ts',
]);
const legacyAdapterConsumers = new Set([
  'packages/im/agent/src/init/introspection-collectors.ts',
  'packages/im/agent/src/security/owner-approve-always-store.ts',
  'packages/im/agent/src/stability/registry-cleanup.ts',
  'packages/im/agent/src/typing-indicator/integration.ts',
]);

for (const file of typescriptFiles(adaptersRoot)) {
  const relative = path.relative(repoRoot, file).split(path.sep).join('/');
  const source = fs.readFileSync(file, 'utf8');

  if (/\bextends\s+Adapter\b/u.test(source)
    || importsLegacyAdapter(source)) {
    errors.push(`${relative}: platform adapters must use defineAdapter + EndpointInstance, not the legacy Adapter class`);
  }

  if (/^const\s+endpoints\s*=\s*new\s+Map\b/mu.test(source)
    && /-agent-deps\.ts$/u.test(relative)
    && !legacyAgentEndpointRegistries.has(relative)) {
    errors.push(`${relative}: new module-level Agent Endpoint registries are forbidden; resolve the current generation Endpoint instead`);
  }

  if (/^plugins\/adapters\/[^/]+\/adapters\//u.test(relative)) {
    const forbidden = [
      [/\b(?:setTimeout|setInterval)\s*\(/u, 'own timers'],
      [/\baddEventListener\s*\(/u, 'own runtime listeners'],
      [/\bregister\w*AgentEndpoint\s*\(/u, 'register live Agent endpoints'],
      [/\bimplements\s+EndpointInstance\b/u, 'implement Endpoint runtime behavior'],
    ];
    for (const [pattern, responsibility] of forbidden) {
      if (pattern.test(source)) {
        errors.push(`${relative}: Adapter definition must not ${responsibility}`);
      }
    }
  }

  if (isEndpointImplementation(relative)) {
    if (/\bdefineAdapter\b/u.test(source)) {
      errors.push(`${relative}: Endpoint implementation must not define or discover an Adapter`);
    }
    if (/\b(?:defineEndpointRuntimeStateToken|createEndpointRuntimeState)\b/u.test(source)) {
      errors.push(`${relative}: Endpoint implementation must not own the cross-endpoint directory`);
    }
  }
}

for (const root of [
  path.join(repoRoot, 'packages/im/agent/src'),
  path.join(repoRoot, 'plugins/services'),
]) {
  for (const file of typescriptFiles(root)) {
    const relative = path.relative(repoRoot, file).split(path.sep).join('/');
    const source = fs.readFileSync(file, 'utf8');
    if (importsLegacyAdapter(source) && !legacyAdapterConsumers.has(relative)) {
      errors.push(`${relative}: new runtime dependencies on the legacy Adapter class are forbidden; depend on a narrow port or Endpoint interface`);
    }
  }
}

for (const relative of [
  'packages/im/agent/src/activity-feedback/adapter-integration.ts',
  'plugins/services/activity-feedback/src/executor.ts',
]) {
  const source = fs.readFileSync(path.join(repoRoot, relative), 'utf8');
  if (importsLegacyAdapter(source) || /as\s+unknown\s+as\s+Adapter\b/u.test(source)) {
    errors.push(`${relative}: runtime integrations must depend on a narrow outbound port, not fabricate a legacy Adapter`);
  }
}

if (errors.length > 0) {
  console.error(`Adapter/Endpoint responsibility check failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  process.exitCode = 1;
} else {
  console.log(
    `Adapter/Endpoint responsibility check passed `
    + `(${legacyAgentEndpointRegistries.size} Agent registries and `
    + `${legacyAdapterConsumers.size} legacy Adapter consumers remain ratcheted debt).`,
  );
}

function importsLegacyAdapter(source) {
  return /import\s+(?:type\s+)?\{[^}]*\bAdapter\b[^}]*\}\s+from\s+['"](?:@zhin\.js\/core|zhin\.js)['"]/su.test(source);
}

function isEndpointImplementation(relative) {
  if (!/^plugins\/adapters\/[^/]+\/src\//u.test(relative)) return false;
  const basename = path.posix.basename(relative);
  return /(?:^|-)endpoint\.ts$/u.test(basename)
    && !/(?:agent-deps|commands|runtime-state)\.ts$/u.test(basename);
}

function typescriptFiles(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && !['lib', 'dist', 'node_modules'].includes(entry.name)) {
      result.push(...typescriptFiles(file));
    }
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      result.push(file);
    }
  }
  return result;
}
