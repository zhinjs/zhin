export class Schema<S = any> {
    constructor(
        public meta: Schema.Meta<S>,
        public options: Schema.Options = {},
    ) {
        return function (value: S) {
            const validator = Schema.resolve(this.meta.type);
            return validator.apply(this, [value]);
        }.bind(this) as Schema<S>;
    }

    required(required?: boolean): this {
        this.meta.required = !!required;
        return this;
    }
    description(description: string): this {
        this.meta.description = description;
        return this;
    }
    component(component: string): this {
        this.meta.component = component;
        return this;
    }

    min(min: number): this {
        this.meta.min = min;
        return this;
    }

    max(max: number): this {
        this.meta.max = max;
        return this;
    }

    step(step: number): this {
        this.meta.step = step;
        return this;
    }

    static number(key?: string): Schema<number> {
        return new Schema<number>({ key, type: "number" });
    }

    static percent(key?: string): Schema<number> {
        return new Schema<number>({ key, type: "percent" })
            .component("slider")
            .min(0)
            .max(1)
            .step(0.01);
    }
    static string(key?: string): Schema<string> {
        return new Schema<string>({ key, type: "string" });
    }

    static boolean(key?: string): Schema<boolean> {
        return new Schema<boolean>({ key, type: "boolean" });
    }
    static regexp(key?: string): Schema<RegExp | string> {
        return new Schema<RegExp | string>({ key, type: "regexp" });
    }
    static date(key?: string): Schema<Date | number> {
        return new Schema<Date | number>({ key, type: "date" }).component("date-picker");
    }

    static dict<X extends Record<string, Schema>>(dict: X, key?: string) {
        return new Schema<Schema.Dict<X>>({ key: key, type: "dict" }, { dict });
    }
    static array<X extends Schema>(inner: X, key?: string) {
        return new Schema<Schema.Types<X>[]>({ key: key, type: "array" }, { inner });
    }
    static tuple<X extends readonly any[]>(list: X, key?: string): Schema<Schema.Tuple<X>> {
        return new Schema<Schema.Tuple<X>>({ key: key, type: "tuple" }, { list });
    }
    static union<X extends readonly Schema[]>(list: X, key?: string) {
        return new Schema<Schema.Types<X[number]>>({ key: key, type: "union" }, { list });
    }
    static const<X extends string | number | boolean>(value: X, key?: string) {
        return new Schema<X>({ key: key, type: "const", default: value as any });
    }
}
export interface Schema<S = any> {
    (value: S): S;
}
const validator = Schema.tuple([Schema.string(), Schema.number()] as const);
const result = validator(["1", 1]);
Schema.extend("number", function (this: Schema, value: any) {
    if (!this.meta.required) return ["number", undefined, null].includes(typeof value);
    return typeof value === "number";
});
Schema.extend("string", function (this: Schema, value: any) {
    if (!this.meta.required) return ["string", undefined, null].includes(typeof value);
    return typeof value === "string";
});
Schema.extend("boolean", function (this: Schema, value: any) {
    if (!this.meta.required) return ["boolean", undefined, null].includes(typeof value);
    return typeof value === "boolean";
});
Schema.extend("dict", function (this: Schema, value: any) {
    if (!this.meta.required) return ["object", undefined, null].includes(typeof value);
    const keys = Reflect.ownKeys(value);
    return (
        keys.length &&
        keys.every(key => {
            const schema = Reflect.get(this.options.dict, key);
            if (!schema) return false;
            return schema(value[key]);
        })
    );
});
export namespace Schema {
    export const validators: Map<string, Validator> = new Map<string, Validator>();
    export type Validator = (this: Schema, value: any) => boolean;
    export function resolve<T extends string>(type: T): Validator {
        return validators.get(type);
    }
    export function extend<T extends string>(type: T, validator: Validator) {
        validators.set(type, validator);
    }
    export interface Meta<T = any> {
        key?: string;
        type?: string;
        default?: T extends {} ? Partial<T> : T;
        required?: boolean;
        description?: string;
        component?: string;
        min?: number;
        max?: number;
        step?: number;
    }
    export interface Options {
        dict?: Record<string, Schema>;
        inner?: Schema;
        list?: readonly Schema[];
    }
    export type Types<T> = T extends Schema<infer S> ? S : never;
    export type Dict<T> = {
        [K in keyof T]: Types<T[K]>;
    } & Record<string, any>;
    export type Tuple<X extends readonly any[]> = X extends readonly [infer L, ...infer R]
        ? [Types<L>, ...Tuple<R>]
        : [];
}
