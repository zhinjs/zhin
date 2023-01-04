import {createBot} from "@/bot";
import {resolve} from 'path'
process.on('unhandledRejection',(e)=>{
    console.error(e)
})
process.on('uncaughtException',(e)=>{
    console.error(e)
})
createBot(process.env.configPath||resolve(process.cwd(),'zhin.yaml')).start()