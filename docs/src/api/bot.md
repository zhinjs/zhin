# 机器人(Bot)
::: tip
继承自 EventEmitter

此处介绍仅为基础介绍，已足够普通开发这使用，如需进阶(自行开发机器人适配器)，可联系开发者
:::
## 属性(Attrs)
### internal
- 不同平台的机器人实例
### get status():BotStatus
- 机器人状态
### options:BotOptions
- 机器人配置
### self_id:string}number
- 机器人唯一标识
## 构造函数 constructor(public zhin:Zhin,public adapter:Adapter,options:BotOptions)
## 方法(Methods)
### isOnline():boolean
- 获取机器人是否在线状态
### enable(plugin?:Plugin):this|boolean
- 传plugin时，代表该机器人启用指定插件(默认会启用所有插件)
- 不传任何参数时，代表启用该机器人
### disable(plugin:Plugin):this:boolean
- 传plugin时，代表该机器人禁用指定插件
- 不传任何参数时，代表禁用该机器人
### match(plugin:Plugin):boolean
- 判断当前机器人是否启用指定插件
### isMaster(session:Session):boolean
- 会话发起者是否为zhin主人
### isAdmin(session:Session):boolean
- 会话发起者是否为zhin管理员

### reply(session:Session,message:Fragment,quote?:boolean):MessageRet
- 回复一个指定会话一条消息(quote为true会引用该会话)
### sendMsg(target_id:string:number,target_type:MessageType,message:Fragment):MessageRet
- 发送一条消息给指定类型的用户
- MessageType可为`gorup`、`private`、`discuss`(仅qq支持)、`guild`
### start
启动机器人
## 配置文件 BotOptions
```typescript

export type BotOptions<O={}>={
    quote_self?:boolean // 回复消息是否自动引用
    self_id?:string|number // 机器人唯一标识
    prefix?:string // 指令调用时的前缀
    enable?:boolean // 机器人是否启用
    master?:string|number // 机器人主人账号
    disable_plugins?:string[] // 禁言的插件名称数组
    admins?:(string|number)[] // 管理员账号数组
} & O
```
## 命名空间(Namespace)
```typescript

export namespace Bot{
     // 默认配置文件
    export const defaultOptions:BotOptions={
        quote_self:false,
        enable:true,
        disable_plugins:[],
        admins:[]
    }
    interface MsgBase{
        user_id:string|number
        elements:Element[]
    }
    export interface GroupMsg extends MsgBase{
        group_id:string|number
    }
    export interface PrivateMsg extends MsgBase{}
    export interface GuildMsg extends MsgBase{
        guild_id:string|number
        channel_id:string|number
    }
    export type Message=PrivateMsg|GroupMsg|GuildMsg
}
```