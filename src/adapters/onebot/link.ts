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
    const cachedEvent:number[]=[]
    bot.sendPayload=function (payload){
        return request.post(payload.action,payload.params)
    }
    const dispose=bot.app.setInterval(()=>{
        request.get('/get_latest_events').then(res=>{
            if(res.status===200){
                const events=res.data.data||[]
                for(const event of events.filter(event=>!cachedEvent.includes(event.time))){
                    bot.adapter.dispatch(event.type,bot.createSession(event.type,event))
                    cachedEvent.push(event.time)
                    if(cachedEvent.length>(options.events_buffer_size||20)){
                        cachedEvent.shift()
                    }
                }
            }
        }).catch(e=>{
            console.log('err',e)
        })
    },options.get_events_interval)
    return ()=>{
        dispose()
        bot.sendPayload=()=>{}
    }
}
export function createWebhookHandler(bot:OneBot,options:OneBot.Options<'webhook'>){
    let history:OneBotPayload[]=[]
    const hookRoute=bot.app.router.post(options.path,(ctx)=>{
        const event=ctx.request.body
        if(event){
            bot.adapter.dispatch(event.type,bot.createSession(event.type,event))
        }
        ctx.res.writeHead(200).end()
    })
    const actionsRoute=bot.app.router.get(options.path+options.get_actions_path,(ctx)=>{
        ctx.body=JSON.stringify(history)
        history=[]
    })
    bot.sendPayload=function (payload){
        history.push(payload)
    }
    return ()=>{
        bot.app.router.destroy(hookRoute)
        bot.app.router.destroy(actionsRoute)
        bot.sendPayload=()=>{}
    }
}
export function createWsHandler(bot:OneBot,options:OneBot.Options<'ws'>){
    const socket=new WebSocket(options.url,{
        headers:{
            ['Authorization']:`Bearer ${options.access_token}`
        }
    })
    socket.onmessage=(data)=>{
        const event=JSON.parse(data.data.toString())
        if(event){
            bot.adapter.dispatch(event.type,bot.createSession(event.type,event))
        }
    }
    bot.sendPayload=function (payload){
        socket.send(JSON.stringify(payload))
    }
    return ()=>{
        socket.close()
        bot.sendPayload=()=>{}
    }
}
export function createWsReverseHandler(bot:OneBot,options:OneBot.Options<'ws_reverse'>){
    const socketServer=bot.app.router.ws(options.path,(req)=>{
        return String(req.headers['sec-websocket-protocol']).includes('12')
    })
    const wss:Set<WebSocket>=new Set<WebSocket>()
    socketServer.on('connection',(ws,req)=>{
        if(options.access_token && req.headers['authorization']!==`Bearer ${options.access_token}`) return
        ws.send(JSON.stringify({type: 'connected'}))
        ws.emit('open')
        wss.add(ws)
        ws.onmessage=(data)=>{
            const event=JSON.parse(data.data.toString())
            if(event){
                bot.adapter.dispatch(event.type,bot.createSession(event.type,event))
            }
        }
        ws.on("error", (err) => {
            console.error('协议端报错：',err)
        })
        ws.on('close',()=>wss.delete(ws))
    })
    socketServer.on("error", (err) => {
        console.error('socket Server，报错：',err)
    })
    bot.sendPayload=function (payload){
        for(const ws of wss){
            ws.send(JSON.stringify(payload))
        }
    }
    return ()=>{
        socketServer.close()
        bot.sendPayload=()=>{}
    }
}
