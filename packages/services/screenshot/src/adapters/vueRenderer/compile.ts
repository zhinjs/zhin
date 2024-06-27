import { parse, compileStyle, compileScript } from '@vue/compiler-sfc';
import * as fs from 'fs';
import * as path from 'path';
export default function compile(source: string, filename: string): [string, string] {
  const { descriptor, errors } = parse(source, {
    filename,
    sourceMap: false,
  });
  if (errors.length) throw new Error(errors.join('\n'));
  const scopeId = `data-v-${Math.random().toFixed(10).slice(2)}`;
  const compiledScript = compileScript(descriptor, {
    id: scopeId,
    inlineTemplate: true,
    templateOptions: {
      filename,
      ssr: true,
      preprocessLang: descriptor.template?.lang,
    },
  });
  const compiledStyle = descriptor.styles
    .map(
      (style, index) =>
        compileStyle({
          source: style.content,
          trim: true,
          scoped: style.scoped,
          id: scopeId,
          filename,
        }).rawResult?.css,
    )
    .filter(Boolean)
    .join('\n');
  return [compiledScript.content, compiledStyle];
}
