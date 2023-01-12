import {useContext} from "@";
const context=useContext()
context.on('oicq.message',(e)=>{
    e.reply('hello world')
})
context.on('oicq.request.group',(e)=>{
    e.approve(true)
})
context.on('onebot.message',(e)=>{
    e.bot.reply('123')
})