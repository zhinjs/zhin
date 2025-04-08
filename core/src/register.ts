import * as fs from 'fs';
import {createJiti} from 'jiti';
const JITI=createJiti(__filename,{
  fsCache:false
})

function transformTypeScript(source: string, filename: string): string {
  // No need to replace CSS imports since we now handle them properly
  return JITI.transform({
    ts:/.tsx?$/.test(filename),
    filename,
    source,
    jsx:{
      throwIfNamespace:true,
      runtime:'automatic',
      importSource:'zhin',
    }
  })
}
const extensions = ['.tsx', '.ts', '.jsx'];

extensions.forEach(ext => {
  require.extensions[ext] = function(module, filename) {
    (module as any)._compile(transformTypeScript(fs.readFileSync(filename, 'utf8'), filename), filename);
  };
});