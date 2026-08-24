#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const adaptersRoot = path.join(repoRoot, 'plugins/adapters');
const errors = [];
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
    errors.push(`${relative}: platform adapters must use defineAdapter + Endpoint, not the legacy Adapter class`);
  }

  if (/^const\s+endpoints\s*=\s*new\s+Map\b/mu.test(source)
    && /-agent-deps\.ts$/u.test(relative)) {
    errors.push(`${relative}: module-level Agent Endpoint registries are forbidden; resolve the current generation Client instead`);
  }

  if (/-agent-deps\.ts$/u.test(relative) || /from\s+['"][^'"]*-agent-deps\.js['"]/u.test(source)) {
    errors.push(`${relative}: adapter-specific Agent dependency lookup is forbidden; use adapter + operation $client`);
  }

  if (/^plugins\/adapters\/[^/]+\/adapters\//u.test(relative)) {
    const forbidden = [
      [/\b(?:setTimeout|setInterval)\s*\(/u, 'own timers'],
      [/\baddEventListener\s*\(/u, 'own runtime listeners'],
      [/\bregister\w*AgentEndpoint\s*\(/u, 'register live Agent endpoints'],
      [/\bimplements\s+EndpointConnection\b/u, 'implement Endpoint runtime behavior'],
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
    if (/\breadonly\s+client\s*=\s*this\b/u.test(source)
      || /\bget\s+client\s*\([^)]*\)\s*\{\s*return\s+this\s*;/su.test(source)) {
      errors.push(`${relative}: Endpoint must produce a distinct SDK/protocol Client, not expose itself as Client`);
    }
    if (/\bclass\s+\w+Endpoint\s+extends\s+Endpoint\s*\{/u.test(source)) {
      errors.push(`${relative}: Endpoint must declare Endpoint<TClient> explicitly`);
    }
  }
}

for (const entry of fs.readdirSync(adaptersRoot, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'test-utils') continue;
  const src = path.join(adaptersRoot, entry.name, 'src');
  if (!fs.existsSync(src)) continue;
  const hasClientRegistry = typescriptFiles(src).some((file) => (
    /\binterface\s+AdapterClientRegistry\b/u.test(fs.readFileSync(file, 'utf8'))
  ));
  if (!hasClientRegistry) {
    errors.push(`plugins/adapters/${entry.name}: adapter must register its public Client in AdapterClientRegistry`);
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
    + `(distinct registered Clients, no Agent Endpoint registries; `
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
