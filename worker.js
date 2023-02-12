const path=require('path')
let {configPath='zhin.yaml',mode='',entry}=process.env
process.on('unhandledRejection',(e)=>{
    console.error(e)
})
process.on('uncaughtException',(e)=>{
    console.error(e)
})
entry=path.resolve(__dirname,entry||'lib')
require(entry)
    .createZhin(path.resolve(process.cwd(),configPath))
    .start(mode)
