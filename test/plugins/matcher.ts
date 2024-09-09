export class Matcher<A = [], O = {}> {
  #args_config: Matcher.ArgConfig[] = [];
  #alias:string[]=[]
  #options_config: Record<string, Matcher.OptionConfig> = {};
  constructor(
    public name: string,
    args_config: Matcher.ArgConfig[],
  ) {
    this.#args_config = args_config;
  }
  alias(...name:string[]){
    this.#alias.push(...name)
    return this
  }
  get #nameMatcher(){
    return new RegExp([this.name,...this.#alias].join('|'))
  }
  get argsMatcher() {
    return new RegExp(
      this.#args_config
        .map(arg_config => {
          return `(${Matcher.typeRegs[arg_config.type]}${arg_config.required || '?'})`;
        })
        .join('s'),
    'g');
  }
  optionMatcher(key:string) {
    const { short_name, type } = this.#options_config[key];
    return new RegExp(`(-${short_name} ${Matcher.typeRegs[type]})|(--${key} ${Matcher.typeRegs[type]}?)`);
  }
  #matchOptions(message:string){
    const options=[]
    for(let key in this.#options_config){
      const reg=this.optionMatcher(key)
      const matches=message.match(reg)
      if(matches){
        const option=matches[0]
        options.push(option)
        message=message.replace(option,'')
      }
    }
    return [options,message]
  }
  async match(message: string): Promise<{ args: A; options: O } | undefined> {
    const nameMatcher=this.#nameMatcher
    if (!nameMatcher.test(message)) return;
    message=message.replace(nameMatcher,'').trimStart()
    const [options,newMessage]=this.#matchOptions(message)
    console.log(options,newMessage)
    return {
      args: [] as A,
      options: {} as O,
    };
  }
  option<N extends string, T extends string>(name: N, decl: T): Matcher<A, O & Matcher.OptionType<N, T>> {
    let declaration: string = decl;
    const short_name = declaration.split(' ')[0]?.slice(1);
    declaration = declaration.replace(`-${short_name}`, '').trimStart();
    let type: Matcher.Type = declaration.replace(/\[(\S+)]/, (_, value) => value) as Matcher.Type;
    if (!type) type = short_name ? 'boolean' : 'unknown';
    declaration = declaration.replace(`[${type}]`, '').trimStart();
    this.#options_config[name] = {
      type,
      short_name,
      desc: declaration,
    };
    return this as Matcher<A, O & Matcher.OptionType<N, T>>;
  }
}
export namespace Matcher {
  export type Types = {
    number: number;
    string: string;
    boolean: boolean;
    any: any;
    unknown: unknown;
  };
  type TypeRegs = {
    [P in Type]: string;
  };
  export const typeRegs: TypeRegs = {
    number: '\\d+',
    string: '\\S+',
    boolean: 'true|false',
    any: '\\.+',
    unknown: '\\.+',
  };
  export type Type = keyof Types;
  export type TypeDecl = `<${Type}>` | `<${Type}[]>` | `[${Type}]` | `[${Type}[]]`;
  export type ArgsType<T extends unknown[]> = T extends [`<${infer L}>`, ...infer R]
    ? [ArgType<L>, ...ArgsType<R>]
    : T extends [`[${infer L}]`, ...infer R]
    ? [ArgType<L>?, ...ArgsType<R>]
    : [];
  export type ArgType<T> = T extends Type ? Types[T] : T extends `${infer R}[]` ? ArgType<R>[] : unknown;
  export type OptionType<N extends string, T extends string> = T extends `-${infer L} [${infer M}]${infer R}`
    ? {
        [P in N | L]?: ArgType<M>;
      }
    : T extends `-${infer L}${infer R}`
    ? {
        [P in N | L]?: boolean;
      }
    : {
        [P in N]?: unknown;
      };
  export interface ArgConfig {
    type: Type;
    required: boolean;
  }
  export interface OptionConfig {
    type: Type;
    desc?: string;
    short_name?: string;
  }
  export type Resolver<T extends Type = Type> = (type: T, value?: string) => Types[T];
  export const resolverMap: Map<Type, Resolver> = new Map<Type, Resolver>();
  resolverMap.set('string', s => s || '');
  resolverMap.set('boolean', s => Boolean(s));
  resolverMap.set('number', s => +s || 0);
  resolverMap.set('any', s => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  });
  resolverMap.set('unknown', s => {
    return;
  });
  export function create<T extends TypeDecl[]>(name: string, ...arg_type: T): Matcher<ArgsType<T>> {
    const args_config: Matcher.ArgConfig[] = arg_type.map(argType => {
      const type = argType.slice(1, argType.includes('[]') ? -3 : -1) as Type;
      return {
        type,
        required: argType.startsWith('<'),
      };
    });
    return new Matcher<ArgsType<T>>(name, args_config);
  }
}
(async () => {
  const matcher = Matcher.create('test', '<string[]>', '[number]', '[boolean]')
    .option('abc', '-a [number]')
    .option('foo', '-f');
  console.log(matcher);
  const res = await matcher.match('test a -a 1 -f true');
})();
