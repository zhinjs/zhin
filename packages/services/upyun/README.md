# @zhinjs/plugin-upyun
为 zhin 提供又拍云存储服务
## 使用方法
1. 安装插件
```shell
yarn add @zhinjs/plugin-upyun
```
2. 配置
在`.[mode].env` 文件中配置环境变量
```text
UPDOMAIN = 又拍云绑定域名，不填时自动使用测试域名
UPBUCKET = 又拍云存储桶名
UPOPERATOR = 又拍云操作员名
UPPASSWORD = 又拍云操作员密码
```
3. 启用
在`.[mode].env` 文件中启用又拍云插件
```text
modulePlugins = @zhinjs/plugin-upyun
```
4. 使用
在其他插件中使用
```javascript
import {Plugin} from 'zhin'
const p=new Plugin('test')
p.mounted(()=>{
  // 上传流文件
  p.upyun.uploadStreamFile()
  // 上传本地文件
  p.upyun.uploadStreamFile()
  // 删除文件
  p.upyun.deleteFile()
  // 删除目录
  p.upyun.deleteDir()
  // 获取目录文件列表
  p.upyun.listDir()
  // 获取服务用量
  p.upyun.usage()
})
```

