import { createRequire } from 'node:module';
import type ts from 'typescript';

const require = createRequire(import.meta.url);

/** TypeScript is optional until a client source actually needs static analysis. */
function compiler(): typeof ts {
  try {
    return require('typescript') as typeof ts;
  } catch (cause) {
    throw new Error('Console Page/Layout compilation requires the optional typescript peer dependency. Install typescript >=5.8.0 <7.0.0 in the application.', { cause });
  }
}

export function extractPageMetadata(source: string, fileName: string): unknown {
  const file = compiler().createSourceFile(fileName, source, compiler().ScriptTarget.Latest, true, scriptKind(fileName));
  assertDefaultExport(file);
  let metadata: unknown;
  let found = false;
  for (const statement of file.statements) {
    if (!compiler().isVariableStatement(statement) || !hasModifier(statement, compiler().SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!compiler().isIdentifier(declaration.name) || declaration.name.text !== 'meta') continue;
      if (found) fail(file, declaration, 'Page module exports meta more than once');
      found = true;
      assertDefinePageImport(file, declaration);
      metadata = parseDefinePage(file, declaration.initializer);
    }
  }
  return metadata;
}

function assertDefinePageImport(file: ts.SourceFile, node: ts.Node): void {
  const found = file.statements.some((statement) => {
    if (!compiler().isImportDeclaration(statement)
      || !compiler().isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== '@zhin.js/console-contract') return false;
    const bindings = statement.importClause?.namedBindings;
    return bindings && compiler().isNamedImports(bindings)
      && bindings.elements.some((element) => element.name.text === 'definePage'
        && (element.propertyName?.text ?? element.name.text) === 'definePage');
  });
  if (!found) fail(
    file,
    node,
    'Page meta requires a named definePage import from @zhin.js/console-contract',
  );
}

export function assertLayoutModule(source: string, fileName: string): void {
  const file = compiler().createSourceFile(fileName, source, compiler().ScriptTarget.Latest, true, scriptKind(fileName));
  assertDefaultExport(file);
}

function parseDefinePage(file: ts.SourceFile, expression: ts.Expression | undefined): unknown {
  if (!expression || !compiler().isCallExpression(expression)
    || !compiler().isIdentifier(expression.expression) || expression.expression.text !== 'definePage') {
    fail(file, expression ?? file, 'Page meta must be definePage({...})');
  }
  if (expression.arguments.length > 1) fail(file, expression, 'definePage() accepts at most one argument');
  const argument = expression.arguments[0];
  return argument ? literal(file, argument) : {};
}

function literal(file: ts.SourceFile, node: ts.Expression): unknown {
  if (compiler().isStringLiteral(node) || compiler().isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (compiler().isNumericLiteral(node)) return Number(node.text);
  if (node.kind === compiler().SyntaxKind.TrueKeyword) return true;
  if (node.kind === compiler().SyntaxKind.FalseKeyword) return false;
  if (node.kind === compiler().SyntaxKind.NullKeyword) return null;
  if (compiler().isPrefixUnaryExpression(node)
    && node.operator === compiler().SyntaxKind.MinusToken && compiler().isNumericLiteral(node.operand)) {
    return -Number(node.operand.text);
  }
  if (compiler().isArrayLiteralExpression(node)) {
    return node.elements.map((element) => {
      if (compiler().isSpreadElement(element) || compiler().isOmittedExpression(element)) {
        fail(file, element, 'Page metadata arrays cannot contain spreads or holes');
      }
      return literal(file, element);
    });
  }
  if (compiler().isObjectLiteralExpression(node)) {
    const result: Record<string, unknown> = {};
    for (const property of node.properties) {
      if (!compiler().isPropertyAssignment(property)) {
        fail(file, property, 'Page metadata only supports static property assignments');
      }
      const name = propertyName(file, property.name);
      if (Object.hasOwn(result, name)) fail(file, property.name, `Duplicate Page metadata key: ${name}`);
      result[name] = literal(file, property.initializer);
    }
    return result;
  }
  fail(file, node, 'Page metadata must contain JSON-like literals only');
}

function propertyName(file: ts.SourceFile, name: ts.PropertyName): string {
  if (compiler().isIdentifier(name) || compiler().isStringLiteral(name) || compiler().isNumericLiteral(name)) return name.text;
  fail(file, name, 'Page metadata does not support computed property names');
}

function assertDefaultExport(file: ts.SourceFile): void {
  const found = file.statements.some((statement) => {
    if (compiler().isExportAssignment(statement)) return !statement.isExportEquals;
    return (compiler().isFunctionDeclaration(statement) || compiler().isClassDeclaration(statement))
      && hasModifier(statement, compiler().SyntaxKind.ExportKeyword)
      && hasModifier(statement, compiler().SyntaxKind.DefaultKeyword);
  });
  if (!found) fail(file, file, 'Client module must have a default export');
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return compiler().canHaveModifiers(node) && compiler().getModifiers(node)?.some((modifier) => modifier.kind === kind) === true;
}

function scriptKind(fileName: string): ts.ScriptKind {
  return fileName.endsWith('.tsx') ? compiler().ScriptKind.TSX : compiler().ScriptKind.TS;
}

function fail(file: ts.SourceFile, node: ts.Node, message: string): never {
  const position = file.getLineAndCharacterOfPosition(node.getStart(file, false));
  throw new ClientSourceError(file.fileName, position.line + 1, position.character + 1, message);
}

export class ClientSourceError extends Error {
  constructor(
    readonly source: string,
    readonly line: number,
    readonly column: number,
    message: string,
  ) {
    super(`${source}:${line}:${column} ${message}`);
    this.name = 'ClientSourceError';
  }
}
