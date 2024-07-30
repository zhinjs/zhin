import * as fs from 'fs';
import { compile } from 'vue-node-loader';
import Jiti from 'jiti';
const jiti = Jiti(__filename, {
  esmResolve: true,
});
export default function register() {
  require.extensions['.vue'] = (m: NodeModule, filename: string) => {
    const source = fs.readFileSync(filename, 'utf8');
    const code = compile(source, filename);
    m.exports = jiti.evalModule(code, {
      ext: '.ts',
      id: filename,
      filename,
    });
    return m.exports;
  };
}
