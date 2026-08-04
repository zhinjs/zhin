#!/usr/bin/env node
/**
 * Repository-only Plugin Runtime migration gate.
 *
 * It intentionally discovers packages from this checkout (or an explicit test
 * fixture root), never from cwd or a user's installed project. A package that
 * declares `zhin.type: plugin` has crossed the migration boundary: its source
 * must not call the legacy Plugin APIs from a function body.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureMarker = 'zhin-migration-gate: legacy-fixture';
const ignoredDirectories = new Set([
  '.git', '.turbo', '.zhin', 'coverage', 'dist', 'lib', 'node_modules',
]);
const fixtureDirectories = new Set(['__fixtures__', 'fixtures', 'test', 'tests']);
const legacyApiBoundaryPackages = new Set([
  // These packages intentionally define the public legacy bridge itself.
  'packages/im/core',
  'packages/im/zhin',
]);

const targetRoot = readTargetRoot(process.argv.slice(2));
const packageRoots = findPluginPackages(targetRoot);
const violations = [
  ...packageRoots.flatMap((packageRoot) => validateManifest(packageRoot)),
  ...packageRoots.flatMap((packageRoot) => legacyCallbackViolations(packageRoot)),
];

if (violations.length > 0) {
  console.error('Plugin Runtime migration readiness gate: FAILED\n');
  for (const violation of violations) console.error(`  ${violation}`);
  console.error('\nNative Plugin Runtime packages cannot add usePlugin()/getPlugin() inside functions.');
  console.error('Move state to definePlugin setup resources or capture it during bootstrap.');
  process.exit(1);
}

console.log(`check:plugin-runtime-migration-readiness passed (${packageRoots.length} native plugin packages).`);

/** @param {string[]} args */
function readTargetRoot(args) {
  if (args.length === 0) return repoRoot;
  if (args.length === 2 && args[0] === '--root') return path.resolve(args[1]);
  console.error('Usage: node scripts/check-plugin-runtime-migration-readiness.mjs [--root <repository-root>]');
  process.exit(2);
}

/** @param {string} root */
function findPluginPackages(root) {
  /** @type {string[]} */
  const packages = [];
  walkDirectories(root, (directory) => {
    const packageFile = path.join(directory, 'package.json');
    if (!fs.existsSync(packageFile)) return;
    const pkg = readPackage(packageFile);
    if (pkg?.zhin?.protocol === 1 && pkg.zhin.type === 'plugin' && !isLegacyApiBoundary(root, directory)) {
      packages.push(directory);
    }
  });
  return packages.sort((left, right) => left.localeCompare(right));
}

/** @param {string} root @param {string} directory */
function isLegacyApiBoundary(root, directory) {
  return root === repoRoot && legacyApiBoundaryPackages.has(path.relative(root, directory).replaceAll(path.sep, '/'));
}

/** @param {string} directory @param {(directory: string) => void} visit */
function walkDirectories(directory, visit) {
  visit(directory);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || ignoredDirectories.has(entry.name) || fixtureDirectories.has(entry.name)) continue;
    walkDirectories(path.join(directory, entry.name), visit);
  }
}

/** @param {string} packageFile */
function readPackage(packageFile) {
  try {
    const value = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** @param {string} packageRoot */
function validateManifest(packageRoot) {
  const pkg = readPackage(path.join(packageRoot, 'package.json'));
  const entry = pkg?.zhin?.entry;
  const relativePackage = displayPath(packageRoot);
  if (typeof entry !== 'string') return [`${relativePackage}/package.json: zhin.entry must be a string`];
  if (pkg.private === true && !/\.tsx?$/u.test(entry)) {
    return [`${relativePackage}/package.json: private Plugin Runtime root must use a TypeScript entry`];
  }
  if (pkg.private !== true && !/\.[cm]?js$/u.test(entry)) {
    return [`${relativePackage}/package.json: published Plugin Runtime package must use a JavaScript entry`];
  }
  return [];
}

/** @param {string} packageRoot */
function legacyCallbackViolations(packageRoot) {
  /** @type {string[]} */
  const violations = [];
  for (const source of sourceFiles(packageRoot)) {
    const content = fs.readFileSync(source, 'utf8');
    if (content.includes(fixtureMarker)) continue;
    const sourceFile = ts.createSourceFile(
      source,
      content,
      ts.ScriptTarget.Latest,
      true,
      source.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    visit(sourceFile, 0);

    /** @param {import('typescript').Node} node @param {number} functionDepth */
    function visit(node, functionDepth) {
      if (functionDepth > 0 && isLegacyPluginCall(node)) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        violations.push(`${displayPath(source)}:${position.line + 1}:${position.character + 1}`
          + ` legacy ${node.expression.text}() call in function scope`);
      }
      const childDepth = functionDepth + (ts.isFunctionLike(node) ? 1 : 0);
      ts.forEachChild(node, (child) => visit(child, childDepth));
    }
  }
  return violations;
}

/** @param {import('typescript').Node} node */
function isLegacyPluginCall(node) {
  return ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && (node.expression.text === 'usePlugin' || node.expression.text === 'getPlugin');
}

/** @param {string} root */
function sourceFiles(root) {
  /** @type {string[]} */
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name) && !fixtureDirectories.has(entry.name)) {
          visit(path.join(directory, entry.name));
        }
      } else if (entry.isFile() && /\.(?:[cm]?ts|tsx)$/u.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        files.push(path.join(directory, entry.name));
      }
    }
  };
  visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

/** @param {string} file */
function displayPath(file) {
  const root = targetRoot === repoRoot ? repoRoot : targetRoot;
  return path.relative(root, file).replaceAll(path.sep, '/');
}
