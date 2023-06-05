import {isEmpty} from "@zhinjs/shared";

type Argv = {
    name: string
    args: Array<Command.Domain[Command.Type] | Command.Domain[Command.Type][]>
    options: Record<string, Command.Domain[Command.Type] | Command.Domain[Command.Type][]>
}

export interface HelpOptions {
    showHidden?: boolean;
    showAuth?: boolean;
    dep?: number;
    current?: number;
    simple?: boolean;
}
function getType(value) {
    if (value === undefined) {
        return 'undefined'
    }
    if (value === null) {
        return 'null'
    }
    return Object.prototype.toString.call(value).slice(8, -1).toLowerCase()
}

type MayBeRest<T, O extends boolean> = O extends true ? T[] : T
export type ParseArgType<S, F> = S extends `${infer L}:${infer T}` ?
    L extends `...${infer K}` ?
        ParseArgType<`${K}:${T}`, F>[] :
        T extends Command.Type ?
            Command.Domain[T] :
            S extends Command.Type ?
                Command.Domain[S] :
                F :
    F
export type ParseOptionType<S extends string, F, R extends boolean = false> = S extends `${infer L}:${infer T}` ?
    L extends `...${infer K}` ?
        ParseOptionType<`${K}:${T}`, F, true> :
        { [key in L]: MayBeRest<T extends Command.Type ? Command.Domain[T] : F, R> }
    : S extends Command.Type ?
        Record<string, MayBeRest<Command.Domain[S], R>> :
        F
type ArgType<S> = S extends `${string}<${infer R}>${string}` ?
    ParseArgType<R, string> :
    S extends `${string}[${infer R}]${string}` ?
        Partial<ParseArgType<R, string>> :
        ParseArgType<S, string>
type OptionType<S extends string> = S extends `${string}<${infer R}>${string}` ?
    ParseOptionType<R, {}> :
    S extends `${string}[${infer R}]${string}` ?
        Partial<ParseOptionType<R, {}>> :
        ParseOptionType<S, {}>
export type ArgsType<S extends string> = S extends `${infer L} ${infer R}` ?
    [ArgType<L>, ...ArgsType<R>] :
    S extends `${infer L}` ?
        [ArgType<L>] :
        []
export type OptionsType<S extends string> = S extends `${infer L} ${infer R}` ?
    OptionType<L> & OptionsType<R> :
    S extends `${infer L}` ?
        OptionType<L> :
        {}
type OptionValueType<S extends string> = OptionType<S> extends { [key: string]: infer T } ? T : never

// 定义一个Command类，用于定义指令，这个类的实例会被注册到CommandManager中
export class Command<A extends any[] = [], O = {}> {
    callbacks: Command.CallBack<object, A, O>[] = []
    checkers: Command.CallBack<object, A, O>[] = []
    public name?: string
    private aliasNames: string[] = []
    public parent:Command=null
    public children:Command[]=[]
    private sugarsConfig: Command.Sugar<A, O>[] = []
    private argsConfig: Command.ArgsConfig = []
    private optionsConfig: Command.OptionsConfig = {}

    constructor(public config: Command.Config = {}) {
    }

    option<S extends string>(option: S, initialValue?: OptionValueType<S>): Command<A, O & OptionType<S>> {
        const optionMatch = option.match(/^-(\w+) ([<[])(\.\.\.)?(\w+):(\w+)([>\]])(.*)?/) as RegExpExecArray
        if (!optionMatch) throw new Error(`option ${option} is not valid`)
        const [, shortName, required, rest, name, type, _, desc] = optionMatch
        if (this.optionsConfig[name]) throw new Error(`option ${name} is already defined`)
        this.optionsConfig[name] = {
            type: type as Command.Type,
            name: shortName,
            desc: desc.trimStart(),
            required: required === '<',
            rest: rest === '...',
            initialValue
        }
        return this as Command<A, O & OptionType<S>>
    }
    command<S extends string>(name: string, decl: S,initialValue?:ArgsType<S>): Command<ArgsType<S>> {
        const args=[initialValue,this.config].filter(Boolean)
        const command = Command.defineCommand(decl,...args as any)
        command.name = name
        command.parent=this as any
        this.children.push(command)
        return command
    }
    check<S extends object>(callback:Command.CallBack<S, A,O>): this {
        this.checkers.push(callback)
        return this
    }
    hidden(){
        this.config.hidden = true
        return this
    }
    desc(desc: string) {
        this.config.desc = desc
        return this
    }
    alias(alias: string) {
        this.aliasNames.push(alias)
        return this
    }
    /**
     * @deprecated use sugar instead
     *
     **/
    shortcut(...params:Parameters<Command['sugar']>) {
        return this.sugar.apply(this,params as any)
    }
    sugar(sugar: string | RegExp, config?: Omit<Command.Sugar<A, O>, 'regexp'>): Command<A, O> {
        this.sugarsConfig.push({
            regexp: sugar instanceof RegExp ? sugar : new RegExp(sugar),
            ...config
        })
        return this
    }
    use(middleware:(command:Command<any[],any>)=>any){
        middleware(this)
    }

    //显示帮助信息
    help({simple, showHidden, dep = 1, current = 0}: HelpOptions = {}) {
        const createArgsOutput = () => {
            const result = []
            this.argsConfig.forEach((arg) => {
                const nameDesc: string[] = []
                nameDesc.push(arg?.required ? '<' : '[')
                nameDesc.push(arg?.rest ? '...' : '')
                nameDesc.push(arg.name + ':')
                nameDesc.push(String(arg.type))
                nameDesc.push(arg.required ? '>' : ']')
                result.push(nameDesc.join(''))
            })
            return result.join(' ')
        }
        const output: string[] = [`${this.name} ${createArgsOutput()} ${this.config.desc||''}`]
        if (!simple) {
            if (this.aliasNames.length) output.push(` alias:${this.aliasNames.join(',')}`)
            if (this.sugarsConfig.length) output.push(` shortcuts:${this.sugarsConfig.map(sugar => String(sugar.regexp))}`)
            if (!isEmpty(this.optionsConfig)) {
                const options = Object.keys(this.optionsConfig)
                    .filter(name => !name.startsWith('-'))
                    .filter(name => showHidden ? true : !this.optionsConfig[name].hidden)
                if (options.length) {
                    output.push(' options:')
                    options.forEach(key => {
                        const nameDesc: string[] = []
                        const option:Command.OptionConfig = this.optionsConfig[key]
                        nameDesc.push(option?.required ? '<' : '[')
                        nameDesc.push(option?.rest ? '...' : '')
                        nameDesc.push(key + ':')
                        nameDesc.push(String(option.type))
                        nameDesc.push(option?.required ? '>' : ']')
                        output.push(`  ${option.name} ${nameDesc.join('')} ${option.desc}`)
                    })
                }
            }
        }
        if (this.children.length && dep !== current) {
            output.push(' children:')
            return output.concat(...this.children
                .filter(cmd => showHidden || !cmd.config.hidden)
                .map(children => children.help({
                    simple,
                    showHidden,
                    current: current + 1,
                    dep
                }).map(str => `${new Array((current + 1) * 2).fill(' ').join('')}${str}`)).flat())
        }
        return output
    }

    action<S extends object = object>(callback: Command.CallBack<S, A, O>) {
        this.callbacks.push(callback)
        return this as Command<A, O>
    }
    async execute<S extends object>(session: S,template=session.toString()): Promise<string | void> {
        let runtime: Command.RunTime<S, A, O> | void
        try{
            runtime=this.match(session,template)
        }catch (e){
            console.error(e)
            return e.message
        }
        if (!runtime) return
        for(const checker of runtime.command.checkers){
            const result=await checker.apply(runtime.command,[runtime as Command.RunTime<S, A, O>,...(runtime as Command.RunTime<S, A, O>).args])
            if(result) return result
        }
        for (const callback of runtime.command.callbacks) {
            const result = await callback.apply(runtime.command, [runtime as Command.RunTime<S, A, O>, ...(runtime as Command.RunTime<S, A, O>).args])
            if (result) return result
        }
    }
    addArgConfig(config:Command.ArgConfig){
        this.argsConfig.push(config)
    }

    private parseSugar(template:string) {
        const argv: Argv = {
            name: '',
            args: [],
            options: {}
        }
        for (const sugar of this.sugarsConfig) {
            const matched = sugar.regexp.exec(template)
            if (!matched) continue
            argv.name = this.name
            const {args = [], options = {}} = sugar
            for (let i = 0; i < args.length; i++) {
                const arg = args[i]
                const argConfig = this.argsConfig[i]
                if (!argConfig) break
                if (typeof arg === 'string' && arg.startsWith('$') && matched[+arg.slice(1)]) {
                    argv.args[i] = Command.transform(matched[+arg.slice(1)], argConfig.type as Command.Type)
                } else if (getType(arg) === argConfig.type) {
                    argv.args[i] = arg
                } else if (typeof arg === 'string') {
                    argv.args[i] = Command.transform(arg, argConfig.type as Command.Type)
                } else if (argConfig.rest && Array.isArray(arg) && arg.every(item => getType(item) === argConfig.type)) {
                    argv.args[i] = arg
                }
            }
            for (const option of Object.keys(options)) {
                const optionConfig = this.optionsConfig[option]
                if (!optionConfig) continue
                if (typeof options[option] === 'string' && options[option].startsWith('$') && matched[+options[option].slice(1)]) {
                    argv.options[option] = Command.transform(matched[+options[option].slice(1)], optionConfig.type as Command.Type)
                } else if (getType(options[option]) === optionConfig.type) {
                    argv.options[option] = options[option]
                } else if (typeof options[option] === 'string') {
                    argv.options[option] = Command.transform(options[option], optionConfig.type as Command.Type)
                } else if (optionConfig.rest && Array.isArray(options[option]) && options[option].every(item => getType(item) === optionConfig.type)) {
                    argv.options[option] = options[option]
                }
            }
        }
        return argv
    }

    private parseArgv(template:string) {
        const argv: Argv = {
            name: '',
            args: [],
            options: {}
        }
        const [name,...matchedArr]=Command.parseParams(template)
        if(![this.name,...this.aliasNames].includes(name)) return argv
        argv.name=this.name
        for (let i = 0; i < matchedArr.length; i++) {
            const arg = matchedArr[i]
            if (arg.startsWith('--') || arg.startsWith('—')){
                const name = arg.startsWith('--') ? arg.slice(2) : arg.slice(1)
                const option = this.optionsConfig[name]
                if (!option) throw new Error(`option ${name} is not defined`)
                if (option.rest) {
                    argv.options[name] = matchedArr.slice(i + 1).map(v => Command.transform(v, option.type as Command.Type))
                    break
                } else if(option.type==='boolean') {
                    argv.options[name] = true
                }else{
                    argv.options[name] = Command.transform(matchedArr[++i], option.type as Command.Type)
                }
            } else {
                const arg = this.argsConfig[argv.args.length]
                if (!arg) continue
                if (arg.rest) {
                    argv.args.push(matchedArr.slice(i).map(v => Command.transform(v, arg.type as Command.Type)))
                    break
                } else {
                    argv.args.push(Command.transform(matchedArr[i], arg.type as Command.Type))
                }
            }
        }
        return argv
    }

    match<S extends object>(session: S,template:string): Command.RunTime<S, A, O> | void {
        let argv = this.parseSugar(template)
        if (!argv.name) argv = this.parseArgv(template)
        if (argv.name !== this.name) {
            if (this.aliasNames.includes(argv.name)) argv.name = this.name
            else return
        }
        Command.checkArgv(argv, this.argsConfig, this.optionsConfig)
        return {
            args: argv.args as A,
            options: argv.options as O,
            command: this,
            session,
        }
    }

}

type MayBePromise<T> = T | Promise<T>
export namespace Command {
    export const transforms: Transforms = {}
    export function removeOuterQuoteOnce(str: string) {
        if (str.startsWith('"') && str.endsWith('"')) return str.slice(1, -1)
        if (str.startsWith("'") && str.endsWith("'")) return str.slice(1, -1)
        if(str.startsWith('`') && str.endsWith('`')) return str.slice(1,-1)
        return str
    }
    function joinNestedTags(args: string[]) {
        const result:string[] = []
        let merged = ''
        args.forEach(arg=>{
            if(!arg.startsWith('<') && !merged) return result.push(arg)
            if(!merged) {
                if(arg.endsWith('/>')) return result.push(arg)
                return merged = arg
            }
            if(!arg.startsWith('<')) return merged+=/<[^>]>$/.test(merged)?arg:` ${arg}`
            if(!arg.startsWith('</')) return merged+=arg
            merged+=arg
            result.push(merged)
            merged=''
        })
        return result.map(removeOuterQuoteOnce)
    }
    export function parseParams(text) {
        const regex = /(".*?"|'.*?'|`.*?`|<[^>]+?>|\S+)/g;
        const matches = text.match(regex);
        if (matches) {
            return joinNestedTags(matches.reduce((result, match) => {
                if(/<\/\S+>/.test(match)) {
                    const [start,end] = match.split('</')
                    result.push(start,`</${end}`)
                }else{
                    result.push(match)
                }
                return result
            }, []));
        }
        return [];
    }
    export interface Config {
        hidden?:boolean
        desc?: string
    }

    type WithRegIndex<T> = T extends Array<infer R> ? WithRegIndex<R>[] : T | `$${number}`
    type MapArrWithString<T> = T extends [infer L, ...infer R] ? [WithRegIndex<L>?, ...MapArrWithString<R>] : T
    export type Sugar<A = any[], O = {}> = {
        regexp: RegExp
        args?: MapArrWithString<A>
        options?: {
            [P in keyof O]?: WithRegIndex<O[P]>
        }
    }

    export type RunTime<S extends object, A extends any[] = [], O = {}> = {
        args: A,
        options: O,
        session: S,
        command: Command<A, O>
    }
    export type ArgConfig<S extends string = any> = {
        name: S extends `${'<' | '['}${infer L}:${string}${'>' | ']'}` ? L extends `...${infer K}` ? K : L : string,
        type: S extends `${'<' | '['}${string}:${infer R}${'>' | ']'}` ? R extends Type ? R : string : string,
        required: S extends `<${string}>` ? true : false,
        rest: S extends `${'<' | '['}...${string}${'>' | ']'}` ? true : false
        initialValue?: S extends `${'<' | '['}${string}:${infer R}=${infer D}${'>' | ']'}` ? R extends Type ? Command.Domain[R] : D : string
    }
    export type ArgsConfig = ArgConfig[]
    type PartialArray<T extends any[]> = T extends [infer L, ...infer R] ? [L?, ...PartialArray<R>] : []
    export type OptionConfig<S = string> = {
        type: S extends `${'<' | '['}${string}:${infer R}${'>' | ']'}` ? R extends Type ? R : string : string,
        required: S extends `<${string}>` ? true : false,
        rest: S extends `${'<' | '['}...${string}${'>' | ']'}` ? true : false
        name: string,
        desc: string,
        initialValue?: S extends `${'<' | '['}${string}:${infer R}=${infer D}${'>' | ']'}` ? R extends Type ? [R] : D : string
    }
    export type OptionsConfig<S extends string = any> = S extends `${infer L} ${infer R}` ? L extends `${'<' | '['}${infer K}:${string}${'>' | ']'}` ? {
        [key in K extends `...${infer KR}` ? KR : L]: OptionConfig<L>
    } & OptionsConfig<R> : {
        [key: string]: OptionConfig<L>
    } & OptionsConfig<R> : {}
    export type CallBack<Session extends object, A extends any[] = [], O = {}> = (runtime: RunTime<Session, A, O>, ...args: A) => MayBePromise<string | void>

    export interface Domain {
        string: string
        number: number
        boolean: boolean
        regexp: RegExp
        date: Date
    }

    export type Type = keyof Domain
    export type Transform<T extends Type> = (source: string) => Domain[T]
    export type Transforms = {
        [K in Type]?: Transform<K>
    }

    export function checkArgv(argv: Argv, argsConfig: ArgConfig[], optionsConfig: OptionsConfig) {
        for (let i = 0; i < argsConfig.length; i++) {
            const arg = argv.args[i]
            const argConfig = argsConfig[i]
            if (!arg && argConfig.required) {
                if (argConfig.initialValue !== undefined) argv.args[i] = argConfig.initialValue
                else throw new Error(`arg ${argConfig.name} is required`)
            }
            if (arg && argConfig.type && getType(arg) !== argConfig.type) {
                if (argConfig.rest && Array.isArray(arg) && arg.every(v => getType(v) === argConfig.type)) continue
                throw new Error(`arg ${argConfig.name} should be ${argConfig.type}`)
            }
        }
        for (const option in optionsConfig) {
            const optionConfig = optionsConfig[option]
            if (optionConfig.required && !argv.options[option]) {
                if (optionConfig.initialValue !== undefined) argv.options[option] = optionConfig.initialValue
                else throw new Error(`option ${option} is required`)
            }
            if (argv.options[option] && optionConfig.type && getType(argv.options[option]) !== optionConfig.type) {
                if (optionConfig.rest && Array.isArray(argv.options[option]) && (argv.options[option] as any[]).every(v => getType(v) === optionConfig.type)) continue
                throw new Error(`option ${option} should be ${optionConfig.type}`)
            }
        }
    }
    export type Declare=`${string} ${string}`|string
    export function transform<T extends Type>(source: string, type: T): Domain[T] {
        const transform = transforms[type]
        if (!transform) throw new Error(`type ${type} is not defined`)
        return transform(source)
    }

    export function registerDomain<T extends Type>(type: T, transform: Transform<T>) {
        transforms[type] = transform as any
    }

    export function defineCommand<S extends string>(decl: S, initialValue?: ArgsType<S>): Command<ArgsType<S>>
    export function defineCommand<S extends string>(decl: S, config?: Command.Config): Command<ArgsType<S>>
    export function defineCommand<S extends string>(decl: S, initialValue?: ArgsType<S>, config?: Command.Config): Command<ArgsType<S>>
    export function defineCommand<S extends string>(decl: S, ...args: (ArgsType<S> | Command.Config)[]): Command<ArgsType<S>> {
        const initialValue: ArgsType<S> | undefined = Array.isArray(args[0]) ? undefined : args.shift() as ArgsType<S>
        const command = new Command<ArgsType<S>>(...args as [Config?])
        const argDeclArr = decl.split(' ').filter(Boolean)
        for (let i = 0; i < argDeclArr.length; i++) {
            const argDecl = argDeclArr[i]
            const argMatch = argDecl.match(/^([<[])(\.\.\.)?(\w+):(\w+)([>\]])$/) as RegExpExecArray
            if (!argMatch) throw new Error(`arg ${argDecl} is not valid`)
            const [, required, rest, name, type] = argMatch
            command.addArgConfig({
                name,
                type: type as Command.Type,
                required: required === '<',
                rest: rest === '...',
                initialValue: initialValue && initialValue[i]
            })
        }
        return command
    }

    registerDomain('string', (source) => source)
    registerDomain('number', (source) => +source)
    registerDomain('boolean', (source) => source !== 'false')
    registerDomain('date', (source) => new Date(source))
    registerDomain('regexp', (source) => new RegExp(source))
}
