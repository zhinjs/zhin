"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JsonDB = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const utils_1 = require("./utils");
class JsonDB {
    constructor(filePath) {
        this.filePath = filePath;
        this.data = {};
        const dir = path.dirname(this.filePath);
        if (fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        if (!this.filePath.endsWith('.jsondb'))
            this.filePath = this.filePath + '.jsondb';
        if (!fs.existsSync(this.filePath))
            this.write();
        this.init();
    }
    init() {
        this.read();
    }
    write() {
        fs.writeFileSync(this.filePath, (0, utils_1.stringifyObj)(this.data), 'utf8');
    }
    read() {
        this.data = (0, utils_1.parseObjFromStr)(fs.readFileSync(this.filePath, 'utf8'));
    }
    findIndex(route, predicate) {
        const arr = this.getArray(route);
        return arr.findIndex(predicate);
    }
    indexOf(route, item) {
        return this.findIndex(route, value => value === item);
    }
    get(route, initialValue) {
        this.read();
        const parentPath = route.split('.').filter(p => p.length);
        const key = parentPath.pop();
        if (!key)
            return this.data;
        let temp = this.data;
        while (parentPath.length) {
            const currentKey = parentPath.shift();
            if (!Reflect.has(temp, currentKey))
                Reflect.set(temp, key, {});
            temp = Reflect.get(temp, currentKey);
        }
        if (temp[key] !== undefined)
            return temp[key];
        temp[key] = initialValue;
        this.write();
        return initialValue;
    }
    set(route, data) {
        const parentPath = route.split('.');
        const key = parentPath.pop();
        if (!key)
            throw new SyntaxError(`route can't empty`);
        const parentObj = this.get(parentPath.join('.'), {});
        if (!parentObj)
            throw new SyntaxError(`can't set property ${key} of undefined`);
        parentObj[key] = data;
        this.write();
        return data;
    }
    delete(route) {
        const parentPath = route.split('.');
        const key = parentPath.pop();
        if (!key)
            throw new SyntaxError(`route can't empty`);
        const parentObj = this.get(parentPath.join('.'), {});
        if (!parentObj)
            throw new SyntaxError(`property ${key} is not exist of undefined`);
        const result = delete parentObj[key];
        this.write();
        return result;
    }
    getArray(route) {
        if (!route)
            throw new Error(`route can't empty`);
        const arr = this.get(route, []);
        if (!arr)
            throw new SyntaxError(`route ${route} is not define`);
        if (!Array.isArray(arr))
            throw new TypeError(`data ${route} is not an Array`);
        return arr;
    }
    unshift(route, ...data) {
        const arr = this.getArray(route);
        const result = arr.unshift(...data);
        this.write();
        return result;
    }
    shift(route) {
        const arr = this.getArray(route);
        const result = arr.shift();
        this.write();
        return result;
    }
    push(route, ...data) {
        const arr = this.getArray(route);
        const result = arr.push(...data);
        this.write();
        return result;
    }
    pop(route) {
        const arr = this.getArray(route);
        const result = arr.pop();
        this.write();
        return result;
    }
    splice(route, index = 0, deleteCount = 0, ...data) {
        const arr = this.getArray(route);
        const result = arr.splice(index, deleteCount, ...data);
        this.write();
        return result;
    }
    find(route, callback) {
        return this.getArray(route).find(callback);
    }
    filter(route, callback) {
        return this.getArray(route).filter(callback);
    }
}
exports.JsonDB = JsonDB;
