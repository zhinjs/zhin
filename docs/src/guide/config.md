::: tip
阅读本节前，请确认你已根据[试试水](/guide/start)初始化完成你的项目
:::

# 了解配置

- 上一节中，我们往配置文件中增加第一个机器人账号，但里面还有很多字段，都是代表什么呢？接下来，我们开始熟悉 Zhin 的配置
- 其中大致可分为适配器配置(`adapters`) 、插件配置(`plugins`)以及通用配置
- 打开配置文件 `zhin.yaml` ,内容如下（对应作用已通过注释声明）

```yaml
adapters:
  icqq: # 指定使用icqq适配器
    bots:
      - uin: 147258369 # 机器人账号 //
        platform: 5 # 指定qq登录平台为iPad（可不配置  1：安卓  2：安卓平板  3：手表  4：苹果电脑  5：苹果平板
        password: "你的机器人密码" # 账号密码(不配置则使用扫码登录)
        prefix: "" # 指令调用前缀，可不配置
        master: 1659488338 # 机器人主人账号(拥有完整操作该机器人的权限，可不配置)
        admins: [] # 机器人管理员账号(可不配置)
plugins:
  config: null # 指定启用配置管理插件
  daemon: null # 指定启用守护进程插件
  help: null # 指定启用帮助插件
  login: null # 指定启用命令行登录插件
  plugin: null # 指定启用插件管理插件
  systemInfo: null # 指定启用系统信息查看插件
  watcher: /path/to/zhin-bot # 指定启用文件监听插件
log_level: info # 指定日志等级
plugin_dir: plugins # 指定本地插件存放目录
data_dir: data # 缓存文件存放目录
delay:
  prompt: 60000 # prompt方法超时时间为1分钟(60*1000毫秒)
```

## 适配器配置(adapters)

即 Zhin 当前启用的适配器配置，其中每一项的 key 为适配器名称，对应 value 中的 bots 中存放的则是使用该适配器添加到 Zhin 的每一个机器人账号配置

而每一个 Bot 的配置中，除了不同平台的配置外，只能额外提供了一些通用配置，用于配置 Bot 在 Zhin 中的权限配置和指令设置

### bot 通用配置

| 配置名 | 类型                     | 默认值 | 描述           |
| :----- | :----------------------- | :----- | :------------- |
| master | string &#124; number     | -      | 主人账号       |
| admins | (string &#124; number)[] | []     | 管理员账号列表 |
| prefix | string                   | -      | 指令调用前缀   |

## 插件配置(plugins)

即 Zhin 当前启用的插件配置，其中每一项的 key 为插件名称,对应 value 则为传递给相应插件的配置内容

其中 `config`、`daemon`、`help`、`login`、`logs`、`plugin`、`status`、`watcher` 为 Zhin 内置插件帮助用户完成一些通用功能，具体功能请见[内置插件](/config/built-plugin)介绍

## 通用配置(...other)

除了通用`适配器配置`和`插件配置`以外的配置，均属于zhin的通用配置，其中各项含义如下表：

| 配置名     | 类型                                                                                        | 默认值                      | 描述                 |
| :--------- | :------------------------------------------------------------------------------------------ | :-------------------------- | :------------------- |
| log_level  | trace &#124; debug &#124; info &#124; warn &#124; error &#124; fatal &#124; mark &#124; off | info                        | 日志输出等级         |
| plugin_dir | string                                                                                      | plugins                     | 插件存放路径         |
| data_dir   | string                                                                                      | data                        | 数据存放路径         |
| delay      | Record<string,number>                                                                       | &#123; prompt: 60000 &#125; | 系统各种超时时长配置 |
