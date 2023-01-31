::: tip
阅读本节前，请确认你已根据[试试水](/guide/start)初始化完成你的项目
:::
# 了解配置
- 在项目初始化完成后，项目根目录会生成一个名为`zhin.yaml`的文件，该文件为zhin核心配置文件，内容大致如下。现在，让我们来了解下配置文件每一项的意义
```yaml
adapters: 
  icqq: # 指定使用icqq适配器
    bots:
      - uin: 147258369 # 登录的账号
        platform: 5 # 指定qq登录平台为iPad（1：安卓  2：安卓平板  3：手表  4：苹果电脑  5：苹果平板）
plugins:
  config: null # 指定启用配置管理插件
  daemon: null # 指定启用守护进程插件
  help: null # 指定启用帮助插件
  login: null # 指定启用命令行登录插件
  logs: null # 指定启用日志插件
  plugin: null # 指定启用插件管理插件
  status: null # 指定启用状态查看插件
  watcher: plugins # 指定启用文件监听插件
log_level: info # 指定日志等级
plugin_dir: plugins # 指定本地插件存放目录
data_dir: data # 缓存文件存放目录
delay:
  prompt: 60000 # prompt方法超时时间为1分钟(60*1000毫秒)
```
## 接入一个qq机器人
1. 将配置`adatpers.icqq.bots`中第一项的uin设置为你自己的qq号
2. 重启项目，根据提示完成qq的登录