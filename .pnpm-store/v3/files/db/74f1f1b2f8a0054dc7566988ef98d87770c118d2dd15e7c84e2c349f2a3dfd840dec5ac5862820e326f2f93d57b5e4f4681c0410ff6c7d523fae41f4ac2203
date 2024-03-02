"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.build = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const tsconfig_utils_1 = require("tsconfig-utils");
const module_1 = require("module");
const path_1 = require("path");
const bundle_1 = require("./bundle");
async function compileToFile(filename, config) {
    filename = filename.replace(/\.d\.ts$/, '') + '.tmp.d.ts';
    config.set('project', '.', false);
    config.set('outFile', filename);
    config.set('composite', 'false');
    config.set('incremental', 'false');
    const code = await (0, tsconfig_utils_1.compile)(config.args, { cwd: config.cwd });
    if (code)
        process.exit(code);
    const content = await promises_1.default.readFile(filename, 'utf8');
    await promises_1.default.rm(filename);
    return content;
}
async function getModules(path, prefix = '') {
    const files = await promises_1.default.readdir(path, { withFileTypes: true });
    return [].concat(...await Promise.all(files.map(async (file) => {
        if (file.isDirectory()) {
            return getModules((0, path_1.join)(path, file.name), `${prefix}${file.name}/`);
        }
        else if (file.name.endsWith('.ts')) {
            return [prefix + file.name.slice(0, -3)];
        }
        else {
            return [];
        }
    })));
}
async function build(cwd, args = []) {
    const require = (0, module_1.createRequire)(cwd + '/');
    const config = await (0, tsconfig_utils_1.load)(cwd, args);
    const outFile = config.get('outFile');
    if (!outFile)
        throw new Error('outFile is required');
    const rootDir = config.get('rootDir');
    if (!rootDir)
        throw new Error('rootDir is required');
    const srcpath = `${cwd.replace(/\\/g, '/')}/${rootDir}`;
    const destpath = (0, path_1.resolve)(cwd, outFile);
    const [files, input] = await Promise.all([
        getModules(srcpath),
        compileToFile(destpath, config),
    ]);
    let source = input;
    const { inline = [], exclude = [] } = config.dtsc || {};
    files.push(...inline);
    for (let extra of inline) {
        const meta = require(extra + '/package.json');
        const filename = (0, path_1.join)(extra, meta.typings || meta.types);
        const content = await promises_1.default.readFile(require.resolve(filename), 'utf8');
        source += [`declare module "${extra}" {`, ...content.split('\n')].join('\n    ') + '\n}\n';
    }
    const output = await (0, bundle_1.bundle)({ files, source, exclude });
    await promises_1.default.writeFile(destpath, output);
}
exports.build = build;
