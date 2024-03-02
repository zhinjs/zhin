"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bundle = void 0;
const os_1 = require("os");
async function bundle(options) {
    const { files, source, exclude = [] } = options;
    const moduleRE = `["'](${files.join('|')})["']`;
    const internalImport = new RegExp('import\\(' + moduleRE + '\\)\\.', 'g');
    const internalExport = new RegExp('^ {4}export .+ from ' + moduleRE + ';$');
    const internalInject = new RegExp('^declare module ' + moduleRE + ' {$');
    const importMap = {};
    const namespaceMap = {};
    let prolog = '', cap;
    let current, temporary;
    let identifier, isExportDefault;
    const platforms = {};
    const output = source.split(/\r?\n/g).filter((line) => {
        var _a, _b;
        // Step 1: collect informations
        if (isExportDefault) {
            if (line === '    }')
                isExportDefault = false;
            return false;
        }
        else if (temporary) {
            if (line === '}')
                return temporary = null;
            temporary.push(line);
        }
        else if (cap = /^declare module ["'](.+)["'] \{( \})?$/.exec(line)) {
            //                                  ^1
            // ignore empty module declarations
            if (cap[2])
                return temporary = null;
            if (exclude.includes(cap[1]))
                return temporary = null;
            current = cap[1];
            const segments = current.split(/\//g);
            const lastName = segments.pop();
            if (['node', 'browser'].includes(lastName) && segments.length) {
                temporary = (platforms[_a = segments.join('/')] || (platforms[_a] = {}))[lastName] = [];
            }
            else {
                return true;
            }
        }
        else if (cap = /^ {4}import ["'](.+)["'];$/.exec(line)) {
            //                       ^1
            // import module directly
            if (!files.includes(cap[1]))
                prolog += line.trimStart() + os_1.EOL;
        }
        else if (cap = /^ {4}import \* as (.+) from ["'](.+)["'];$/.exec(line)) {
            //                                ^1            ^2
            // import as namespace
            if (files.includes(cap[2])) {
                // mark internal module as namespace
                namespaceMap[cap[2]] = cap[1];
            }
            else if (!prolog.includes(line.trimStart())) {
                // preserve external module imports once
                prolog += line.trimStart() + os_1.EOL;
            }
        }
        else if (cap = /^ {4}import (\S*)(?:, *)?(?:\{(.+)\})? from ["'](.+)["'];$/.exec(line)) {
            //                          ^1                ^2                ^3
            // ignore internal imports
            if (files.includes(cap[3]))
                return;
            // handle aliases from external imports
            const map = importMap[_b = cap[3]] || (importMap[_b] = {});
            cap[1] && Object.defineProperty(map, 'default', { value: cap[1] });
            cap[2] && cap[2].split(',').map((part) => {
                part = part.trim();
                if (part.includes(' as ')) {
                    const [left, right] = part.split(' as ');
                    map[left.trimEnd()] = right.trimStart();
                }
                else {
                    map[part] = part;
                }
            });
        }
        else if (line.startsWith('///')) {
            prolog += line + os_1.EOL;
        }
        else if (line.startsWith('    export default ')) {
            if (current === 'index')
                return true;
            if (line.endsWith('{'))
                isExportDefault = true;
            return false;
        }
        else {
            return line.trim() !== 'export {};';
        }
    }).map((line) => {
        // Step 2: flatten module declarations
        if (cap = /^declare module ["'](.+)["'] \{$/.exec(line)) {
            if (identifier = namespaceMap[cap[1]]) {
                return `declare namespace ${identifier} {`;
            }
            else {
                return '';
            }
        }
        else if (line === '}') {
            return identifier ? '}' : '';
        }
        else if (!internalExport.exec(line)) {
            if (!identifier)
                line = line.slice(4);
            return line
                .replace(internalImport, '')
                .replace(/import\("index"\)/g, "import('.')")
                .replace(/^(module|class|namespace|const|global) /, (_) => `declare ${_}`);
        }
        else {
            return '';
        }
    }).map((line) => {
        if (cap = internalInject.exec(line)) {
            identifier = '@internal';
            return '';
        }
        else if (line === '}') {
            return identifier ? identifier = '' : '}';
        }
        else {
            if (identifier)
                line = line.slice(4);
            return line.replace(/^((class|namespace|interface) .+ \{)$/, (_) => `export ${_}`);
        }
    }).filter(line => line).join(os_1.EOL);
    Object.entries(importMap).forEach(([name, map]) => {
        const output = [];
        const entries = Object.entries(map);
        if (map.default)
            output.push(map.default);
        if (entries.length) {
            output.push('{ ' + entries.map(([left, right]) => {
                if (left === right)
                    return left;
                return `${left} as ${right}`;
            }).join(', ') + ' }');
        }
        prolog += `import ${output.join(', ')} from '${name}';${os_1.EOL}`;
    });
    return prolog + output + os_1.EOL;
}
exports.bundle = bundle;
