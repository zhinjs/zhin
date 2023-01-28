import {createZhin} from "./zhin";
import {resolve} from 'path'
process.on('unhandledRejection',(e)=>{
    console.error(e)
})
process.on('uncaughtException',(e)=>{
    console.error(e)
})
createZhin(process.env.configPath||resolve(process.cwd(),'zhin.yaml')).start()
createZhin({
    protocols:{
        onebot:{
            bots:[]
        },
        oicq:{
            bots:[]
        }
    }
})