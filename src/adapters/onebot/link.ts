import {WebSocket} from "ws";
import axios from "axios";
import {OneBot} from "@/adapters/onebot/bot";
import {OneBotPayload} from "@/adapters/onebot/types";
export function createHttpHandler(bot:OneBot,options:OneBot.Options<'http'>){
    const request=axios.create({
        baseURL:options.url,
        timeout:options.timeout||60000
    })
    if(options.access_token){
        request.interceptors.request.use((config)=>{
            config.headers['Authorization']=`Bearer ${options.access_token}`
            return config
        })
    }
    bot.sendPayload=function (payload){
        return request.post(payload.action,payload.params)
    }
    bot.app.setInterval(()=>{
        request.get('/get_latest_events').then(res=>{
            if(res.status===200){
                const events=res.data.data||[]
                for(const event of events){
                    bot.adapter.dispatch(event.type,bot.createSession(event.type,event))
                }
            }
        }).catch(e=>{
            console.log('err',e)
        })
    },options.get_events_interval)
}
export function createWebhookHandler(bot:OneBot,options:OneBot.Options<'webhook'>){
    let history:OneBotPayload[]=[]
    bot.app.router.post(options.path,(ctx)=>{
        const event=ctx.request.body
        if(event &&  event.detail_type!=='heartbeat'){
            bot.adapter.dispatch(event.type,bot.createSession(event.type,event))
        }
        ctx.res.writeHead(200).end()
    })
    bot.app.router.get(options.path+options.get_actions_path,(ctx)=>{
        ctx.body=JSON.stringify(history)
        history=[]
    })
    bot.sendPayload=function (payload){
        history.push(payload)
    }
}