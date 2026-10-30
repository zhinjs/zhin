import ts from 'typescript';

/** Class ownership and the convention factory have one target authoring contract. */
export function usesSupportedAdapterBase(source) {
  if (/\bextends\s+Adapter\b/u.test(source)
    && !/import\s+\{[^}]*\bAdapter\b[^}]*\}\s+from\s+['"](?:@zhin\.js\/adapter|zhin\.js\/adapter)['"]/su.test(source)) return false;
  const tree = ts.createSourceFile('adapter.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let supported = true;
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'defineAdapter') {
      const definition = node.arguments[0];
      if (definition && ts.isObjectLiteralExpression(definition)) {
        for (const property of definition.properties) {
          const name = property.name;
          const key = name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text
            : name && ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression) ? name.expression.text : undefined;
          if (key === 'create') supported = false;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return supported;
}

/** Each platform registers its actual Adapter class, without a descriptor registry. */
export function declaresAdapterTypeRegistry(source) {
  return /\binterface\s+AdapterRegistry\b/u.test(source)
    && !/\binterface\s+AdapterClientRegistry\b/u.test(source);
}
