"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.compile = exports.load = exports.read = exports.TsConfig = void 0;
const promises_1 = require("fs/promises");
const path_1 = require("path");
const types_1 = require("./types");
const child_process_1 = require("child_process");
const module_1 = require("module");
const json5_1 = __importDefault(require("json5"));
class TsConfig {
    constructor(cwd, args) {
        this.cwd = cwd;
        this.args = args;
        this.compilerOptions = {};
    }
    index(key) {
        const names = [key, ...types_1.alias[key] || []].map(word => word.length > 1 ? `--${word}` : `-${word}`);
        return this.args.findIndex(arg => names.some(name => arg.toLowerCase() === name));
    }
    get(key, fallback) {
        const index = this.index(key);
        if (index < 0)
            return fallback !== null && fallback !== void 0 ? fallback : this.compilerOptions[key];
        if (types_1.boolean.includes(key)) {
            return this.args[index + 1] !== 'false';
        }
        else {
            return this.args[index + 1];
        }
    }
    set(key, value, override = true) {
        const index = this.index(key);
        if (index < 0) {
            this.args.push(`--${key}`, value);
        }
        else if (override) {
            this.args.splice(index + 1, 1, value);
        }
    }
}
exports.TsConfig = TsConfig;
const cache = new Map();
async function read(filename) {
    if (cache.has(filename))
        return cache.get(filename);
    const source = await (0, promises_1.readFile)(filename, 'utf8');
    const data = json5_1.default.parse(source);
    cache.set(filename, data);
    return data;
}
exports.read = read;
function makeArray(value) {
    return Array.isArray(value) ? value : value ? [value] : [];
}
async function load(cwd, args = []) {
    var _a, _b;
    const config = new TsConfig(cwd, args);
    let filename = (0, path_1.resolve)(cwd, config.get('project', 'tsconfig.json'));
    const data = await read(filename);
    const queue = makeArray(data.extends);
    outer: while (queue.length) {
        const final = queue.pop();
        const paths = final.startsWith('.')
            ? [(0, path_1.resolve)((0, path_1.dirname)(filename), final)]
            : (0, module_1.createRequire)(filename).resolve.paths(final).map(path => (0, path_1.resolve)(path, final));
        for (const path of paths) {
            try {
                const name = path.endsWith('.json') ? path : path + '.json';
                const parent = await read(name);
                data.compilerOptions = {
                    ...parent.compilerOptions,
                    ...data.compilerOptions,
                    types: [
                        ...(_a = parent.compilerOptions.types) !== null && _a !== void 0 ? _a : [],
                        ...(_b = data.compilerOptions.types) !== null && _b !== void 0 ? _b : [],
                    ],
                };
                filename = name;
                queue.push(...makeArray(parent.extends));
                continue outer;
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
            }
        }
        throw new Error(`Cannot resolve "${final}" in "${filename}`);
    }
    Object.assign(config, data);
    return config;
}
exports.load = load;
async function compile(args, options) {
    const child = (0, child_process_1.fork)(require.resolve('typescript/bin/tsc'), args, { stdio: 'inherit', ...options });
    return new Promise((resolve) => {
        child.on('close', resolve);
    });
}
exports.compile = compile;
