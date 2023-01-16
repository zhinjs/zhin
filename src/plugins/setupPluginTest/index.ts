import {useContext} from "@";
import './sub'
const ctx=useContext()
ctx.plugin('./sub2')
ctx.command('send <msessage>')
.desc('发送指定消息')
.action((_,msg)=>msg)