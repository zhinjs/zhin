import { Dict, Message, getValueWithRuntime } from 'zhin';
import { fixLoop } from '@/utils';
export const CapWithChild = Symbol('CapWithChild');
export const CapWithClose = Symbol('CapWithClose');
export class Component<T = {}, D = {}, P = Component.Props<T>> {
  [CapWithClose]: RegExp;
  [CapWithChild]: RegExp;
  $props: Component.PropConfig[] = [];

  constructor(private $options: Component.Options<T, D, P>) {
    this.formatProps();
    this[CapWithChild] = new RegExp(`<${$options.name}([^>]*)?>([^<])*?</${$options.name}>`);
    this[CapWithClose] = new RegExp(`<${$options.name}([^>]*)?/>`);
  }
  isClosing(template: string) {
    return this[CapWithClose].test(template);
  }
  match(template: string) {
    let [match] = this[CapWithChild].exec(template) || [];
    if (match) return match;
    [match] = this[CapWithClose].exec(template) || [];
    return match;
  }
  private formatProps() {
    for (const [key, value] of Object.entries(this.$options.props || {})) {
      this.formatProp(key, value as any);
    }
  }

  private formatProp(name: string, value: Exclude<Component.PropConfig, 'name'> | Component.TypeConstruct) {
    if (typeof value === 'function') {
      return this.$props.push({
        name,
        type: value,
        default: undefined,
      });
    }
    return this.$props.push({
      name,
      type: value.type,
      default: value.default,
    });
  }

  parseProps(template: string) {
    const result = Object.fromEntries(
      this.$props.map(prop => {
        const generateDefault = typeof prop.default === 'function' ? prop.default : () => prop.default;
        return [prop.name, generateDefault()];
      }),
    );
    const matchedArr = [...template.matchAll(/([a-zA-Z\-:]+)\s*=\s*(['"])(.*?)\2/g)].filter(Boolean);
    if (!matchedArr.length) return result;
    for (const [_, key, __, value] of matchedArr) {
      Object.defineProperty(result, key, {
        enumerable: true,
        writable: false,
        value,
      });
    }
    return result;
  }
  parseChildren(template: string): string {
    if (this.isClosing(template)) return '';
    const matched = template.match(/<[^>]+>([^<]*?)<\/[^?]+>/);
    if (!matched) return '';
    return matched[1];
  }
  async render(template: string, context: Component.Context): Promise<string> {
    const props = this.parseProps(template);
    const assignValue = () => {
      for (const key of keys) {
        if (!key.startsWith(':')) continue;
        Object.defineProperty(props, key.slice(1), {
          value: getValueWithRuntime(Reflect.get(props, key), context.parent),
        });
        Reflect.deleteProperty(props, key);
      }
    };
    const keys = Object.keys(props).map(key => {
      const newKey = key.replace(/(\w)+-(\w)/g, function (_, char, later) {
        return `${char}${later.toUpperCase()}`;
      });
      if (key !== newKey) {
        Object.defineProperty(props, newKey, {
          value: Reflect.get(props, key),
          enumerable: true,
        });
        Reflect.deleteProperty(props, key);
      }
      return newKey;
    });
    assignValue();
    const data = this.$options.data ? this.$options.data.apply(props as P) : ({} as D);
    for (const key of keys) {
      if (key === 'vFor') {
        const { 'vFor': expression, 'v-for': _, ...rest } = props as any;
        const { name, value, ...other } = fixLoop(expression);
        const list = value === '__loop__' ? other[value] : getValueWithRuntime(value, context);
        const fnStr = `
                const result=[];\n
                for(const ${name} of list){\n
                  result.push(render(props,{\n
                    ...context,\n
                    children:'',\n
                    $origin:'${template.replace(/'/g, "'")}',
                    parent:{\n
                      ...context.parent,\n
                      ${name}:list[${name}]
                    }\n
                  }))\n
                }
                return result;`;
        const fn = new Function('render,list,props,context', fnStr);
        const newTpl = template
          .replace(`v-for="${expression}"`, '')
          .replace(`v-for='${expression}'`, '')
          .replace(`vFor="${expression}"`, '')
          .replace(`vFor='${expression}'`, '');
        return (await Promise.all(fn(this.render.bind(this), list, newTpl, context))).join('');
      }
      if (key === 'vIf') {
        const needRender = getValueWithRuntime(Reflect.get(props as object, 'vIf'), context);
        if (!needRender) return '';
      }
    }
    context.children = this.parseChildren(template) || context.children;
    const ctx = {
      $slots: context.$slots || {},
      ...props,
      ...data,
      $message: context.$message,
      render: context.render,
      parent: context,
      children: context.children,
    } as Component.Context<D & P>;
    const result = await this.$options.render(props as P, ctx);
    context.$root = context.$root.replace(context.$origin || template, result);
    return context.render(context.$root, context);
  }
}

export namespace Component {
  export type TypeConstruct<T = any> = {
    new (): T;
    readonly prototype: T;
  };
  export type PropConfig<T extends TypeConstruct = TypeConstruct> = {
    name: string;
    type: T;
    default: Prop<T>;
  };

  export interface Options<T, D, P = Props<T>> {
    name: string;
    props?: T;
    data?: (this: P) => D;
    render: Render<P, D>;
  }

  export type Context<T = {}> = {
    $slots: Dict<Render<any, any>>;
    $message: Message;
    $origin?: string;
    $root: string;
    parent: Context;
    render(template: string, context: Context): Promise<string>;
    children?: string;
  } & T;
  export type Render<P = {}, D = {}> = (props: P, context: Context<P & D>) => Promise<string> | string;
  export type Props<T> = {
    [P in keyof T]: Prop<T[P]>;
  };
  export type PropWithDefault<T> = {
    type: T;
    default?: DefaultValue<T>;
  };
  type DefaultValue<T> = T extends ObjectConstructor | ArrayConstructor ? () => Prop<T> : Prop<T>;
  export type Prop<T> = T extends BooleanConstructor
    ? boolean
    : T extends StringConstructor
    ? string
    : T extends NumberConstructor
    ? number
    : T extends ArrayConstructor
    ? any[]
    : T extends ObjectConstructor
    ? Dict
    : T extends PropWithDefault<infer R>
    ? Prop<R>
    : unknown;
  export const components: Map<string, Component> = new Map<string, Component>();

  export function define<P>(render: Render<P, {}>, name?: string): Component<{}, {}, P>;
  export function define<T, D = {}, P = Props<T>>(options: Options<T, D>): Component<T, D, P>;
  export function define<T = {}, D = {}, P = Props<T>>(options: Options<T, D, P> | Render<P, D>, name = options.name) {
    if (typeof options === 'function')
      options = {
        name,
        render: options,
      };
    const component = new Component(options);
    components.set(options.name, component as unknown as Component);
    return component;
  }
}
