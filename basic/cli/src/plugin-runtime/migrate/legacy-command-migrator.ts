import { link, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import ts from 'typescript';

export type MigrationSeverity = 'manual' | 'error';

export interface MigrationDiagnostic {
  readonly severity: MigrationSeverity;
  readonly source: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

export interface MigrationChange {
  readonly kind: 'command' | 'middleware' | 'component';
  readonly source: string;
  readonly target: string;
  readonly identity: string;
  readonly pattern?: string;
  readonly content: string;
}

export interface LegacyMigrationPlan {
  readonly root: string;
  readonly changes: readonly MigrationChange[];
  readonly diagnostics: readonly MigrationDiagnostic[];
}

export interface LegacyMigrationSummary {
  readonly automatic: number;
  readonly manual: number;
  readonly errors: number;
}

const ignoredDirectories = new Set([
  '.git', '.zhin', 'commands', 'components', 'coverage', 'dist', 'lib', 'middlewares', 'node_modules',
]);

/** Extracts only capabilities whose callbacks have no source-file closure dependencies. */
export class LegacyCapabilityMigrator {
  async plan(projectRoot: string): Promise<LegacyMigrationPlan> {
    const root = resolve(projectRoot);
    const files = await sourceFiles(root);
    const changes: MigrationChange[] = [];
    const diagnostics: MigrationDiagnostic[] = [];
    const targets = new Map<string, string>();
    for (const source of files) {
      const result = analyzeSource(root, source, await readFile(source, 'utf8'));
      for (const change of result.changes) {
        const previous = targets.get(change.target);
        if (previous) {
          diagnostics.push(diagnosticAt(source, 1, 1, 'error',
            `Capability target collides with ${relative(root, previous)}: ${relative(root, change.target)}`));
          continue;
        }
        targets.set(change.target, source);
        changes.push(change);
      }
      diagnostics.push(...result.diagnostics);
    }
    for (const change of changes) {
      if (await exists(change.target)) {
        diagnostics.push(diagnosticAt(change.source, 1, 1, 'error',
          `Migration target already exists: ${relative(root, change.target)}`));
      }
    }
    return Object.freeze({
      root,
      changes: Object.freeze(changes),
      diagnostics: Object.freeze(diagnostics),
    });
  }

  summarize(plan: LegacyMigrationPlan): LegacyMigrationSummary {
    return Object.freeze({
      automatic: plan.changes.length,
      manual: plan.diagnostics.filter((item) => item.severity === 'manual').length,
      errors: plan.diagnostics.filter((item) => item.severity === 'error').length,
    });
  }

  async apply(plan: LegacyMigrationPlan): Promise<void> {
    const summary = this.summarize(plan);
    if (summary.errors > 0) throw new Error('Migration plan contains blocking errors');
    const staged: Array<{ target: string; temporary: string }> = [];
    const committed: string[] = [];
    try {
      for (const [index, change] of plan.changes.entries()) {
        assertMigrationTarget(plan.root, change);
        if (await exists(change.target)) {
          throw new Error(`Migration target already exists: ${relative(plan.root, change.target)}`);
        }
        await mkdir(dirname(change.target), { recursive: true });
        const temporary = `${change.target}.zhin-migrate-${process.pid}-${index}.tmp`;
        await writeFile(temporary, change.content, { flag: 'wx' });
        staged.push({ target: change.target, temporary });
      }
      // Hard-link publication is atomic and refuses a target created by a
      // concurrent migration instead of replacing it like rename would.
      for (const item of staged) {
        await link(item.temporary, item.target);
        committed.push(item.target);
        await rm(item.temporary);
      }
    } catch (error) {
      await Promise.allSettled([
        ...staged.map((item) => rm(item.temporary, { force: true })),
        ...committed.map((target) => rm(target, { force: true })),
      ]);
      throw error;
    }
  }
}

/** @deprecated Use LegacyCapabilityMigrator for command, middleware, and component extraction. */
export class LegacyCommandMigrator extends LegacyCapabilityMigrator {}

interface SourceAnalysis {
  readonly changes: MigrationChange[];
  readonly diagnostics: MigrationDiagnostic[];
}

function analyzeSource(root: string, source: string, text: string): SourceAnalysis {
  const file = ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true, scriptKind(source));
  const changes: MigrationChange[] = [];
  const diagnostics: MigrationDiagnostic[] = [];
  const registrations = collectRegistrations(file);
  const componentBindings = topLevelFunctions(file);
  const middlewareCount = registrations.filter((item) => item.kind === 'middleware').length;
  for (const registration of registrations) {
    if (!registration.topLevel) {
      diagnostics.push(nodeDiagnostic(
        file,
        registration.call,
        'manual',
        `${registration.api}() runs outside module top level`,
      ));
      continue;
    }
    if (registration.kind === 'middleware') {
      const result = analyzeMiddleware(root, file, source, registration.call, middlewareCount);
      if ('change' in result) changes.push(result.change);
      else diagnostics.push(nodeDiagnostic(file, registration.call, 'manual', result.message));
      continue;
    }
    if (registration.kind === 'component') {
      const result = analyzeComponent(root, file, source, registration.call, componentBindings);
      if ('change' in result) changes.push(result.change);
      else diagnostics.push(nodeDiagnostic(file, registration.call, 'manual', result.message));
      continue;
    }
    const parsed = parseBuilder(file, registration.call);
    if ('message' in parsed) {
      diagnostics.push(nodeDiagnostic(file, registration.call, 'manual', parsed.message));
      continue;
    }
    const route = commandRoute(parsed.pattern);
    if (typeof route === 'string') {
      diagnostics.push(nodeDiagnostic(file, registration.call, 'manual', route));
      continue;
    }
    const captures = externalReferences(parsed.action);
    if (captures.length > 0) {
      diagnostics.push(nodeDiagnostic(
        file,
        parsed.action,
        'manual',
        `Command action captures source bindings: ${captures.join(', ')}`,
      ));
      continue;
    }
    const target = join(root, 'commands', ...route);
    changes.push({
      kind: 'command',
      source,
      target,
      identity: parsed.pattern,
      pattern: parsed.pattern,
      content: renderCommand(file, parsed.action, parsed.description),
    });
  }
  return { changes, diagnostics };
}

interface Registration {
  readonly kind: MigrationChange['kind'];
  readonly api: 'addCommand' | 'addMiddleware' | 'addComponent';
  readonly call: ts.CallExpression;
  readonly topLevel: boolean;
}

function collectRegistrations(file: ts.SourceFile): Registration[] {
  const result: Registration[] = [];
  const kinds = new Map<string, Registration['kind']>([
    ['addCommand', 'command'],
    ['addMiddleware', 'middleware'],
    ['addComponent', 'component'],
  ]);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const api = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : undefined;
      const kind = api ? kinds.get(api) : undefined;
      if (kind && api) {
        const statement = node.parent;
        // Keep nested registrations in the inventory, but never lift them out
        // of the runtime branch that originally owned their lifecycle.
        result.push({
          kind,
          api: api as Registration['api'],
          call: node,
          topLevel: ts.isExpressionStatement(statement)
            && statement.expression === node
            && ts.isSourceFile(statement.parent),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return result.sort((left, right) => left.call.getStart(file) - right.call.getStart(file));
}

type MigratableFunction = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;

function analyzeMiddleware(
  root: string,
  file: ts.SourceFile,
  source: string,
  registration: ts.CallExpression,
  countInFile: number,
): { change: MigrationChange } | { message: string } {
  if (registration.arguments.length < 1 || registration.arguments.length > 2) {
    return { message: 'addMiddleware() must receive a callback and optional static name' };
  }
  const handler = registration.arguments[0];
  if (!handler || (!ts.isArrowFunction(handler) && !ts.isFunctionExpression(handler))) {
    return { message: 'Middleware callback must be an inline function' };
  }
  const explicitName = staticString(registration.arguments[1]);
  if (registration.arguments.length === 2 && explicitName === undefined) {
    return { message: 'Middleware name must be a string literal' };
  }
  const inferredName = handler.name?.text
    ?? (countInFile === 1 ? sourceBaseName(source) : undefined);
  const identity = localName(explicitName ?? inferredName);
  if (!identity) return { message: 'Middleware requires a stable static name' };
  const captures = externalReferences(handler);
  if (captures.length > 0) {
    return { message: `Middleware callback captures source bindings: ${captures.join(', ')}` };
  }
  return { change: {
    kind: 'middleware',
    source,
    target: join(root, 'middlewares', `${identity}.ts`),
    identity,
    content: renderMiddleware(file, handler),
  } };
}

function analyzeComponent(
  root: string,
  file: ts.SourceFile,
  source: string,
  registration: ts.CallExpression,
  bindings: ReadonlyMap<string, MigratableFunction>,
): { change: MigrationChange } | { message: string } {
  if (registration.arguments.length !== 1) {
    return { message: 'addComponent() must receive exactly one Component function' };
  }
  const argument = registration.arguments[0];
  const component = argument && ts.isIdentifier(argument)
    ? bindings.get(argument.text)
    : argument && (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))
      ? argument
      : undefined;
  const declaredName = argument && ts.isIdentifier(argument)
    ? argument.text
    : component?.name?.text;
  if (!component || !declaredName) {
    return { message: 'Component must reference a top-level function or use a named inline function' };
  }
  if (component.parameters.length > 1) {
    return { message: 'ComponentContext requires manual migration' };
  }
  const identity = localName(declaredName);
  if (!identity) return { message: `Component name cannot become a capability path: ${declaredName}` };
  const captures = externalReferences(component);
  if (captures.length > 0) {
    return { message: `Component function captures source bindings: ${captures.join(', ')}` };
  }
  const extension = source.endsWith('.tsx') ? 'tsx' : 'ts';
  return { change: {
    kind: 'component',
    source,
    target: join(root, 'components', `${identity}.${extension}`),
    identity,
    content: renderComponent(file, component),
  } };
}

function topLevelFunctions(file: ts.SourceFile): ReadonlyMap<string, MigratableFunction> {
  const result = new Map<string, MigratableFunction>();
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
      result.set(statement.name.text, statement);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) {
        result.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return result;
}

function renderMiddleware(file: ts.SourceFile, handler: MigratableFunction): string {
  const source = handler.getText(file);
  return [
    "import { defineMiddleware } from '@zhin.js/middleware';",
    '',
    'export default defineMiddleware({',
    '  handle(context, next) {',
    `    const middleware = ${source};`,
    '    return middleware(context.input, next);',
    '  },',
    '});',
    '',
  ].join('\n');
}

function renderComponent(file: ts.SourceFile, component: MigratableFunction): string {
  // getText() is embedded byte-for-byte. Reindenting its later lines would
  // also mutate whitespace inside multiline template literals.
  const source = component.getText(file);
  return [
    "import { defineComponent } from '@zhin.js/component';",
    '',
    'export default defineComponent({',
    `  render: ${source},`,
    '});',
    '',
  ].join('\n');
}

function sourceBaseName(source: string): string {
  return source.slice(source.lastIndexOf('/') + 1).replace(/\.tsx?$/u, '');
}

function localName(value: string | undefined): string | undefined {
  if (!value) return;
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .replace(/[^a-zA-Z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase();
  return /^[a-z0-9][a-z0-9-]*$/u.test(normalized) ? normalized : undefined;
}

interface ParsedBuilder {
  readonly pattern: string;
  readonly description?: string;
  readonly action: ts.ArrowFunction | ts.FunctionExpression;
}

function parseBuilder(file: ts.SourceFile, registration: ts.CallExpression): ParsedBuilder | { message: string } {
  if (registration.arguments.length !== 1) {
    return { message: 'addCommand() must receive exactly one MessageCommand' };
  }
  let expression = registration.arguments[0];
  const methods = new Map<string, readonly ts.Expression[]>();
  while (expression && ts.isCallExpression(expression)
    && ts.isPropertyAccessExpression(expression.expression)) {
    const name = expression.expression.name.text;
    if (methods.has(name)) return { message: `MessageCommand.${name}() is repeated` };
    methods.set(name, expression.arguments);
    expression = expression.expression.expression;
  }
  if (!expression || !ts.isNewExpression(expression)
    || !ts.isIdentifier(expression.expression) || expression.expression.text !== 'MessageCommand') {
    return { message: 'addCommand() is not a static new MessageCommand(...) builder' };
  }
  if (expression.arguments?.length !== 1) {
    return { message: 'MessageCommand matcher options require manual migration' };
  }
  const pattern = staticString(expression.arguments?.[0]);
  if (pattern === undefined) return { message: 'MessageCommand pattern must be a string literal' };
  const unsupported = [...methods.keys()].filter((name) => !['action', 'desc'].includes(name));
  if (unsupported.length > 0) {
    return { message: `MessageCommand metadata requires manual migration: ${unsupported.join(', ')}` };
  }
  const actionArguments = methods.get('action');
  const action = actionArguments?.[0];
  if (!action || actionArguments.length !== 1
    || (!ts.isArrowFunction(action) && !ts.isFunctionExpression(action))) {
    return { message: 'MessageCommand requires one inline action function' };
  }
  const descriptions = methods.get('desc') ?? [];
  const descriptionValues = descriptions.map(staticString);
  if (descriptionValues.some((value) => value === undefined)) {
    return { message: 'MessageCommand description must be a string literal' };
  }
  const description = descriptionValues.length > 0
    ? (descriptionValues as string[]).join('\n')
    : undefined;
  return { pattern, description, action };
}

function commandRoute(pattern: string): readonly string[] | string {
  const words = pattern.trim().split(/\s+/u);
  if (words.length === 0 || words[0] === '') return 'Command pattern is empty';
  const route: string[] = [];
  let dynamic = false;
  for (const [index, word] of words.entries()) {
    if (/^[a-z0-9][a-z0-9-]*$/u.test(word)) {
      if (dynamic) return 'Command literals cannot follow a dynamic parameter';
      route.push(index === words.length - 1 ? `${word}.ts` : word);
      continue;
    }
    const match = /^<([a-z][a-zA-Z0-9]*):(text|string|number|boolean)>$/u.exec(word);
    if (!match || index !== words.length - 1 || dynamic) {
      return `Command pattern is outside the automatic route subset: ${pattern}`;
    }
    dynamic = true;
    const type = match[2] === 'text' ? 'string' : match[2];
    route.push(`[${match[1]}:${type}].ts`);
  }
  return route;
}

function renderCommand(
  file: ts.SourceFile,
  action: ts.ArrowFunction | ts.FunctionExpression,
  description?: string,
): string {
  const lines = [
    "import { defineCommand } from '@zhin.js/command';",
    '',
    'export default defineCommand({',
  ];
  if (description !== undefined) lines.push(`  description: ${JSON.stringify(description)},`);
  const source = action.getText(file);
  lines.push(
    '  execute(context) {',
    `    const action = ${source};`,
    '    return action(context.input, { params: context.params, args: context.args });',
    '  },',
    '});',
    '',
  );
  return lines.join('\n');
}

const allowedGlobals = new Set([
  'Array', 'BigInt', 'Boolean', 'Date', 'Error', 'Intl', 'JSON', 'Map', 'Math',
  'Number', 'Object', 'Promise', 'RegExp', 'Set', 'String', 'URL', 'URLSearchParams',
  'clearInterval', 'clearTimeout', 'console', 'decodeURIComponent', 'encodeURIComponent',
  'fetch', 'process', 'queueMicrotask', 'setInterval', 'setTimeout', 'structuredClone',
  'undefined',
]);

function externalReferences(fn: MigratableFunction): string[] {
  if (!fn.body) return [];
  // This is intentionally a syntactic proof, not best-effort name resolution:
  // any source binding left after local/global filtering makes migration manual.
  const declared = new Set<string>();
  if (fn.name) declared.add(fn.name.text);
  for (const parameter of fn.parameters) collectBinding(parameter.name, declared);
  const collect = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) collectBinding(node.name, declared);
    else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      declared.add(node.name.text);
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      collectBinding(node.variableDeclaration.name, declared);
    }
    ts.forEachChild(node, collect);
  };
  collect(fn.body);

  const references = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && isReference(node)
      && !declared.has(node.text) && !allowedGlobals.has(node.text)) {
      references.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(fn.body);
  return [...references].sort();
}

function collectBinding(name: ts.BindingName, result: Set<string>): void {
  if (ts.isIdentifier(name)) result.add(name.text);
  else for (const element of name.elements) if (!ts.isOmittedExpression(element)) {
    collectBinding(element.name, result);
  }
}

function isReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)
    || ts.isPropertyDeclaration(parent)) && parent.name === node) return false;
  if (ts.isShorthandPropertyAssignment(parent)) return true;
  if (ts.isBindingElement(parent) && parent.name === node) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  if ((ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent)) && parent.name === node) {
    return false;
  }
  return !isTypePosition(node);
}

function isTypePosition(node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current?.parent) {
    if (ts.isTypeNode(current.parent)) return true;
    if (ts.isExpression(current.parent) || ts.isStatement(current.parent)) return false;
    current = current.parent;
  }
  return false;
}

async function sourceFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(join(directory, entry.name));
      } else if (entry.isFile() && /\.tsx?$/u.test(entry.name)) {
        result.push(join(directory, entry.name));
      }
    }
  };
  await visit(root);
  return result;
}

function staticString(node: ts.Expression | undefined): string | undefined {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;
}

function nodeDiagnostic(
  file: ts.SourceFile,
  node: ts.Node,
  severity: MigrationSeverity,
  message: string,
): MigrationDiagnostic {
  const position = file.getLineAndCharacterOfPosition(node.getStart(file, false));
  return diagnosticAt(file.fileName, position.line + 1, position.character + 1, severity, message);
}

function diagnosticAt(
  source: string,
  line: number,
  column: number,
  severity: MigrationSeverity,
  message: string,
): MigrationDiagnostic {
  return Object.freeze({ severity, source, line, column, message });
}

function scriptKind(file: string): ts.ScriptKind {
  return file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

async function exists(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile(); }
  catch { return false; }
}

function assertMigrationTarget(root: string, change: MigrationChange): void {
  const roots: Record<MigrationChange['kind'], string> = {
    command: 'commands',
    component: 'components',
    middleware: 'middlewares',
  };
  const capabilityRoot = resolve(root, roots[change.kind]);
  const targetPath = resolve(change.target);
  const child = relative(capabilityRoot, targetPath);
  const extensionAllowed = change.kind === 'component'
    ? /\.tsx?$/u.test(targetPath)
    : targetPath.endsWith('.ts');
  if (!child || child.startsWith('..') || isAbsolute(child) || !extensionAllowed) {
    throw new Error(`Invalid migration target: ${change.target}`);
  }
}
