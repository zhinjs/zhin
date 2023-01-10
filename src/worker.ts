import {createApp} from "@/app";
import {resolve} from 'path'
process.on('unhandledRejection',(e)=>{
    console.error(e)
})
process.on('uncaughtException',(e)=>{
    console.error(e)
})
createApp(process.env.configPath||resolve(process.cwd(),'zhin.yaml')).start()
createApp({
    adapters:{
        onebot:{
            type:'ws_reverse',
            endpoint:'',
            bots:[
                {
                    access_token:'',
                    admins:[]
                }
            ]
        }
    }
})