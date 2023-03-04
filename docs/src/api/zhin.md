# 知音(Zhin)

::: tip
继承自 [Context](/api/context)
:::

## 属性(Attrs)
### isReady:boolean
- 标识zhin是否启动
### options:Zhin.Options(见命名空间)
- zhin的配置文件
### adapters:Map<string,[Adapter](/api/adapter)>
- zhin加载的适配器Map
### services:Map<string,[Service](api/service)>
- zhin加载的服务Map
## 方法(Methods)
### changeOptions(options:Zhin.Options):void
- 更改知音的配置文件
### pickBot(protocol:string,self_id:string|number):[Bot](/api/bot)|undefined
- 根据条件选取一个已存在的机器人
### getLogger(protocol:string,self_id:string|number):Logger
- 获取logger
### getInstalledModules(moduleType:string):Modules[]
- 扫描项目依赖中的已安装的模块
### hasInstall(name:string):boolean
- 检查知音是否安装指定插件
### sendMsg(channelId: ChannelId, message: Fragment):MessageRet
- 发送消息到指定通道
### load(name: string, moduleType: T,setup?:boolean):Zhin.Modules[T]
- 加载指定名称，指定类型的模块
### findCommand(argv:Argv):[Command](/api/command)
- 获取匹配出来的指令
### start
- 启动知音
### stop
- 停止知音
## 命名空间(Namespace)
```typescript
export interface Options {
    self_url?: string // 公网访问url，可不填
    port: number // 监听端口
    log_level: LogLevel // 日志输出等级
    logConfig?: Partial<Configuration> // Configuration请自行参阅log4js
    delay: Record<string, number> // 超时时间
    plugins?: Record<string, any> // 规定用来存放不同插件的配置
    services?: Record<string, any> // 规定用来存放不同服务的配置
    adapters?: Record<string, any> // 规定用来存放不同适配器的配置
    plugin_dir?: string // 存放插件的目录路径
    data_dir?: string // 存放数据的目录路径
}
```