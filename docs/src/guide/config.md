# 配置文件
- 知音将配置文件放在`config`目录下，配置文件的格式为`yml`
- 主配置文件为`zhin.config.yml`，描述了知音对插件的启用禁用、插件目录信息、日志等级、数据库驱动、机器人配置等
- 其他配置文件以`*.yml`命名，以供其他插件使用
- 本篇章节将介绍`zhin.config.yml`的配置项，其他插件的配置项请查看对应插件的文档

## 配置文件示例
```yaml
log_level: info # 日志等级
has_init: true # 知音是否已经初始化
db_driver: level # 数据库驱动
db_init_args: # 数据库初始化参数
  - zhin.db
  - valueEncoding: json
    createIfMissing: true
disable_adapters: [] # 禁用的适配器
disable_bots: # 禁用的机器人
  - "2922360890"
disable_plugins: [] # 禁用的插件
plugin_dirs: # 插件目录
  - ../zhin/lib/plugins
  - plugins
bots: # 机器人配置
  - adapter: process # 机器人适配器名称
    unique_id: developer # 机器人唯一标识
    title: 终端 # 标题
    master: "1659488338" # 机器人主人
    admins: [] # 管理员
    command_prefix: "#" # 命令前缀
    quote_self: false # 回复消息是否引用自己
plugins: # 启用的插件列表
  - setup # 提供setup 语法开发插件支持，已内置，可直接使用
  - processAdapter # 进程适配器插件，已内置，可直接使用
  - commandParser # 指令解析插件，已内置，可直接使用
  - echo # 基础输出测试插件，已内置，可直接使用
  - hmr # 提供插件开发热更功能，已内置，可直接使用
  - zhinManager # 提供知音管理相关指令，已内置，可直接使用
  - database # 提供数据存储服务，已内置，可直接使用
```
