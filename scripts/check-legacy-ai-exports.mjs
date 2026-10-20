#!/usr/bin/env node
/**
 * Harness: forbid legacy SessionManager / duplicate IM identity exports from @zhin.js/ai.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const aiIndex = path.join(repoRoot, 'packages/im/ai/src/index.ts');
const content = fs.readFileSync(aiIndex, 'utf8');

const forbiddenSubstrings = [
  'SessionManager',
  'MemorySessionManager',
  'DatabaseSessionManager',
  'createSessionManager',
  'createMemorySessionManager',
  'createDatabaseSessionManager',
  'resolveIMSessionId',
  'resolveIMSessionIdFromMessage',
  'resolveIMSceneIdForSession',
  'convertLegacyTool',
  'convertLegacyTools',
  'setLegacyProviderResolver',
  'jsonSchemaToTypeBox',
];

const forbiddenPatterns = [
  { label: 'getModel export', re: /\bgetModel\b/ },
  { label: 'Session type export', re: /\bSessionConfig\b|\bSession\b(?=,|\s*\})/ },
];

const violations = [
  ...forbiddenSubstrings.filter((sym) => content.includes(sym)),
  ...forbiddenPatterns.filter(({ re }) => re.test(content)).map(({ label }) => label),
];

if (violations.length) {
  console.error('Harness legacy ai export check: FAILED\n');
  console.error('Remove legacy exports from packages/im/ai/src/index.ts:\n');
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log('Harness legacy ai export check: OK.');
