# 配置文件
- 在项目初始化完成后，项目根目录会生成一个名为`zhin.yaml`的文件，该文件为zhin核心配置文件，内容大致如下。现在，让我们来了解下配置文件每一项的意义
```yaml
adapters:
  icqq:
    bots:
      - uin: 147258369
        platform: 5
plugins:
  config: null
  daemon: null
  help: null
  login: null
  logs: null
  plugin: null
  status: null
  watcher: plugins
log_level: info
plugin_dir: plugins
data_dir: data
delay:
  prompt: 60000
```
## adapters
- 存放适配器的配置文件，每一个key对应一个适配器，每一个适配器可以启动多个机器人，每个机器人的配置存在bots中
- 不同适配器的机器人配置不尽相同，zhin在每一个bot配置基础上增加了`master`和`admins`配置，用于声明该机器人所属用户以及管理机器人的用户

::: tip
适配器需安装后方能使用，(icqq为内置适配器，无需安装，相应配置请查看[adapter-icqq](/config/adapter-icqq))
:::
## plugins
- 存放插件的配置文件，每一个key对应一个插件，只有在此处定义的插件才会被加载到zhin中

::: tip
插件需安装后方能使用，(样例配置文件中的插件均为内置插件，无需安装即可使用，相应配置请查看[内置插件](/config/built-plugin))
:::
## log_level
- 日志输出等级：（可选值：`off`,`debug`,`error`,`warn`,`info`,`all`）
## plugin_dir
- 本地插件存放文件夹路径
## data_dir
- 缓存数据文件存放文件夹路径
## delay
- 各种超时时长配置(单位：毫秒)

