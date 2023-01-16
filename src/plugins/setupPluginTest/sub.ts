import {useContext} from "@";
const ctx=useContext()
ctx.command('music <name:string>')
    .desc('点歌插件')
    .option('platform','-p <platform:string> 受支持的平台',{initial:'qq'})
    .alias('点歌')
    .shortcut(/^qq点歌:(.+)/,{args:['$1'],options:{platform:'qq'}})
    .action(({options},msg)=>{
        return [`你输入的消息是：`,msg,'平台是',options.platform]
    })