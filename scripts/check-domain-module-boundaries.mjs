#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const boundaries = [
  {
    name: 'Workroom Journal',
    directory: 'packages/im/agent/src/workroom/journal',
  },
  {
    name: 'Workroom Projection Outbox',
    directory: 'packages/im/agent/src/workroom/projection-outbox',
  },
  {
    name: 'Host Extended Console RPC',
    directory: 'packages/host/http/src/console-rpc-extended',
  },
];

const roots = ['basic', 'packages', 'plugins', 'examples', 'tests'];
/** Inspect registered domains without executing source files. */
export function checkDomainModuleBoundaries(root = repoRoot, domains = boundaries) {
  const sourceFiles = roots.flatMap((directory) =>
    collectTypeScriptFiles(path.join(root, directory)),
  );
  const violations = [];

  for (const absoluteFile of sourceFiles) {
    const relativeFile = relative(root, absoluteFile);
    const source = fs.readFileSync(absoluteFile, 'utf8');
    for (const { specifier, line } of moduleReferences(absoluteFile, source)) {
      if (!specifier.startsWith('.')) continue;
      const resolvedTarget = path.resolve(
        path.dirname(absoluteFile),
        specifier.replace(/\.(?:js|jsx)$/u, '.ts'),
      );
      for (const boundary of domains) {
        const absoluteBoundary = path.join(root, boundary.directory);
        const canonicalEntry = path.join(absoluteBoundary, 'index.ts');
        const insideBoundary = absoluteFile.startsWith(`${absoluteBoundary}${path.sep}`);
        if (insideBoundary) continue;
        const deepImport =
          resolvedTarget.startsWith(`${absoluteBoundary}${path.sep}`) &&
          resolvedTarget !== canonicalEntry;
        const removedEntry = resolvedTarget === `${absoluteBoundary}.ts`;
        if (!deepImport && !removedEntry) continue;
        violations.push({
          file: relativeFile,
          line,
          boundary: boundary.name,
          specifier,
        });
      }
    }
  }

  for (const boundary of domains) {
    const legacyFile = `${boundary.directory}.ts`;
    if (fs.existsSync(path.join(root, legacyFile))) {
      violations.push({
        file: legacyFile,
        line: 1,
        boundary: boundary.name,
        specifier: 'legacy flat entry',
      });
    }
    if (!fs.existsSync(path.join(root, boundary.directory, 'index.ts'))) {
      violations.push({
        file: `${boundary.directory}/index.ts`,
        line: 1,
        boundary: boundary.name,
        specifier: 'missing canonical entry',
      });
    }
  }
  return violations;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = checkDomainModuleBoundaries();
  if (violations.length > 0) {
    console.error('Domain module boundary check: FAILED\n');
    console.error('Import a deep domain module through its canonical index.ts entry.\n');
    for (const violation of violations) {
      console.error(
        `  ${violation.file}:${violation.line}  ${violation.boundary}: ${violation.specifier}`,
      );
    }
    process.exit(1);
  }

  console.log('Domain module boundary check: passed');
}

function moduleReferences(filename, source) {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const references = [];
  const add = (node) => {
    if (!node || !ts.isStringLiteralLike(node)) return;
    references.push({
      specifier: node.text,
      line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
    });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      add(node.argument.literal);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    )
      add(node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return references;
}

function collectTypeScriptFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === 'dist') continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectTypeScriptFiles(target));
    else if (entry.isFile() && /\.tsx?$/u.test(entry.name)) files.push(target);
  }
  return files;
}

function relative(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}
