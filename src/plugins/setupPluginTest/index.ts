import {useApp,useOptions} from "@";
useApp().on('oicq.message',(e)=>{
    e.reply('hello world')
})
useApp().on('oicq.request.group',(e)=>{
    e.approve(true)
})
useApp().on('onebot.message',(e)=>{
    e.bot.reply('123')
})
const options=useOptions('plugins.login')