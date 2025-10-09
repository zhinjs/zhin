import { isEmpty } from './utils.js';

export class Schema<S = any, T = S> {
    public [Symbol.toStringTag] = 'Schema';
    constructor(
        public meta: Schema.Meta<S, T>,
        public options: Schema.Options = {},
    ) {
        const _this = this;
        const schema = function (value?: S) {
            const formatter = Schema.resolve(_this.meta.type);
            if (!formatter) throw new Error(`type ${_this.meta.type} not found`);
            return formatter.call(_this, value);
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
        return new Schema<S, T>(meta, options);
    }
    toJSON(): Record<string, any> {
        return Object.fromEntries(
            Object.entries({
                ...this.meta,
                default: typeof this.meta.default === 'function' ? this.meta.default() : this.meta.default,
                inner: this.options.inner?.toJSON(),
                dict: this.options.object
                    ? Object.fromEntries(Object.entries(this.options.object || {}).map(([key, value]) => [key, value.toJSON()]))
                    : undefined,
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
    /** 声明一个数字类型 */
    static number(description: string): Schema<number> {
        return new Schema<number>({ type: 'number', description });
    }
    /** 声明一个字符串类型 */
    static string(description: string): Schema<string> {
        return new Schema<string>({ type: 'string', description });
    }
    /** 声明一个布尔类型 */
    static boolean(description: string): Schema<boolean> {
        return new Schema<boolean>({ type: 'boolean', description });
    }
    /** 声明一个正则类型 */
    static regexp(description: string) {
        return new Schema<RegExp | string, RegExp>({ type: 'regexp', description });
    }
    /** 声明一个日期类型 */
    static date(description: string) {
        return new Schema<Date | number, Date>({ type: 'date', description });
    }
    /** 声明一个字典类型 */
    static dict<X extends Schema>(input: X, description: string) {
        return new Schema<Record<string, Schema.Types<X>>>({ type: 'dict', description }, { inner: input });
    }
    static object<X extends Record<string, Schema>>(input: X, description: string = '') {
        return new Schema<Schema.RecordTypes<X>>({ type: 'object', description }, { object: input });
    }
    /** 声明一个列表类型 */
    static list<X extends Schema>(inner: X, description: string) {
        return new Schema<Schema.Types<X>[]>({ type: 'list', description }, { inner });
    }
    /** 声明一个常量 */
    static const<X extends string | number | boolean>(value: X, description: string) {
        return new Schema<X>({ type: 'const', default: value as any, description });
    }
    static resolve<T extends string>(type: T): Schema.Formatter {
        return Schema.formatters.get(type)!;
    }
    static extend<T extends string>(type: T, formatter: Schema.Formatter) {
        Schema.formatters.set(type, formatter);
    }
}
export interface Schema<S = any> {
    (value?: S): S;
}
export namespace Schema {
    export const formatters: Map<string, Formatter> = new Map<string, Formatter>();
    export type Formatter<S = any, T = S> = (this: Schema, value: S) => T;
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
        description: string;
        component?: string;
        min?: number;
        max?: number;
        step?: number;
    }
    export interface Options {
        object?: Record<string, Schema>;
        inner?: Schema;
    }
    export type Types<T> = T extends Schema<infer S> ? S : never;
    export type RecordTypes<T> = T extends Record<string, Schema>
        ? {
            [K in keyof T]?: Types<T[K]>;
        }
        : unknown;
    export function checkDefault<T>(schema: Schema, value: T, fallback: T = value) {
        if (isEmpty(value)) {
            value = schema.meta.default || fallback;
        }
        const validateType = (schema: Schema, value: any) => {
            switch (schema.meta.type) {
                case 'string':
                    if (!['string', 'undefined'].includes(typeof value)) throw new TypeError(`value is not a string`);
                    break;
                case 'number':
                    if (!['number', 'undefined'].includes(typeof value)) throw new TypeError(`value is not a number`);
                    break;
                case 'boolean':
                    if (!['boolean', 'undefined'].includes(typeof value)) throw new TypeError(`value is not a boolean`);
                    break;
                case 'regexp':
                    if (!['string', 'undefined'].includes(typeof value) && !(value instanceof RegExp))
                        throw new TypeError(`value is not a RegExp|string`);
                    break;
                case 'date':
                    if (!['number', 'undefined'].includes(typeof value) && !(value instanceof Date))
                        throw new TypeError(`value is not a Date|number`);
                    if (value instanceof Date && isNaN(value.getTime())) throw new TypeError(`value is not a valid Date`);
                    break;
                case 'dict':
                    if (!['object', 'undefined', 'null'].includes(typeof value)) throw new TypeError(`value is not a object`);
                    break;
                case 'object':
                    if (!['object', 'undefined', 'null'].includes(typeof value)) throw new TypeError(`value is not a object`);
                    break;
                case 'list':
                    if (typeof value !== 'undefined' && !Array.isArray(value)) throw new TypeError(`value is not a list`);
                    break;
                case 'const':
                    if (typeof value !== 'undefined' && value !== schema.meta.default) throw new TypeError(`value is not const`);
                    break;
                default:
                    throw new TypeError(`value is not a valid type`);
            }
        };
        if (schema.meta.required && typeof value === 'undefined') throw new Error(`value is required`);
        validateType(schema, value);
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
Schema.extend('number', function (this: Schema, value: any) {
    value = Schema.checkDefault(this, value);
    return value;
});
Schema.extend('string', function (this: Schema, value: any) {
    value = Schema.checkDefault(this, value);
    return value;
});
Schema.extend('boolean', function (this: Schema, value: any) {
    return Schema.checkDefault(this, value);
});
Schema.extend('dict', function (this: Schema, value: any) {
    value = Schema.checkDefault(this, value, {});
    return Object.fromEntries(
        Object.entries(value).map(([key, schema]) => {
            return [key, this.options.inner!(schema)];
        }),
    );
});

Schema.extend('object', function (this: Schema, value: any) {
    const getDefault = (schema: Schema) => {
        const result = Object.create(null);
        for (const key in schema.options.object) {
            result[key] = getDefault(schema.options.object[key]);
        }
        return result;
    };
    value = Schema.checkDefault(this, value, getDefault(this));
    return Object.fromEntries(
        Object.entries(value).map(([key, schema]) => {
            return [key, this.options.object![key](schema)];
        }),
    );
});
Schema.extend('list', function (this: Schema, value: any) {
    value = Schema.checkDefault(this, value, []);
    return value.map((item: any) => this.options.inner!(item));
});
Schema.extend('regexp', function (this: Schema, value: any) {
    value = Schema.checkDefault(this, value);
    if (typeof value === 'string') {
        return new RegExp(value);
    }
    return value;
});
Schema.extend('date', function (this: Schema, value: any) {
    value = Schema.checkDefault(this, value);
    return new Date(value);
});
Schema.extend('const', function (this: Schema, value: any) {
    value = Schema.checkDefault(this, value);
    if (value !== this.meta.default) {
        throw new Error('const value not match');
    }
    return value;
});
