import {Context} from "@/context";
function test(ctx:Context){
    console.log(111)
}
export function install(ctx:Context){
    console.log('sub2')
    ctx.plugin(test)
    ctx.command('sub2 <msessage>')
        .desc('发送指定子消息2')
        .action((_,msg)=>msg)
}