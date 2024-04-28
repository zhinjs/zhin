import { Dict, axios, Plugin, compiler } from 'zhin';
import { Component } from '@/component';

declare module 'zhin' {
  namespace App {
    interface Services {
      component: typeof Component.define;
      components: typeof Component.components;
    }
  }
}
const sandbox = new Plugin('沙箱环境');
sandbox.service('components', Component.components);
sandbox.service('component', Component.define);
const disposeArr: Function[] = [];
const createContext = (runtime: Dict = {}, parent: Component.Context, $root: string): Component.Context => {
  return {
    $slots: {},
    ...runtime,
    $message: parent.$message,
    $root,
    parent,
    render: (template: string, context) => {
      return renderWithRuntime(template, context, context.$root);
    },
  };
};
const renderWithRuntime = async (template: string, runtime: Dict, $root: string) => {
  const ctx = createContext(runtime, runtime as Component.Context, $root);
  template = compiler(template, runtime);
  for (const [name, comp] of sandbox.components) {
    const match = comp.match(template);
    if (!match) continue;
    return await comp.render(match, ctx);
  }
  return template;
};
sandbox.mounted(() => {
  const dispose = sandbox.app!.registerRender(async (template, $message) => {
    return await renderWithRuntime(template, { $message }, template);
  });
  disposeArr.push(dispose);
});
sandbox.mounted(() => {
  sandbox.component({
    name: 'template',
    render(props, context) {
      const keys = Object.keys(props);
      if (!keys.length) keys.push('#default');
      for (const key of Object.keys(props)) {
        if (key.startsWith('#')) {
          context.parent.$slots[key.slice(1)] = async p => {
            return await context.render(context.children || '', { ...context, ...p });
          };
        }
      }
      return '';
    },
  });
  sandbox.component({
    name: 'slot',
    props: {
      name: String,
    },
    render({ name, ...props }, context) {
      name = name || 'default';
      if (!context.parent) return '';
      if (context.parent.$slots[name]) return context.parent.$slots[name](props, context) as string;
      return context.children || '';
    },
  });
  sandbox.component({
    name: 'request',
    props: {
      method: {
        type: String,
        default: 'get',
      },
      url: String,
      config: {
        type: Object,
        default() {
          return {};
        },
      },
    },
    async render(props, context) {
      if (!props.url) throw new SyntaxError('url is required');
      const result = await axios.default(props.url, {
        method: props.method,
        ...props.config,
      });
      return context.render(context.children || '', {
        ...context,
        result: result.data,
      } as Component.Context<{ result: axios.AxiosResponse }>);
    },
  });
});
sandbox.component({
  name: 'eval',
  async render(props, context) {
    if (!context.children) return '';
    const result = await renderWithRuntime(context.children, {}, context.$root);
    const commands = sandbox.app!.getSupportCommands(context.$message.adapter, context.$message.bot, context.$message);
    for (const command of commands) {
      const res = await command.execute(context.$message.adapter, context.$message.bot, context.$message, result);
      if (res) return res;
    }
    return result;
  },
});
sandbox.beforeMount(() => {
  while (disposeArr.length) {
    disposeArr.shift()?.();
  }
});
export default sandbox;
