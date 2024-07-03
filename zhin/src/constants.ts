import CM from './plugins/commandParser';
import ECHO from './plugins/echo';
import ZM from './plugins/zhinManager';
import HMR from './plugins/hmr';
import SETUP from './plugins/setup';
import * as fs from 'fs';
import path from 'path';
export function getSubPackagesInfo(dir: string) {
  const dirPath = path.resolve(__dirname, dir);
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter(stat => {
      return stat.isDirectory() && fs.existsSync(path.resolve(dirPath, stat.name, 'package.json'));
    })
    .map(stat => {
      const pkg = JSON.parse(fs.readFileSync(path.resolve(dirPath, stat.name, 'package.json'), 'utf8'));
      return {
        name: pkg.name,
        version: pkg.version,
        author: pkg.author,
        description: pkg.description || '',
        keywords: pkg.keywords || [],
        repository: pkg.repository,
      };
    });
}
const adapters = getSubPackagesInfo(path.resolve(__dirname, '../../packages/adapters'));
export const officialAdapters: typeof adapters = [
  {
    name: 'processAdapter',
    version: 'built-in',
    author: 'zhinjs',
    description: '命令行适配',
    keywords: [],
    repository: 'https://github.com/zhinjs/zhin',
  },
  ...adapters,
];
const plugins = getSubPackagesInfo(path.resolve(__dirname, '../../packages/plugins'));
const services = getSubPackagesInfo(path.resolve(__dirname, '../../packages/services'));
const builtInPlugins: typeof plugins = [
  {
    name: 'echo',
    version: 'built-in',
    author: 'zhinjs',
    description: '简单输出调试',
    keywords: ['echo'],
    repository: 'https://github.com/zhinjs/zhin',
  },
  {
    name: 'pluginManager',
    version: 'built-in',
    author: 'zhinjs',
    description: '插件管理',
    keywords: ['plugin-manager'],
    repository: 'https://github.com/zhinjs/zhin',
  },
  {
    name: 'commandParser',
    version: 'built-in',
    author: 'zhinjs',
    description: '提供指令解析能力',
    keywords: ['command-parser'],
    repository: 'https://github.com/zhinjs/zhin',
  },
  {
    name: 'hmr',
    version: 'built-in',
    author: 'zhinjs',
    description: '提供插件热更和重启能力',
    keywords: ['hmr'],
    repository: 'https://github.com/zhinjs/zhin',
  },
  {
    name: 'setup',
    version: 'built-in',
    author: 'zhinjs',
    description: '提供 setup 语法开发能力',
    keywords: ['setup'],
    repository: 'https://github.com/zhinjs/zhin',
  },
];
export const officialPlugins = [...builtInPlugins, ...plugins, ...services];
export const commandParser = CM;
export const echo = ECHO;
export const zhinManager = ZM;
export const hmr = HMR;
export const setup = SETUP;
export const { version } = JSON.parse(fs.readFileSync(path.resolve('../package.json'), 'utf8'));
