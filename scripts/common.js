const path = require('path')
const fs = require('fs')

module.exports.getPackages= function(){
  const argsDirs=process.argv.slice(2)
  return argsDirs.length?argsDirs.map(dir=>{
    return path.join(process.cwd(),dir)
  }):[
    path.join(process.cwd(),'core'), // 核心包
    ...fs.readdirSync(path.join(process.cwd(),'packages','services'))
      .map((dir)=>path.join(process.cwd(),'packages','services',dir)), // 官方服务
      ...fs.readdirSync(path.join(process.cwd(),'packages','adapters'))
        .map((dir)=>path.join(process.cwd(),'packages','adapters',dir)), // 官方适配器
    ...fs.readdirSync(path.join(process.cwd(),'packages','plugins'))
      .map((dir)=>path.join(process.cwd(),'packages','plugins',dir)), // 官方插件
  ].filter(root=>{
    return !require(path.join(root,'package.json'))?.private &&
      !!require(path.join(root,'tsconfig.json'))
  });
}
