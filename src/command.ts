import { Dict, isEmpty } from "@zhinjs/shared";
import { Session } from "@/session";
import { Element, h } from "@/element";

type Argv = {
    name: string;
    args: Array<Command.Domain[Command.Type] | Command.Domain[Command.Type][]>;
    options: Record<string, Command.Domain[Command.Type] | Command.Domain[Command.Type][]>;
};

export interface HelpOptions {
    showHidden?: boolean;
    showAuth?: boolean;
    dep?: number;
    current?: number;
    simple?: boolean;
}

function getType(value) {
    if (value === undefined) {
        return "undefined";
    }
    if (value === null) {
        return "null";
    }
    return Object.prototype.toString.call(value).slice(8, -1).toLowerCase();
}

type MayBeRest<T, O extends boolean> = O extends true ? T[] : T;
export type ParseArgType<S, F> = S extends `${infer L}:${infer T}`
    ? L extends `...${infer K}`
        ? ParseArgType<`${K}:${T}`, F>[]
        : T extends Command.Type
        ? Command.Domain[T]
        : S extends Command.Type
        ? Command.Domain[S]
        : F
    : F;
export type ParseOptionType<
    S extends string,
    F,
    R extends boolean = false,
> = S extends `${infer L}:${infer T}`
    ? L extends `...${infer K}`
        ? ParseOptionType<`${K}:${T}`, F, true>
        : {
              [key in L]: MayBeRest<T extends Command.Type ? Command.Domain[T] : F, R>;
          }
    : S extends Command.Type
    ? Record<string, MayBeRest<Command.Domain[S], R>>
    : F;
type ArgType<S> = S extends `${string}<${infer R}>${string}`
    ? ParseArgType<R, string>
    : S extends `${string}[${infer R}]${string}`
    ? Partial<ParseArgType<R, string>>
    : ParseArgType<S, string>;
type OptionType<S extends string> = S extends `${string}<${infer R}>${string}`
    ? ParseOptionType<R, {}>
    : S extends `${string}[${infer R}]${string}`
    ? Partial<ParseOptionType<R, {}>>
    : ParseOptionType<S, {}>;
export type ArgsType<S extends string> = S extends `${infer L} ${infer R}`
    ? [ArgType<L>, ...ArgsType<R>]
    : S extends `${infer L}`
    ? [ArgType<L>]
    : [];
export type OptionsType<S extends string> = S extends `${infer L} ${infer R}`
    ? OptionType<L> & OptionsType<R>
    : S extends `${infer L}`
    ? OptionType<L>
    : {};
type OptionValueType<S extends string> = OptionType<S> extends {
    [key: string]: infer T;
}
    ? T
    : never;

// 定义一个Command类，用于定义指令，这个类的实例会被注册到CommandManager中
export class Command<A extends any[] = [], O = {}> {
    filters: Command.Filters = {};
    callbacks: Command.CallBack<object, A, O>[] = [];
    checkers: Command.CallBack<object, A, O>[] = [];
    public name?: string;
    private aliasNames: string[] = [];
    public parent: Command = null;
    public children: Command[] = [];
    private sugarsConfig: Command.Sugar<A, O>[] = [];
    private argsConfig: Command.ArgsConfig = [];
    private optionsConfig: Command.OptionsConfig = {};

    constructor(public config: Command.Config = {}) {}

    setFilters(filters: Command.Filters) {
        this.filters = filters;
    }

    option<S extends string>(
        option: S,
        initialValue?: OptionValueType<S>,
    ): Command<A, O & OptionType<S>> {
        const optionMatch = option.match(
            /^-(\S+) ([<[])(\.\.\.)?(\w+):(\w+)([>\]])(.*)?/,
        ) as RegExpExecArray;
        if (!optionMatch) throw new Error(`option ${option} is not valid`);
        const [, shortName, required, rest, name, type, _, desc = ""] = optionMatch;
        if (this.optionsConfig[name]) throw new Error(`option ${name} is already defined`);
        this.optionsConfig[name] = {
            type: type as Command.Type,
            name: shortName,
            desc: desc.trimStart(),
            required: required === "<",
            rest: rest === "...",
            initialValue,
        };
        return this as Command<A, O & OptionType<S>>;
    }

    command<S extends Command.Declare>(
        decl: S,
        initialValue?: ArgsType<Command.RemoveFirst<S>>,
    ): Command<ArgsType<Command.RemoveFirst<S>>> {
        const args = [initialValue, this.config].filter(Boolean);
        const name = decl.split(" ")[0];
        const declareStr: Command.RemoveFirst<S> = decl
            .replace(name, "")
            .trimStart() as Command.RemoveFirst<S>;
        const command = defineCommand(declareStr, ...(args as any));
        command.name = name;
        command.parent = this as any;
        this.children.push(command);
        return command;
    }

    check<S extends object>(callback: Command.CallBack<S, A, O>): this {
        this.checkers.push(callback);
        return this;
    }

    hidden() {
        this.config.hidden = true;
        return this;
    }

    desc(desc: string) {
        this.config.desc = desc;
        return this;
    }

    alias(alias: string) {
        this.aliasNames.push(alias);
        return this;
    }

    /**
     * @deprecated use sugar instead
     *
     **/
    shortcut(...params: Parameters<Command["sugar"]>) {
        return this.sugar.apply(this, params as any);
    }

    sugar(sugar: string | RegExp, config?: Omit<Command.Sugar<A, O>, "regexp">): Command<A, O> {
        this.sugarsConfig.push({
            regexp: sugar instanceof RegExp ? sugar : new RegExp(`^${sugar}$`),
            ...config,
        });
        return this;
    }

    use(middleware: (command: Command<any[], any>) => any) {
        middleware(this);
    }

    //显示帮助信息
    help(
        { simple, showHidden, dep = 1, current = 0 }: HelpOptions = {},
        allowList: Command[] = [],
    ) {
        const createArgsOutput = () => {
            const result = [];
            this.argsConfig.forEach(arg => {
                const nameDesc: string[] = [];
                nameDesc.push(arg?.required ? "<" : "[");
                nameDesc.push(arg?.rest ? "..." : "");
                nameDesc.push(arg.name + ":");
                nameDesc.push(String(arg.type));
                nameDesc.push(arg.required ? ">" : "]");
                result.push(nameDesc.join(""));
            });
            return result.join(" ");
        };
        const output: string[] = [`${this.name} ${createArgsOutput()} ${this.config.desc || ""}`];
        if (!simple) {
            if (this.aliasNames.length) output.push(` alias:${this.aliasNames.join(",")}`);
            if (this.sugarsConfig.length)
                output.push(` shortcuts:${this.sugarsConfig.map(sugar => String(sugar.regexp))}`);
            if (!isEmpty(this.optionsConfig)) {
                const options = Object.keys(this.optionsConfig)
                    .filter(name => !name.startsWith("-"))
                    .filter(name => (showHidden ? true : !this.optionsConfig[name].hidden));
                if (options.length) {
                    output.push(" options:");
                    options.forEach(key => {
                        const nameDesc: string[] = [];
                        const option: Command.OptionConfig = this.optionsConfig[key];
                        nameDesc.push(option?.required ? "<" : "[");
                        nameDesc.push(option?.rest ? "..." : "");
                        nameDesc.push(key + ":");
                        nameDesc.push(String(option.type));
                        nameDesc.push(option?.required ? ">" : "]");
                        output.push(`  ${option.name} ${nameDesc.join("")} ${option.desc}`);
                    });
                }
            }
        }
        if (this.children.length && dep !== current) {
            output.push(" children:");
            return output.concat(
                ...this.children
                    .filter(cmd => showHidden || (!cmd.config.hidden && allowList.includes(cmd)))
                    .map(children =>
                        children
                            .help({
                                simple,
                                showHidden,
                                current: current + 1,
                                dep,
                            })
                            .map(str => `${new Array((current + 1) * 2).fill(" ").join("")}${str}`),
                    )
                    .flat(),
            );
        }
        return output;
    }

    action<S extends Session = Session>(callback: Command.CallBack<S, A, O>) {
        this.callbacks.push(callback);
        return this as Command<A, O>;
    }

    async execute<S extends Session>(
        session: S,
        template = session.toString(),
    ): Promise<Element.Fragment | void> {
        let runtime: Command.RunTime<S, A, O> | void;
        try {
            runtime = this.parse(session, template);
        } catch (e) {
            return h("text", { text: e.message });
        }
        if (!runtime) return;
        const filterFn = Command.createFilterFunction(this.filters);
        if (!filterFn(runtime.session)) return;
        for (const checker of runtime.command.checkers) {
            const result = await checker.apply(runtime.command, [
                runtime as Command.RunTime<S, A, O>,
                ...(runtime as Command.RunTime<S, A, O>).args,
            ]);
            if (result) return result;
        }
        for (const callback of runtime.command.callbacks) {
            const result = await callback.apply(runtime.command, [
                runtime as Command.RunTime<S, A, O>,
                ...(runtime as Command.RunTime<S, A, O>).args,
            ]);
            if (result) return result;
        }
    }

    addArgConfig(config: Command.ArgConfig) {
        this.argsConfig.push(config);
    }

    private parseSugar(template: string) {
        const argv: Argv = {
            name: "",
            args: [],
            options: {},
        };
        for (const sugar of this.sugarsConfig) {
            const matched = sugar.regexp.exec(template);
            if (!matched) continue;
            argv.name = this.name;
            const { args = [], options = {} } = sugar;
            for (let i = 0; i < args.length; i++) {
                let arg = args[i];
                const argConfig = this.argsConfig[i];
                if (!argConfig) break;
                if (typeof arg === "string" && arg.startsWith("$") && matched[+arg.slice(1)]) {
                    args[i] = arg = Command.transform(
                        [matched[+arg.slice(1)]],
                        argConfig.type as Command.Type,
                    );
                }
                const isValid = Command.validate(argConfig.type, argConfig.rest, arg);
                if (!isValid) throw new Error(`invalid argument ${arg} for ${argConfig.name}`);
                if (!argConfig.rest) argv.args[i] = arg;
                else {
                    argv.args[i] = Command.transform(
                        [arg, ...args],
                        argConfig.type as Command.Type,
                    );
                }
            }
            for (const option of Object.keys(options)) {
                const optionConfig = this.optionsConfig[option];
                if (!optionConfig) continue;
                if (
                    typeof options[option] === "string" &&
                    options[option].startsWith("$") &&
                    matched[+options[option].slice(1)]
                ) {
                    options[option] = Command.transform(
                        [matched[+options[option].slice(1)]],
                        optionConfig.type as Command.Type,
                    );
                }
                const isValid = Command.validate(
                    optionConfig.type,
                    optionConfig.rest,
                    options[option],
                );
                if (!isValid) throw new Error(`invalid option ${option} for ${optionConfig.name}`);
                if (!optionConfig.rest) argv.options[option] = options[option];
                else {
                    argv.options[option] = Command.transform(
                        [options[option]],
                        optionConfig.type as Command.Type,
                    );
                }
            }
        }
        return argv;
    }

    private parseArgv(template: string) {
        const argv: Argv = {
            name: "",
            args: [],
            options: {},
        };
        const [name, ...matchedArr] = Command.parseParams(template);
        if (![this.name, ...this.aliasNames].includes(name)) return argv;
        argv.name = this.name;
        while (matchedArr.length) {
            const arg = matchedArr.shift();
            if (arg.startsWith("--") || arg.startsWith("-")) {
                const name = arg.startsWith("--")
                    ? arg.slice(2)
                    : Object.entries(this.optionsConfig).find(
                          ([, option]) => option.name === arg.slice(1),
                      )?.[0];
                if (!name) throw new Error(`option ${arg} is not defined`);
                const option = this.optionsConfig[name];
                if (!option) throw new Error(`option ${name} is not defined`);
                if (option.rest) {
                    argv.options[name] = matchedArr.map(arg =>
                        Command.transform([arg], option.type as Command.Type),
                    );
                    break;
                } else {
                    const parser = Command.domains[option.type as Command.Type]?.parse;
                    if (!parser) throw new Error(`type ${option.type} is not defined parser`);
                    const needTransformArgv = parser(matchedArr);
                    argv.options[name] = Command.transform(
                        needTransformArgv,
                        option.type as Command.Type,
                    );
                }
            } else {
                const argConfig = this.argsConfig[argv.args.length];
                if (!argConfig) continue;
                if (argConfig.rest) {
                    matchedArr.unshift(arg);
                    argv.args.push(
                        matchedArr.map(arg =>
                            Command.transform([arg], argConfig.type as Command.Type),
                        ),
                    );
                    break;
                } else {
                    const parser = Command.domains[argConfig.type as Command.Type]?.parse;
                    if (!parser) throw new Error(`type ${argConfig.type} is not defined parser`);
                    matchedArr.unshift(arg);
                    const needTransformArgv = parser(matchedArr);
                    argv.args.push(
                        Command.transform(needTransformArgv, argConfig.type as Command.Type),
                    );
                }
            }
        }
        return argv;
    }

    match<S extends Session>(session: S, template: string): boolean {
        try {
            return !!this.parse(session, template);
        } catch {
            return false;
        }
    }

    parse<S extends Session>(session: S, template: string): Command.RunTime<S, A, O> | void {
        let argv = this.parseSugar(session.content);
        if (!argv.name) argv = this.parseArgv(template);
        if (argv.name !== this.name) {
            if (this.aliasNames.includes(argv.name)) argv.name = this.name;
            else return;
        }
        Command.checkArgv(argv, this.argsConfig, this.optionsConfig);
        return {
            args: argv.args as A,
            options: argv.options as O,
            command: this,
            session,
        };
    }
}

type MayBePromise<T> = T | Promise<T>;

export function defineCommand<S extends string>(
    decl: S,
    initialValue?: ArgsType<S>,
): Command<ArgsType<S>>;
export function defineCommand<S extends string>(
    decl: S,
    config?: Command.Config,
): Command<ArgsType<S>>;
export function defineCommand<S extends string>(
    decl: S,
    initialValue?: ArgsType<S>,
    config?: Command.Config,
): Command<ArgsType<S>>;
export function defineCommand<S extends string>(
    decl: S,
    ...args: (ArgsType<S> | Command.Config)[]
): Command<ArgsType<S>> {
    const initialValue: ArgsType<S> | undefined = Array.isArray(args[0])
        ? undefined
        : (args.shift() as ArgsType<S>);
    const command = new Command<ArgsType<S>>(...(args as [Command.Config?]));
    const argDeclArr = decl.split(" ").filter(Boolean);
    for (let i = 0; i < argDeclArr.length; i++) {
        const argDecl = argDeclArr[i];
        const argMatch = argDecl.match(/^([<[])(\.\.\.)?(\w+):(\w+)([>\]])$/) as RegExpExecArray;
        if (!argMatch) throw new Error(`arg ${argDecl} is not valid`);
        const [, required, rest, name, type] = argMatch;
        command.addArgConfig({
            name,
            type: type as Command.Type,
            required: required === "<",
            rest: rest === "...",
            initialValue: initialValue && initialValue[i],
        });
    }
    return command;
}

export namespace Command {
    export const domains: Domains = {};

    export function removeOuterQuoteOnce(str: string) {
        if (str.startsWith('"') && str.endsWith('"')) return str.slice(1, -1);
        if (str.startsWith("'") && str.endsWith("'")) return str.slice(1, -1);
        if (str.startsWith("`") && str.endsWith("`")) return str.slice(1, -1);
        return str;
    }

    /**
     * 解析参数
     * @param args 参数数组
     * @private
     * @example
     */
    function joinNestedTags(args: string[]) {
        const result: string[] = [];
        const copyArgs = [...args];
        while (copyArgs.length) {
            const arg = copyArgs.shift();
            if (!/^<[^>]+>$/.test(arg)) {
                result.push(arg);
                continue;
            }
            const tag = /^<([^>\s]+).*?>$/.exec(arg)?.[1] || "";
            if (tag.startsWith("/")) {
                result.push(arg);
                continue;
            }
            const endTag = `</${tag}>`;
            const index = copyArgs.findIndex(item => item === endTag);
            if (index === -1) {
                result.push(arg);
            } else {
                const needJoinArg = copyArgs.splice(0, index + 1);
                const endTap = needJoinArg.pop();
                result.push([arg, needJoinArg.join(" "), endTap].join(""));
            }
        }
        return result.map(removeOuterQuoteOnce);
    }

    export function parseParams(text) {
        const regex = /(".*?"|'.*?'|`.*?`|”.*?“|‘.*?’|<[^>]+?>|\S+)/g;
        const matcher = (text: string) => {
            const matches = text.match(regex);
            if (matches) {
                return joinNestedTags(
                    matches.reduce((result, match) => {
                        if (/<\/\S+>/.test(match)) {
                            let [start, ...rest] = match.split("</");
                            result.push(start);
                            let end = `</${rest.join("</")}`;
                            // 继续匹配是否有嵌套标签
                            const endTag = end.split(">")[0] + ">";
                            end = end.slice(endTag.length);
                            result.push(endTag);
                            const nestedMatches = end.match(regex);
                            if (nestedMatches) {
                                result.push(...matcher(nestedMatches.join(" ")));
                            } else {
                                result.push(end);
                            }
                        } else {
                            result.push(match);
                        }
                        return result.filter(Boolean);
                    }, []),
                );
            }
            return [];
        };
        return matcher(text);
    }

    export interface Config {
        hidden?: boolean;
        desc?: string;
    }

    type WithRegIndex<T> = T extends Array<infer R> ? WithRegIndex<R>[] : T | `$${number}`;
    type MapArrWithString<T> = T extends [infer L, ...infer R]
        ? [WithRegIndex<L>?, ...MapArrWithString<R>]
        : T;

    export type RemoveFirst<S extends string> = S extends `${infer L} ${infer R}` ? R : S;
    export type Sugar<A = any[], O = {}> = {
        regexp: RegExp;
        args?: MapArrWithString<A>;
        options?: {
            [P in keyof O]?: WithRegIndex<O[P]>;
        };
    };
    type MaybeArray<T = any> = T | T[];
    type AttrFilter<T extends object> = {
        [P in keyof Session]?: MaybeArray<P> | boolean;
    };
    export type Filters = AttrFilter<Session> | WithFilter | UnionFilter | ExcludeFilter;
    export type WithFilter = {
        and: Filters;
    };
    export type UnionFilter = {
        or: Filters;
    };
    export type ExcludeFilter = {
        not: Filters;
    };

    export function createFilterFunction<T extends Filters>(filters: T) {
        const filterFn = <K extends keyof T | keyof Session>(
            session: Session,
            key: K,
            value: any,
        ) => {
            if (typeof value === "boolean" && typeof session[key as keyof Session] !== "boolean") {
                return value;
            }
            if (Array.isArray(value)) {
                return value.includes(session[key as keyof Session]);
            }
            if (typeof value !== "object") return value === session[key as keyof Session];
            return createFilterFunction(value)(session);
        };
        if (filters["$and"]) {
            return (session: Session) => {
                return Object.entries(filters["$and"]).every(([key, value]) =>
                    filterFn(session, key as keyof T, value as any),
                );
            };
        }
        if (filters["$or"]) {
            return (session: Session) => {
                return Object.entries(filters["$or"]).some(([key, value]) =>
                    filterFn(session, key as keyof T, value as any),
                );
            };
        }
        if (filters["$not"]) {
            return (session: Session) => {
                return Object.entries(filters["$not"]).every(
                    ([key, value]) => !filterFn(session, key as keyof T, value as any),
                );
            };
        }
        return (session: Session) => {
            return Object.entries(filters).every(([key, value]) =>
                filterFn(session, key as keyof T, value as any),
            );
        };
    }

    export type RunTime<S extends object, A extends any[] = [], O = {}> = {
        args: A;
        options: O;
        session: S;
        command: Command<A, O>;
    };
    export type ArgConfig<S extends string = any> = {
        name: S extends `${"<" | "["}${infer L}:${string}${">" | "]"}`
            ? L extends `...${infer K}`
                ? K
                : L
            : string;
        type: S extends `${"<" | "["}${string}:${infer R}${">" | "]"}`
            ? R extends Type
                ? R
                : string
            : string;
        required: S extends `<${string}>` ? true : false;
        rest: S extends `${"<" | "["}...${string}${">" | "]"}` ? true : false;
        initialValue?: S extends `${"<" | "["}${string}:${infer R}=${infer D}${">" | "]"}`
            ? R extends Type
                ? Command.Domain[R]
                : D
            : string;
    };
    export type ArgsConfig = ArgConfig[];
    type PartialArray<T extends any[]> = T extends [infer L, ...infer R]
        ? [L?, ...PartialArray<R>]
        : [];
    export type OptionConfig<S = string> = {
        type: S extends `${"<" | "["}${string}:${infer R}${">" | "]"}`
            ? R extends Type
                ? R
                : string
            : string;
        required: S extends `<${string}>` ? true : false;
        rest: S extends `${"<" | "["}...${string}${">" | "]"}` ? true : false;
        name: string;
        desc: string;
        initialValue?: S extends `${"<" | "["}${string}:${infer R}=${infer D}${">" | "]"}`
            ? R extends Type
                ? [R]
                : D
            : string;
    };
    export type OptionsConfig<S extends string = any> = S extends `${infer L} ${infer R}`
        ? L extends `${"<" | "["}${infer K}:${string}${">" | "]"}`
            ? {
                  [key in K extends `...${infer KR}` ? KR : L]: OptionConfig<L>;
              } & OptionsConfig<R>
            : {
                  [key: string]: OptionConfig<L>;
              } & OptionsConfig<R>
        : {};
    export type CallBack<Session extends object, A extends any[] = [], O = {}> = (
        runtime: RunTime<Session, A, O>,
        ...args: A
    ) => MayBePromise<Element.Fragment | void>;

    export interface Domain {
        text: string;
        string: string;
        integer: number;
        number: number;
        boolean: boolean;
        any: Element.Fragment;
        user_id: number | string;
        regexp: RegExp;
        date: Date;
        json: Dict;
        function: Function;
    }

    export type Type = keyof Domain;
    export type DomainConfig<T extends Type, A extends string[] = string[]> = {
        parse(argv: string[]): A;
        transform: (...source: A) => Domain[T];
        validate: (value: Domain[T]) => boolean;
    };
    export type Domains = {
        [K in keyof Domain]?: DomainConfig<K>;
    };

    export function checkArgv(argv: Argv, argsConfig: ArgConfig[], optionsConfig: OptionsConfig) {
        for (let i = 0; i < argsConfig.length; i++) {
            const arg = argv.args[i];
            const argConfig = argsConfig[i];
            if (!arg && argConfig.required) {
                if (argConfig.initialValue !== undefined) argv.args[i] = argConfig.initialValue;
                else throw new Error(`arg ${argConfig.name} is required`);
            }
            if (arg === undefined && !argConfig.required) continue;
            if (!Command.validate(argConfig.type, argConfig.rest, arg))
                throw new Error(`arg ${argConfig.name} should be ${argConfig.type}`);
        }
        for (const option in optionsConfig) {
            const optionConfig = optionsConfig[option];
            if (optionConfig.required && !argv.options[option]) {
                if (optionConfig.initialValue !== undefined)
                    argv.options[option] = optionConfig.initialValue;
                else throw new Error(`option ${option} is required`);
            }
            if (argv.options[option] === undefined && !optionConfig.required) continue;
            const validate =
                optionConfig.type &&
                domains[optionConfig.type] &&
                domains[optionConfig.type].validate;
            if (!validate) continue;
            if (argv.options[option] && optionConfig.type && !validate(argv.options[option])) {
                if (
                    optionConfig.rest &&
                    Array.isArray(argv.options[option]) &&
                    (argv.options[option] as any[]).every(v => validate(argv.options[option]))
                )
                    continue;
                throw new Error(`option ${option} should be ${optionConfig.type}`);
            }
        }
    }

    export type Declare = `${string} ${string}` | string;
    export function validate<T extends Type>(
        type: string,
        rest: boolean,
        value: Domain[T] | Domain[T][],
    ): boolean {
        if (rest && Array.isArray(value)) return value.every(v => validate(type, false, v));
        const domainConfig = domains[type];
        if (!domainConfig) throw new Error(`type ${type} is not defined`);
        return domainConfig.validate(value as Domain[T]);
    }
    export function transform<T extends Type>(source: string[], type: T): Domain[T] {
        const domainConfig = domains[type];
        if (!domainConfig) throw new Error(`type ${type} is not defined`);
        return domainConfig.transform(...source);
    }

    export function registerDomain<T extends Type, A extends string[]>(
        type: T,
        config:
            | (Pick<DomainConfig<T, A>, "transform"> &
                  Partial<Omit<DomainConfig<T, A>, "transform">>)
            | ((...source: A) => Domain[T]),
    ) {
        if (typeof config === "function") config = { transform: config };
        domains[type] = {
            parse: config.parse || ((argv: string[]) => [argv.shift()]),
            transform: config.transform,
            validate: config.validate || ((source: Domain[T]) => getType(source) === type),
        } as Domains[T];
    }

    registerDomain("any", {
        parse: argv => {
            const result = [...argv];
            while (argv.length) argv.shift();
            return result;
        },
        transform: (...argv) => Element.parse(argv.join(" ")),
        validate: value => !!value,
    });
    registerDomain("text", {
        parse: argv => {
            const result = [...argv];
            while (argv.length) argv.shift();
            return result;
        },
        transform: (...argv) => argv.join(" "),
        validate: value => typeof value === "string",
    });
    registerDomain("string", source => source);
    registerDomain("number", source => +source);
    registerDomain("integer", {
        transform: source => +source,
        validate: value => Number.isInteger(value),
    });
    registerDomain("boolean", {
        parse: argv => [],
        transform: () => true,
    });
    registerDomain("date", source => new Date(source));
    registerDomain("regexp", source => new RegExp(source));
    registerDomain("user_id", {
        transform: source => {
            const autoCloseMention = source.match(/^<mention user_id="(\S+)"[^\/]*?\/>$/);
            const twinningMention = source.match(
                /^<mention user_id="(\S+)"[^>]*?>[^<]*?<\/mention>$/,
            );
            const matched = autoCloseMention || twinningMention;
            if (!matched) {
                if (!/^\d+$/.test(source))
                    throw new Error(
                        `user_id should be number or <mention user_id="string|number"/> or <mention user_id="string|number"></mention>`,
                    );
                return +source;
            }
            return matched[1].match(/^\d+$/) ? +matched[1] : matched[1];
        },
        validate: value => {
            return ["string", "number"].includes(getType(value));
        },
    });
    registerDomain("json", {
        transform: source => JSON.parse(source),
        validate: value => getType(value) === "object",
    });
    registerDomain("function", {
        transform: source => {
            return new Function(`return ${source}`)();
        },
        validate: value => getType(value) === "function",
    });
}
