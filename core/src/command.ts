import {deepClone, findLastIndex, isEmpty, trimQuote} from "@/utils";
import { Bot, Dict } from '@/types';
import {Adapter} from "@/adapter";
import { Message } from '@/message';
import { Prompt } from '@/prompt';

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

function getType<T=any>(value:T) {
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
export type OptionType<S extends string> = S extends `${string}<${infer R}>${string}`
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
export type OptionValueType<S extends string> = OptionType<S> extends {
        [key: string]: infer T;
    }
    ? T
    : never;

// 定义一个Command类
export class Command<A extends any[] = [], O = {}> {
    private callbacks: Command.CallBack<Adapter, A, O>[] = [];
    private checkers: Command.CallBack<Adapter, A, O>[] = [];
    public name?: string;
    public aliasNames: string[] = [];
    public parent: Command|null = null;
    public children: Command[] = [];
    private sugarsConfig: Command.Sugar<A, O>[] = [];
    private argsConfig: Command.ArgsConfig = [];
    private optionsConfig: Command.OptionsConfig = {};

    constructor(public config: Command.Config = {}) {}

    /**
     * 指定指令可用人员
     * @param permissions
     */
    permission<T extends string=string>(...permissions: T[]) {
        return this.check(({message},...args:A)=>{
            if(!message.sender) return false
            const perms=message.sender.permissions
            if(!perms) return true
            return permissions.some(p=>perms.includes(p))
        })
    }
    /**
     * 指定指令可使用范围
     * @param scopes {Message.Type[]}
     */
    scope(...scopes:Message.Type[]){
        return this.check(({message},...args:A)=>{
            return scopes.includes(message.message_type)
        })
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
        if (this.optionsConfig[name as keyof Command.OptionsConfig]) throw new Error(`option ${name} is already defined`);
        // @ts-ignore
        this.optionsConfig[name] = {
            type: type as Command.Type,
            name: shortName,
            desc: desc.trimStart(),
            required: required === "<",
            rest: rest === "...",
            initialValue,
        } as Command.OptionConfig;
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
        this.children.push(command as any);
        return command;
    }

    check<S extends Adapter>(callback: Command.CallBack<S, A, O>): this {
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

    alias(...alias: string[]) {
        this.aliasNames.push(...alias);
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
        middleware(this as any);
    }

    //显示帮助信息
    help(
        { simple, showHidden, dep = 1, current = 0 }: HelpOptions = {},
        allowList: Command[] = [],
    ):string[] {
        const createArgsOutput = () => {
            const result:string[] = [];
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
            if (this.aliasNames.length) output.push(` 别名:${this.aliasNames.join(",")}`);
            if (this.sugarsConfig.length)
                output.push(` 语法糖:${this.sugarsConfig.map(sugar => String(sugar.regexp))}`);
            if (!isEmpty(this.optionsConfig)) {
                const options = Object.keys(this.optionsConfig)
                    .filter(name => !name.startsWith("-"))
                if (options.length) {
                    output.push(" 可选项:");
                    options.forEach(key => {
                        const nameDesc: string[] = [];
                        const option: Command.OptionConfig = this.optionsConfig[key as keyof Command.OptionsConfig];
                        nameDesc.push(option?.required ? "<" : "[");
                        nameDesc.push(option?.rest ? "..." : "");
                        nameDesc.push(key + ":");
                        nameDesc.push(String(option.type || "any"));
                        nameDesc.push(option?.required ? ">" : "]");
                        output.push(`  -${option.name} ${nameDesc.join("")} ${option.desc}`);
                    });
                }
            }
        }
        if (this.children.length && dep !== current) {
            output.push(" 子指令:");
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

    action<AD extends Adapter=Adapter>(callback: Command.CallBack<AD, A, O>) {
        this.callbacks.push(callback);
        return this as Command<A, O>;
    }

    async execute<AD extends Adapter>(
        adapter:AD,
        bot:Bot<AD>,
        message: Message<AD>,
        template = message.raw_message,
    ): Promise<Message.Segment | void> {
        let runtime: Command.RunTime<AD, A, O> | void;
        try {
            runtime = this.parse(adapter,bot,message, template);
        } catch (e:any) {
            return e.message;
        }
        if (!runtime) return;
        for (const checker of runtime.command.checkers) {
            const result = await checker.apply(this, [
                runtime as Command.RunTime<AD, A, O>,
                ...(runtime as Command.RunTime<AD, A, O>).args,
            ]);
            if(typeof result==='boolean'){
                // 验证器返回false时，退出
                if(!result) return
            }else{
                // 验证器返回内容时，退出并上报验证结果
                if(result) return result
            }
        }
        for (const callback of runtime.command.callbacks) {
            const result = await callback.apply(runtime.command, [
                runtime as Command.RunTime<AD, A, O>,
                ...(runtime as Command.RunTime<AD, A, O>).args,
            ]);
            if (result){
                if(typeof result==='boolean') return
                return result
            }
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
            argv.name = this.name!;
            const { args = [], options = {} } = deepClone<Command.Sugar<any[],any>>(sugar);
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
                const optionConfig:Command.OptionConfig = this.optionsConfig[option as keyof Command.OptionsConfig];
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
        argv.name = this.name!;
        while (matchedArr.length) {
            const arg = matchedArr.shift();
            if(!arg) break
            if (arg.startsWith("--") || arg.startsWith("-")) {
                const name = arg.startsWith("--")
                    ? arg.slice(2)
                    : Object.entries(this.optionsConfig).find(
                        ([, option]) => option.name === arg.slice(1),
                    )?.[0];
                if (!name) throw new Error(`option ${arg} is not defined`);
                const option:Command.OptionConfig = this.optionsConfig[name as keyof Command.OptionsConfig];
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

    match<AD extends Adapter>(adapter:AD,bot:Bot<AD>,message: Message<AD>, template: string): boolean {
        try {
            return !!this.parse(adapter,bot,message, template);
        } catch {
            return false;
        }
    }

    parse<AD extends Adapter>(adapter:AD,bot:Bot<AD>,message: Message<AD>, template: string): Command.RunTime<AD, A, O> | void {
        let argv = this.parseSugar(template);
        if (!argv.name) argv = this.parseArgv(template);
        if (argv.name !== this.name) {
            if (this.aliasNames.includes(argv.name)) argv.name = this.name!;
            else return;
        }
        Command.checkArgv(argv, this.argsConfig, this.optionsConfig);
        return {
            args: argv.args as A,
            options: argv.options as O,
            adapter,
            bot,
            prompt:new Prompt(adapter,bot,message),
            command: this,
            message,
        };
    }
}

type MayBePromise<T> = T | Promise<T>;

// @ts-ignore
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
    function joinedArg(args: string[]) {
        let result = "";
        while (args.length) {
            const arg = args.shift();
            if(!arg) return
            // 匹配自闭合标签或成对标签
            const isCloseTag = /^<\/.+?>$/.test(arg);
            const isTag = isCloseTag || /^<[^>]+>[^<]*?<\/[^>]+>$/.test(arg);
            result += isTag ? arg : `${arg} `;
        }
        return result.trim();
    }
    /**
     * 将一串字符串转换为参数数组，参数数组中的每一项都是一个字符串或标签
     * @param text
     */
    export function parseParams(text: string) {
        const regex = /("[^"]*?"|'[^']*?'|`[^`]*?`|“[^”]*?”|’[^‘]*?‘|<[^>]+?>)/;
        const stack: string[] = []; // 结果栈
        while (text.length) {
            const [match] = text.match(regex) || [];
            if (!match) break;
            const index = text.indexOf(match);
            const prevText = text.slice(0, index);
            if (prevText) stack.push(...prevText.split(" ").map(s => s || " "));
            text = text.slice(index + match.length);
            if (match.startsWith("<")) {
                // 起始标签
                if (match.startsWith("</")) {
                    // 结束标签
                    const tag = match.slice(2, -1);
                    const startTagReg = new RegExp(`^<${tag}.*?>$`);
                    const startTagIndex = findLastIndex(stack, item => startTagReg.test(item));
                    if (startTagIndex === -1) {
                        stack.push(match);
                        continue;
                    }
                    const needJoinArg = stack.splice(startTagIndex);
                    const first = needJoinArg.shift();
                    stack.push([first, joinedArg(needJoinArg), match].join(""));
                } else {
                    stack.push(match);
                }
            } else {
                stack.push(match);
            }
        }
        stack.push(...text.split(" ").map(s => s || " "));
        return stack.filter(s => s !== " ").map(trimQuote);
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


    export type RunTime<AD extends Adapter, A extends any[] = [], O = {}> = {
        args: A;
        adapter:AD
        options: O;
        bot:Bot<AD>;
        prompt:Prompt<AD>
        message: Message<AD>;
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
    export type CallBack<AD extends Adapter=Adapter, A extends any[] = [], O = {}> = (
        runtime: RunTime<AD, A, O>,
        ...args: A
    ) => MayBePromise<Message.Segment | boolean | void>;

    export interface Domain {
        text: string;
        string: string;
        integer: number;
        number: number;
        boolean: boolean;
        any: any;
        user_id: string;
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
    } & {[key:string]:never};

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
            // @ts-ignore
            const optionConfig:Command.OptionConfig = optionsConfig[option];
            if (optionConfig.required && argv.options[option]===undefined) {
                if (optionConfig.initialValue !== undefined)
                    argv.options[option] = optionConfig.initialValue;
                else throw new Error(`option ${option} is required`);
            }
            if (argv.options[option] === undefined && !optionConfig.required) continue;
            const validate =
                optionConfig.type &&
                domains[optionConfig.type] &&
                domains[optionConfig.type as keyof Command.Domain]?.validate;
            if (!validate) continue;
            // @ts-ignore
            if (argv.options[option] && optionConfig.type && !validate(argv.options[option])) {
                if (
                    optionConfig.rest &&
                    Array.isArray(argv.options[option]) &&
                    (argv.options[option] as any[]).every(v => (validate as Function)(v))
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
        const domainConfig = domains[type as T];
        if (!domainConfig) throw new Error(`type ${type} is not defined`);
        return domainConfig.validate(value as never);
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
        transform: (...argv) => argv.join(' '),
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
        parse: argv => [] as [],
        transform: () => true,
    });
    registerDomain("date", source => new Date(source));
    registerDomain("regexp", source => new RegExp(source));
    registerDomain("user_id", {
        transform: source => {
            const autoCloseMention = source.match(/^<at user_id="(\S+)"[^\/]*?\/>$/);
            const twinningMention = source.match(
                /^<at user_id="(\S+)"[^>]*?>[^<]*?<\/at>$/,
            );
            const matched = autoCloseMention || twinningMention;
            if (!matched) {
                if (!/^\d+$/.test(source))
                    throw new Error(
                        `user_id should be number or <at user_id="string|number"/> or <at user_id="string|number"></at>`,
                    );
                return source;
            }
            return matched[1];
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
