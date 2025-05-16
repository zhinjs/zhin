import path from 'path';
const getValue = (list: string[], key: string, defaultValue: string) => {
  const value = list[list.indexOf(key) + 1];
  if (!value || value.startsWith('-')) return defaultValue;
  list.splice(list.indexOf(key) + 1, 1);
  return value;
};
const defaultArgv = {
  mode: 'prod',
  key: '',
  entry: 'lib',
  init: false,
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
      break;
    default:
      console.warn(`unknown option ${key}`);
      break;
  }
}

const entry = path.resolve(__dirname, `index${path.extname(__filename)}`);
require(entry).createZhin().start(defaultArgv.key, defaultArgv.mode, defaultArgv.init);
