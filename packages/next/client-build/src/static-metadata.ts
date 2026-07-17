import ts from 'typescript';

export function extractPageMetadata(source: string, fileName: string): unknown {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind(fileName));
  assertDefaultExport(file);
  let metadata: unknown;
  let found = false;
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement) || !hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'meta') continue;
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
    if (!ts.isImportDeclaration(statement)
      || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== '@zhin.js/next-console-contract') return false;
    const bindings = statement.importClause?.namedBindings;
    return bindings && ts.isNamedImports(bindings)
      && bindings.elements.some((element) => element.name.text === 'definePage'
        && (element.propertyName?.text ?? element.name.text) === 'definePage');
  });
  if (!found) fail(
    file,
    node,
    'Page meta requires a named definePage import from @zhin.js/next-console-contract',
  );
}

export function assertLayoutModule(source: string, fileName: string): void {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKind(fileName));
  assertDefaultExport(file);
}

function parseDefinePage(file: ts.SourceFile, expression: ts.Expression | undefined): unknown {
  if (!expression || !ts.isCallExpression(expression)
    || !ts.isIdentifier(expression.expression) || expression.expression.text !== 'definePage') {
    fail(file, expression ?? file, 'Page meta must be definePage({...})');
  }
  if (expression.arguments.length > 1) fail(file, expression, 'definePage() accepts at most one argument');
  const argument = expression.arguments[0];
  return argument ? literal(file, argument) : {};
}

function literal(file: ts.SourceFile, node: ts.Expression): unknown {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isPrefixUnaryExpression(node)
    && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
    return -Number(node.operand.text);
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((element) => {
      if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) {
        fail(file, element, 'Page metadata arrays cannot contain spreads or holes');
      }
      return literal(file, element);
    });
  }
  if (ts.isObjectLiteralExpression(node)) {
    const result: Record<string, unknown> = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) {
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
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  fail(file, name, 'Page metadata does not support computed property names');
}

function assertDefaultExport(file: ts.SourceFile): void {
  const found = file.statements.some((statement) => {
    if (ts.isExportAssignment(statement)) return !statement.isExportEquals;
    return (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement))
      && hasModifier(statement, ts.SyntaxKind.ExportKeyword)
      && hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
  });
  if (!found) fail(file, file, 'Client module must have a default export');
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) === true;
}

function scriptKind(fileName: string): ts.ScriptKind {
  return fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
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
