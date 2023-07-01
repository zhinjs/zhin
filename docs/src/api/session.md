# 会话
在zhin中，机器人发出的任何事件，都会被封装为一个统一格式的会话对象，开发者可以通过访问会话对象的属性，来获取对应事件产生的信息。

下面是会话中的一些常用属性及其类型：

```typescript
interface Session<P extends keyof Zhin.Adapters = keyof Zhin.Adapters, E extends keyof Zhin.BotEventMaps[P] = keyof Zhin.BotEventMaps[P]> {
    protocol: P, // 所使用的适配器
    type?: string // 事件类型
    user_id?: string | number // 用户id
    user_name?: string // 用户名
    group_id?: string | number // 群组id 仅在detail_type为group时存在
    group_name?: string // 群组名 仅在detail_type为group时存在
    discuss_id?: string | number // 讨论组id 仅在detail_type为discuss时存在
    discuss_name?: string // 讨论组名 仅在detail_type为discuss时存在
    channel_id?: string // 频道id 仅在detail_type为guild时存在
    channel_name?: string // 频道名 仅在detail_type为guild时存在
    guild_id?: string // 服务器id 仅在detail_type为guild时存在
    guild_name?: string // 服务器名 仅在detail_type为guild时存在
    detail_type?: string // 事件详细类型
    zhin: Zhin // 当前zhin实例
    context: Context // 当前上下文
    adapter: Zhin.Adapters[P] // 当前适配器实例
    prompt: Prompt // 当前会话的提示输入器
    content:string // 消息内容
    bot: Zhin.Bots[P] // 当前机器人实例
    event: E // 事件完整名
    quote?: QuoteMessage // 引用消息
    message_id?: string // 消息id 仅在type为message时存在
}
```
除此以外，你还可以访问到会话的一些方法和getter，通过这些方法和getter，你可以获取到更多的信息，或者对会话进行一些操作。

```typescript
import {Bot} from "./bot";
interface Session {
    middleware(middleware: Middleware): void // 在当前会话上添加一个中间件
    reply(element: Element.Fragment): Promise<Bot.MessageRet> // 回复当前会话
    intercept(tip: Element.Fragment, runFunc: (session: NSession<keyof Zhin.Adapters>) => Element.Fragment | void, free: Element.Fragment | ((session: NSession<keyof Zhin.Adapters>) => boolean), filter?: (session: NSession<keyof Zhin.Adapters>) => boolean):void // 拦截当前会话
    get isMaster(): boolean // 当前会话发起者是否为主人
    get isAdmins(): boolean // 当前会话发起者是否为zhin管理员
    get isOwner(): boolean // 当前会话发起者是否为群主
    get isAdmin(): boolean // 当前会话发起者是否为群组管理
    get isAtme(): boolean // 当前会话是否at了机器人
    get isPrivate(): boolean // 当前会话是否为私聊
    get isGroup(): boolean // 当前会话是否为群聊
}
```
