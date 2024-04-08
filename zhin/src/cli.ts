import path from 'path';
import fs from 'fs';
import JITI from 'jiti';
const defaultArgv = {
  mode: 'prod',
  entry: 'lib',
  init: false,
};
const getValue = (list: string[], key: string, defaultValue: string) => {
  const value = list[list.indexOf(key) + 1];
  if (!value || value.startsWith('-')) return defaultValue;
  list.splice(list.indexOf(key) + 1, 1);
  return value;
};
const args = process.argv?.slice(2) || [];
for (const key of args) {
  switch (key) {
    case '--entry':
    case '-e':
      defaultArgv.entry = getValue(args, key, defaultArgv.entry);
      break;
    case '--mode':
    case '-m':
      defaultArgv.mode = getValue(args, key, defaultArgv.mode);
      break;
    case 'init':
      defaultArgv.init = true;
  }
}
if (defaultArgv.init && !fs.existsSync(path.resolve(process.cwd(), `plugins`))) {
  fs.mkdirSync(path.resolve(process.cwd(), `plugins`));
}
const jiti = JITI(__dirname);
const entry = path.resolve(__dirname, `index${path.extname(__filename)}`);
jiti(entry).startAppWorker(defaultArgv.mode, defaultArgv.init);
