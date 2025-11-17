import { isEmpty } from './utils.js';

export class Schema<S = any, T = S> {
    public [Symbol.toStringTag] = 'Schema';
    constructor(
        public meta: Schema.Meta<S, T>,
        public options: Schema.Options = {},
    ) {
        const _this = this;
        const schema = function (value?: S, key: string = 'value') {
            const formatter = Schema.resolve(_this.meta.type);
            if (!formatter) throw new Error(`type ${_this.meta.type} not found`);
            return formatter.call(_this, key, value);
        } as Schema<S, T>;
        return new Proxy(schema, {
            get(target, p: string | symbol, receiver: any): any {
                return Reflect.get(_this, p, receiver);
            },
            set(target, p: string | symbol, value: any, receiver: any): boolean {
                return Reflect.set(_this, p, value, receiver);
            },
        });
    }
    static fromJSON<S, T>(json: Schema.JSON<S, T>) {
        const { object, inner, list, ...meta } = json;
        const options: Schema.Options = {};
        if (object)
            options.object = Object.fromEntries(Object.entries(object).map(([key, value]) => [key, Schema.fromJSON(value)]));
        if (inner) options.inner = Schema.fromJSON(inner);
        if (list) options.list = list.map(item => Schema.fromJSON(item));
        return new Schema<S, T>(meta, options);
    }
    toJSON(): Record<string, any> {
        return Object.fromEntries(
            Object.entries({
                ...this.meta,
                default: typeof this.meta.default === 'function' ? this.meta.default() : this.meta.default,
                inner: this.options.inner?.toJSON(),
                object: this.options.object
                    ? Object.fromEntries(Object.entries(this.options.object || {}).map(([key, value]) => [
                        key, 
                        { 
                            ...value.toJSON(), 
                            key 
                        }
                    ]))
                    : undefined,
                list: this.options.list?.map(item => item.toJSON()),
            }).filter(([key, value]) => typeof value !== 'undefined'),
        );
    }
    [Symbol.unscopables]() {
        return {
            options: true,
            meta: true,
        };
    }
    /** 设置是否必填 */
    required(): this {
        this.meta.required = true;
        return this;
    }
    /** 是否隐藏 */
    hidden(): this {
        this.meta.hidden = true;
        return this;
    }
    /** 设置描述 */
    description(description: string): this {
        this.meta.description = description;
        return this;
    }
    /** 设置默认值 */
    default(defaultValue: T): this {
        this.meta.default = defaultValue;
        return this;
    }
    /** 设置选项列表 */
    option(list: (T | Schema.Option<T>)[]): this {
        this.meta.options = Schema.formatOptionList(list);
        return this;
    }
    /** 设置是否允许多选 */
    multiple(): this {
        if (this.meta.type !== 'list') throw new Error('multiple only support list type');
        this.meta.multiple = true;
        return this;
    }
    /** 设置最小值 */
    min(value: number): this {
        this.meta.min = value;
        return this;
    }
    /** 设置最大值 */
    max(value: number): this {
        this.meta.max = value;
        return this;
    }
    /** 设置步进值 */
    step(value: number): this {
        this.meta.step = value;
        return this;
    }
    /** 设置组件类型 */
    component(type: string): this {
        this.meta.component = type;
        return this;
    }
    /** 声明一个数字类型 */
    static number(key?: string): Schema<number> {
        return new Schema<number>({ type: 'number', key });
    }
    /** 声明一个字符串类型 */
    static string(key?: string): Schema<string> {
        return new Schema<string>({ type: 'string', key });
    }
    /** 声明一个布尔类型 */
    static boolean(key?: string): Schema<boolean> {
        return new Schema<boolean>({ type: 'boolean', key });
    }
    /** 声明一个正则类型 */
    static regexp(key?: string) {
        return new Schema<RegExp | string, RegExp>({ type: 'regexp', key });
    }
    /** 声明一个日期类型 */
    static date(key?: string) {
        return new Schema<Date | number, Date>({ type: 'date', key });
    }
    /** 声明一个字典类型 */
    static dict<X extends Schema>(input: X, key?: string) {
        return new Schema<Record<string, Schema.Types<X>>>({ type: 'dict', key }, { inner: input });
    }
    static object<X extends Record<string, Schema>>(input: X, key: string = '') {
        return new Schema<Schema.RecordTypes<X>>({ type: 'object', key }, { object: input });
    }
    /** 声明一个列表类型 */
    static list<X extends Schema>(inner: X, key?: string) {
        return new Schema<Schema.Types<X>[]>({ type: 'list', key }, { inner });
    }
    /** 声明一个元组类型 */
    static tuple<X extends readonly any[]>(list: X, key?: string) {
        return new Schema<Schema.Tuple<X>>({ type: 'tuple', key }, { list });
    }
    /** 声明一个联合类型 */
    static union<X extends readonly any[]>(list: X, key?: string) {
        return new Schema<Schema.Union<X>>({ type: 'union', key }, { list });
    }
    /** 声明一个交叉类型 */
    static intersect<X extends readonly any[]>(list: X, key?: string) {
        return new Schema<Schema.Intersect<X>>({ type: 'intersect', key }, { list });
    }
    /** 声明一个常量 */
    static const<X extends string | number | boolean>(value: X, key?: string) {
        return new Schema<X>({ type: 'const', default: value as any, key });
    }
    /** 声明任意类型 */
    static any(key?: any) {
        return new Schema<any>({ type: 'any', key });
    }
    static resolve<T extends string>(type: T): Schema.Formatter {
        return Schema.formatters.get(type)!;
    }
    static extend<T extends string>(type: T, formatter: Schema.Formatter) {
        Schema.formatters.set(type, formatter);
    }
}
export interface Schema<S = any> {
    (value?: S, key?: string): S;
}
export namespace Schema {
    export const formatters: Map<string, Formatter> = new Map<string, Formatter>();
    export type Formatter<S = any, T = S> = (this: Schema, key: string, value: S) => T;
    export type JSON<S = any, T = S> = Meta<S, T> & {
        object?: Record<string, JSON>;
        inner?: JSON;
        list?: JSON[];
    };
    export interface Meta<S = any, T = S> {
        hidden?: boolean;
        type: string;
        default?: T;
        required?: boolean;
        options?: Option<T>[];
        multiple?: boolean;
        key?: string;
        description?: string;
        component?: string;
        min?: number;
        max?: number;
        step?: number;
    }
    export interface Options {
        object?: Record<string, Schema>;
        inner?: Schema;
        list?: readonly Schema[];
    }
    export type Types<T> = T extends Schema<infer S> ? S : never;
    export type RecordTypes<T> = T extends Record<string, Schema>
        ? {
            [K in keyof T]?: Types<T[K]>;
        }
        : unknown;
    export type Union<T extends readonly any[]> = T extends readonly [infer L, ...infer R]
        ? Types<L> | Union<R>
        : never;
    export type Intersect<T extends readonly any[]> = T extends readonly [infer L, ...infer R]
        ? Types<L> & Intersect<R>
        : unknown;
    export type Tuple<T extends readonly any[]> = T extends readonly [infer L, ...infer R]
        ? [Types<L>, ...Tuple<R>]
        : [];
    export function checkDefault<T>(schema: Schema, key: string, value: T, fallback: T = value) {
        if (isEmpty(value)) {
            value = schema.meta.default || fallback;
        }
        const validateType = (schema: Schema, key: string, value: any) => {
            switch (schema.meta.type) {
                case 'string':
                    if (!['string', 'undefined'].includes(typeof value)) throw new TypeError(`${key} is not a string`);
                    break;
                case 'number':
                    if (!['number', 'undefined'].includes(typeof value)) throw new TypeError(`${key} is not a number`);
                    break;
                case 'boolean':
                    if (!['boolean', 'undefined'].includes(typeof value)) throw new TypeError(`${key} is not a boolean`);
                    break;
                case 'regexp':
                    if (!['string', 'undefined'].includes(typeof value) && !(value instanceof RegExp))
                        throw new TypeError(`${key} is not a RegExp|string`);
                    break;
                case 'date':
                    if (!['number', 'undefined'].includes(typeof value) && !(value instanceof Date))
                        throw new TypeError(`${key} is not a Date|number`);
                    if (value instanceof Date && isNaN(value.getTime())) throw new TypeError(`${key} is not a valid Date`);
                    break;
                case 'dict':
                    if (!['object', 'undefined', 'null'].includes(typeof value)) throw new TypeError(`${key} is not a object`);
                    break;
                case 'object':
                    if (!['object', 'undefined', 'null'].includes(typeof value)) throw new TypeError(`${key} is not a object`);
                    break;
                case 'list':
                    if (typeof value !== 'undefined' && !Array.isArray(value)) throw new TypeError(`${key} is not a list`);
                    break;
                case 'tuple':
                    if (typeof value !== 'undefined' && !Array.isArray(value)) throw new TypeError(`${key} is not a tuple`);
                    break;
                case 'union':
                    // union类型不在这里验证，在extend函数中验证
                    break;
                case 'intersect':
                    // intersect类型不在这里验证，在extend函数中验证
                    break;
                case 'const':
                    if (typeof value !== 'undefined' && value !== schema.meta.default) throw new TypeError(`${key} is not const`);
                    break;
                case 'any':
                    // any类型不验证
                    break;
                default:
                    throw new TypeError(`${key} is not a valid type`);
            }
        };
        if (schema.meta.required && typeof value === 'undefined') throw new Error(`${key} is required`);
        validateType(schema, key, value);
        return value;
    }
    export type Option<T = any> = {
        label: string;
        value: T;
    };
    export function formatOptionList<T extends (any | Schema.Option)[]>(list: T): Schema.Option[] {
        return list.map(item => {
            if (typeof item === 'string') {
                return {
                    label: `${item}`,
                    value: item,
                } as Schema.Option;
            }
            return item as unknown as Schema.Option;
        });
    }
}
Schema.extend('number', function (this: Schema, key: string, value: any) {
    value = Schema.checkDefault(this, key, value);
    return value;
});
Schema.extend('string', function (this: Schema, key: string, value: any) {
    value = Schema.checkDefault(this, key, value);
    return value;
});
Schema.extend('boolean', function (this: Schema, key: string, value: any) {
    return Schema.checkDefault(this, key, value);
});
Schema.extend('dict', function (this: Schema, key: string, value: any) {
    value = Schema.checkDefault(this, key, value, {});
    return Object.fromEntries(
        Object.entries(value).map(([k, schema]) => {
            return [k, this.options.inner!(schema, `${key}.${k}`)];
        }),
    );
});

Schema.extend('object', function (this: Schema, key: string, value: any) {
    const getDefault = (schema: Schema) => {
        const result = Object.create(null);
        for (const key in schema.options.object) {
            const propSchema = schema.options.object[key];
            result[key] = propSchema.default !== undefined ? propSchema.default : undefined;
        }
        return result;
    };
    value = Schema.checkDefault(this, key, value, getDefault(this));
    const result = Object.create(null);
    for (const [k, val] of Object.entries(value)) {
        const propSchema = this.options.object![k];
        if (propSchema) {
            // propSchema是一个可调用的Schema实例
            result[k] = (propSchema as any)(val, `${key}.${k}`);
        } else {
            result[k] = val;
        }
    }
    return result;
});
Schema.extend('list', function (this: Schema, key: string, value: any) {
    value = Schema.checkDefault(this, key, value, []);
    return value.map((item: any, index: number) => this.options.inner!(item, `${key}[${index}]`));
});
Schema.extend('regexp', function (this: Schema, key: string, value: any) {
    value = Schema.checkDefault(this, key, value);
    if (typeof value === 'string') {
        return new RegExp(value);
    }
    return value;
});
Schema.extend('date', function (this: Schema, key: string, value: any) {
    value = Schema.checkDefault(this, key, value);
    return new Date(value);
});
Schema.extend('const', function (this: Schema, key: string, value: any) {
    value = Schema.checkDefault(this, key, value);
    if (value !== this.meta.default) {
        throw new Error(`${key} const value not match`);
    }
    return value;
});
Schema.extend('tuple', function (this: Schema, key: string, value: any) {
    value = Schema.checkDefault(this, key, value, []);
    return value.map((item: any, index: number) => this.options.list![index](item, `${key}[${index}]`));
});
Schema.extend('union', function (this: Schema, key: string, value: any) {
    value = Schema.checkDefault(this, key, value);
    for (const schema of this.options.list!) {
        try {
            return (schema as any)(value, key);
        } catch (e) {}
    }
    throw new Error(`${key} union type not match`);
});
Schema.extend('intersect', function (this: Schema, key: string, value: any) {
    value = Schema.checkDefault(this, key, value);
    for (const schema of this.options.list!) {
        try {
            value = (schema as any)(value, key);
        } catch (e) {
            throw new Error(`${key} intersect type not match`);
        }
    }
    return value;
});
Schema.extend('any', function (this: Schema, key: string, value: any) {
    return Schema.checkDefault(this, key, value);
});