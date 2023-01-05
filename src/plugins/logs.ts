import {createReadStream, copyFileSync, statSync, writeFileSync} from 'fs'
import {resolve as PathResolve,dirname} from "path";
import * as readline from 'readline'
import {App} from "@";
export const name='logs'
export function install(bot:App){
    const logFile=PathResolve(dirname(bot.options.data_dir),'logs.log')
    function readLogs():Promise<string[]>{
        return new Promise<string[]>(resolve=>{
            const rl=readline.createInterface({input:createReadStream(logFile)})
            const logLines:string[]=[]
            rl.on('line',(l:string)=>{
                let [_,date,level,name,msg]= /^\[(.*)\] \[(.*)\] (.*) - (.*)/.exec(l)||[]
                if(!date||!level||!name||!msg){
                    return logLines.push(l)
                }
                date=date
                    .replace('T',' ')
                    .replace(/\.(\d){3}/,'')
                name=name
                    .replace('[','')
                    .replace(']','')
                msg=msg
                    .replace('recv from','收到')
                    .replace('succeed to send','发出')
                logLines.push(`[${date}] [${level.toLowerCase()}] [${name}]: ${msg}`)
            }).on('close',()=>{
                resolve(logLines)
            })
        })
    }
    function cleanLogs(backup?:boolean){
        if(backup){
            const date=new Date()
            const backupDate=[date.getFullYear(),date.getMonth()+1,date.getDate()].join('-')
            const backupTime=[date.getHours(),date.getMinutes(),date.getSeconds()].join(':')
            copyFileSync(logFile,PathResolve(dirname(logFile),`logs-${[backupDate,backupTime].join( )}.log`))
        }
        writeFileSync(logFile,'')
        return '已清理所有日志'
    }
    function backupLogs(){
        const backupDate=new Date().toLocaleDateString()
        copyFileSync(logFile,PathResolve(dirname(logFile),`logs-${backupDate}.log`))
        return `已备份日志到logs-${backupDate}.log`
    }
    function showLogDetail(){
        const stat=statSync(logFile)
        let size=stat.size
        const sizeInfo=['B','KB','GB','TB'].map((operator,index)=>{
            let result=size/Math.pow(1024,index)
            return `${operator}: ${result.toFixed(index*2)}${operator}`
        })
        return `detail:\n${sizeInfo.join('\n')}`
    }
    bot.command('logs <lines:number>')
        .desc('输出最近的日志')
        .option('clean','-c 清理日志')
        .option('backup','-b 备份日志')
        .option('detail','-d 查看日志大小')
        .action(async ({options},lineNum=10)=>{
            if(options.clean) return cleanLogs(options.backup)
            if(options.backup) return backupLogs()
            if(options.detail) return showLogDetail()
            const logLines=await readLogs()
            const lines=logLines.reverse().slice(0,lineNum).reverse()
            return lines.join('\n')
        })
}