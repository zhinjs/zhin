import * as fs from 'fs';
import { compile } from 'vue-node-loader';
import {createJiti} from 'jiti';
const jiti = createJiti(__filename, {
});
const cssMap: Map<string, string[]> = new Map<string, string[]>();
export default function register() {
  require.extensions['.vue'] = (m: NodeModule, filename: string) => {
    const cssArr: string[] = cssMap.get(filename) || [];
    if (!cssMap.has(filename)) cssMap.set(filename, cssArr);
    const source = fs.readFileSync(filename, 'utf8');
    const code = compile(source, filename);
    const result = jiti.evalModule(code, {
      ext: '.ts',
      id: filename,
      filename,
    }) as any;
    cssArr.push(...(result.default?.__CSS__ || []));
    if (m.parent?.filename && cssMap.has(m.parent.filename)) {
      const parentCssArr = cssMap.get(m.parent.filename) || [];
      if (!cssMap.has(m.parent.filename)) cssMap.set(m.parent.filename, parentCssArr);
      parentCssArr.push(...cssArr);
    }
    result.default.__CSS__ = cssArr;
    cssMap.delete(filename);
    m.exports = result;
    return m.exports;
  };
}
