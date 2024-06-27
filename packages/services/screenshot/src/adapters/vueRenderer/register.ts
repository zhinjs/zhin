import * as fs from 'fs';
import compile from './compile';
import Jiti from 'jiti';
const jiti = Jiti(__filename);
const cssCacheMap: Map<string, string> = new Map<string, string>();
export default function register() {
  require.extensions['.vue'] = (m: NodeModule, filename: string) => {
    const source = fs.readFileSync(filename, 'utf8');
    let [code, css] = compile(source, filename);
    const resultMod = jiti.evalModule(code, {
      id: filename,
      filename,
      ext: '.ts',
    }) as Record<'default', Record<string, unknown>>;
    if (m.parent?.id.endsWith('.vue')) {
      cssCacheMap.set(m.parent.id, `${cssCacheMap.get(m.parent.id) || ''}\n${css}`);
    }
    resultMod.default.__CSS__ = `${cssCacheMap.get(m.id) || ''}\n${css}`;
    m.exports = m.exports.default = resultMod;
    return m.exports;
  };
}
