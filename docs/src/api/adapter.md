# 适配器(Adapter)

::: tip 继承自 EventEmitter

此处介绍仅为基础介绍，已足够普通开发这使用，如需进阶(自行开发机器人适配器)，可联
系开发者 :::

## 属性(Attrs)

### bots:BotList

- 存放机器人的数组

### logger:Logger

- Log4js的Logger，使用方法自行搜索`log4js`

### status:Record<string,BotStatus>

获取该适配器下所有机器人的状态

## 构造函数 constructor(zhin:Zhin,protocol:string,options:AdapterOptions)

## 方法(Methods)

### botStatus(self_id:string|number):BotStatus

获取该适配器下指定机器人的状态

### getLogger(sub_type:string):Logger

获取一个Log4js的Logger，使用方法自行搜索`log4js`

### dispatch(event:string|symbol,session:Session):void

向`Zhin`推送[会话](/api/session)

### start

启动适配器

### stop

停止适配器

### startBot(options:[BotOptions](/api/bot#options)):void

启动一个机器人

## 配置文件 AdapterOptions

```typescript
export type AdapterOptions<BO = {}, AO = {}> = {
  bots?: BotOptions<BO>[]; // 机器人配置文件数组
} & AO;
```

## 命名空间(Namespace)

```typescript
export const adapterConstructs: AdapterConstructs = {};
// 用于定义适配器，普通开发者可忽略
export function define<K extends keyof Zhin.Adapters, BO = {}, AO = {}>(
  key: K,
  protocolConstruct: AdapterConstruct<K, BO, AO>,
  botConstruct: BotConstruct<K, BO, AO>,
) {
  adapterConstructs[key] = protocolConstruct;
  Bot.define(key, botConstruct);
}
// 适配器模块的类型声明，普通开发者可忽略
export interface Install<T = any> {
  install(ctx: Context, config?: T);
}
export interface BotStatus {
  start_time: number;
  lost_times: number;
  recv_msg_cnt: number;
  sent_msg_cnt: number;
  msg_cnt_per_min: number;
  online: boolean;
}
// 获取指定平台的适配器
export function get<K extends keyof Zhin.Adapters>(protocol: K) {
  return {
    Adapter: adapterConstructs[protocol],
    Bot: Bot.botConstructors[protocol],
  };
}
```
