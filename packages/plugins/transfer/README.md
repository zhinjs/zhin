# @zhinjs/plugin-transfer
> 消息转移插件
> 可将指定适配器下指定bot的消息转移到另一适配器的指定bot下
## usage
1. 安装、启用本插件
```shell
plugin.install @zhinjs/plugin-transfer
plugin.add @zhinjs/plugin-transfer
```
2. 使用command配置`源机器人`和`目标机器人`
```shell
transfer.add
# 根据提示，配置源和目标机器人
```
3. 测试效果
3.1 给`源机器人`发送消息，测试是否转移到`目标机器人`
