# 事件地图

- 知音底层基于EventEmitter驱动，因此支持所有EventEmitter的事件，同时也支持自定义事件。

- 事件地图如下：
- [Zhin](#session)
- [Adapter](#adapter)
- [Bot](#bot)

## Zhin

| 事件名            | 说明                                                  | 参数         |
|:---------------|:----------------------------------------------------|:-----------|
| message        | 消息事件                                                | Session    |
| before-message | 触发消息事件之前触发                                          | Session    |
| message.send | 消息发送成功后触发                                           | MessageRet |
| before-start   | 在before-ready之前触发                                   | void       |
| before-ready   | 在ready之前触发                                          | void       |
| ready          | 机器人准备就绪                                             | void       |
| after-ready    | 在ready之后触发                                          | void       |
| start          | 机器人开始运行                                             | void       |
| after-start    | 在start之后触发                                          | void       |
| command-add    | 添加指令时触发                                             | Command    |
| command-remove | 移除指令时触发                                             | Command    |
| plugin-add     | 添加插件时触发                                             | Plugin     |
| plugin-remove  | 移除插件时触发                                             | Plugin     |
| service-add    | 添加服务时触发                                             | Service    |
| service-remove | 移除服务时触发                                             | Service    |
| \[protocol\].\[event\] | 协议事件，例如适配器`icqq`的事件`notice.group.increase`，则为`icqq.notice.group.increase` | Session |

## Adapter

| 事件名             | 说明      | 参数         |
|:----------------|:--------|:-----------|
| message.receive | 收到消息    | Session    |
| message.send    | 发送消息    | MessageRet |
| bot.online      | 某个机器人上线 | Bot        |
| bot.offline     | 某个机器人下线 | Bot        |
| bot.error       | 机器人出错   | Bot        |

## Bot【Icqq适配器】
- 参见[Icqq事件地图](https://icqqjs.github.io/icqq/docs/interfaces/EventMap.html)


