# 上下文(Context)

::: tip 继承自 EventEmitter :::

## 属性(Attrs)

### plugins:Map<string,Plugin>

- **当前**上下文安装的插件Map

### middlewares:Middleware[]

- **当前**上下文产生的所有中间件

### components:Record<string,Component>

- **当前**上下文产生的组件键值对

### commands:Map<string,Command>

- **当前**上下文产生的指令Map

### disposes:Dispose[]

- 卸载**当前**上下文时，需要执行的函数列表

### get pluginList:Plugin[]

- 获取**当前**上下文及**其下级**上下文安装的插件列表

### get middlewareList:Middleware[]

- 获取**当前**上下文及**其下级**上下文产生的的中间件列表

### get commandList:Command[]

- 获取**当前**上下文及**其下级**上下文产生的的指令列表

### [Context.childKey]:Context[]

- **当前**上下文产生的**子**上下文列表

### [Context.plugin]:Plugin

- 产生**当前**上下文的插件

### [keyof Zhin.Services]:Service

- 知音安装的服务

## 构造函数 constructor(public parent:Context,filter?:Filter)

## 方法(Methods)

### extend(ctx:Context):Context

- 将**其他**上下文继承到**当前**上下文

### pick(key: K, ...values: Session[K][]):Context

- 产生一个新的上下文，该上下文仅在传入会话`session[key]`的值存在于`values`中并且
  满足构造函数的filter时有效

### union(filter:Filter):Context

- 产生一个新的上下文，该上下文仅在满足传入filter并且满足构造函数的filter时有效

### except(filter:Filter):Context

- 产生一个新的上下文，该上下文仅在不满足传入filter并且满足构造函数的filter时有效

### user(...user_ids:(string|number)[]):Context

- 产生一个新的上下文，该上下文传入会话`session.user_id`的值存在于`user_ids`中并
  且满足构造函数的filter时有效

### group(...group_ids:(string|number)[]):Context

- 产生一个新的上下文，该上下文传入会话`session.group_id`的值存在于`group_ids`中
  并且满足构造函数的filter时有效

### discuss(...discuss_ids:(string|number)[]):Context

- 产生一个新的上下文，该上下文传入会话`session.discuss_id`的值存在
  于`discuss_ids`中并且满足构造函数的filter时有效

### guild(...guild_ids:string[]):Context

- 产生一个新的上下文，该上下文传入会话`session.guild_id`的值存在于`guild_ids`中
  并且满足构造函数的filter时有效

### channel(...channel_ids:string[]):Context

- 产生一个新的上下文，该上下文传入会话`session.channel_id`的值存在
  于`channel_ids`中并且满足构造函数的filter时有效

### platform(...platforms:(keyof Zhin.Adapters)[]):Context

- 产生一个新的上下文，该上下文传入会话`session.platform`的值存在于`platforms`中
  并且满足构造函数的filter时有效

### private(...user_ids:(string|number)[]):Context

- 产生一个新的上下文，该上下文传入会话`session.user_id`的值存在于`user_ids`中并
  且会话事件为私聊并且满足构造函数的filter时有效

### getMatchedContextList(session:Session):Context[]

- 根据传入会话获取匹配到的上下文列表

### plugin(entry:string:Plugin.Install,setup?:boolean):this|Plugin

- 传入string时，若当前上下文已安装name为entry的插件，则返回插件，否则，将尝试从
  已加载的模块中加载插件
- 传入Plugin.Install时，将在当前上下文安装对应插件

### use(plugin:Plugin):this

- 根据Plugin.Install在当前上下文安装对应插件

### middleware（middleware:Middleware):this

- 为当前上下文添加一个中间件

### command（def:string,initial?:string):Command
### command（def:string,config?:Command.Config):Command
### command（def:string,initial?:string,config?:Command.Config):Command

- 为当前上下文添加一个指令，并返回指令本身

### dispatch（session:Session):void

- 如果session满足当前上下文的filter，则将session继续想下分发

### sendMsg（channel: Context.MsgChannel, msg: Element.Fragment):MessageRet

- 发送一条消息给指定类型的用户

### broadcast(channelIds: ChannelId | ChannelId[], content: Element.Fragment):Promise<MessageRet[]>

- 广播一条消息给指定类型的用户

## 命名空间(Namespace)

```typescript
export namespace Context {
  export const plugin = Symbol("plugin");
  export const childKey = Symbol("children");
  export type MsgChannel = {
    protocol: keyof Zhin.Adapters;
    bot_id: string | number;
    target_id: string | number;
    target_type: "private" | "group" | "discuss" | "guild";
  };

  export function from(parent: Context, filter: Filter) {
    const ctx = new Context(parent, filter);
    ctx[plugin] = parent ? parent[plugin] : null;
    return ctx;
  }

  export type Filter = (session: Session) => boolean;
  export const defaultFilter: Filter = () => true;
  export const or = (ctx: Context, filter: Filter) => {
    return ((session: Session) => ctx.filter(session) || filter(session)) as Filter;
  };
  export const not = (ctx: Context, filter: Filter) => {
    return ((session: Session) => ctx.filter(session) && !filter(session)) as Filter;
  };
  export const and = (ctx: Context, filter: Filter) => {
    return ((session: Session) => ctx.filter(session) && filter(session)) as Filter;
  };
}
```
