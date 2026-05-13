# 使用约定优先的配置默认值

主配置按 breaking 语义清理：运行时以默认约定为 base，再把用户配置作为 override 做 deep merge。对象字段合并，数组字段显式写出时完整覆盖默认数组；因此 `zhin.config.yml` 可以只保留真实差异项。

配置读取方必须通过 `ConfigFeature.getPrimary()` 读取主配置，不再依赖 `zhin.config.yml` 这个文件名。旧环境变量默认值语法 `${VAR:default}` 已删除，只保留 bash 风格 `${VAR:-default}` / `${VAR:=default}` 和转义 `\${VAR}`。
