import {Time} from "@";
import {totalmem,freemem, cpus, type, arch} from 'os'
import {Context} from "@/context";
export const name='status'
export function install(ctx:Context){
    ctx.command('status')
        .action(({session})=>{
            function format(bytes){
                const operators=['B','KB','MB','GB','TB']
                while (bytes>1024 && operators.length>1){
                    bytes=bytes/1024
                    operators.shift()
                }
                return (+bytes.toFixed(0)===bytes?bytes:bytes.toFixed(2))+operators[0];
            }
            const memoryUsage=process.memoryUsage()
            const totalMem=totalmem()
            const usedMem=totalMem-freemem()
            const cpu=cpus()[0]

            return [
                '当前状态:',
                `系统架构:${type()}  ${arch()}`,
                `CPU架构:${cpus().length}核 ${cpu.model}`,
                `内存:${format(usedMem)}/${format(totalMem)}(${(usedMem/totalMem*100).toFixed(2)}%)`,
                `进程内存占比:${(memoryUsage.rss/usedMem*100).toFixed(2)}%(${format(memoryUsage.rss)}/${format(usedMem)})`,
                `持续运行时间：${Time.formatTime(new Date().getTime()-session.bot.startTime)}`,
                `掉线次数:${session.bot.stat.lost_times}次`,
                `发送消息数:${session.bot.stat.sent_msg_cnt}条`,
                `接收消息数:${session.bot.stat.recv_msg_cnt}条`,
                `消息频率:${session.bot.stat.msg_cnt_per_min}条/分`,
            ].join('\n')
        })
}
