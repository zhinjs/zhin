import {createReadStream, copyFileSync, statSync, writeFileSync} from 'fs'
import {resolve as PathResolve, dirname} from "path";
import * as readline from 'readline'
import {arch, cpus, freemem, totalmem, type} from "os";
import {Time, useContext} from "@";
import {version} from "@";

export const name = 'systemInfo'
const ctx = useContext()

const logFile = PathResolve(dirname(ctx.zhin.options.data_dir), 'logs.log')

function readLogs(): Promise<string[]> {
    return new Promise<string[]>(resolve => {
        const rl = readline.createInterface({input: createReadStream(logFile)})
        const logLines: string[] = []
        rl.on('line', (l: string) => {
            let [_, date, level, name, msg] = /^\[(.*)\] \[(.*)\] (.*) - (.*)/.exec(l) || []
            if (!date || !level || !name || !msg) {
                return logLines.push(l)
            }
            date = date
                .replace('T', ' ')
                .replace(/\.(\d){3}/, '')
            name = name
                .replace('[', '')
                .replace(']', '')
            msg = msg
                .replace('recv from', '收到')
                .replace('succeed to send', '发出')
            logLines.push(`[${date}] [${level.toLowerCase()}] [${name}]: ${msg}`)
        }).on('close', () => {
            resolve(logLines)
        })
    })
}

function cleanLogs(backup?: boolean) {
    if (backup) {
        const date = new Date()
        const backupDate = [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-')
        const backupTime = [date.getHours(), date.getMinutes(), date.getSeconds()].join(':')
        copyFileSync(logFile, PathResolve(dirname(logFile), `logs-${[backupDate, backupTime].join()}.log`))
    }
    writeFileSync(logFile, '')
    return '已清理所有日志'
}

function backupLogs() {
    const backupDate = new Date().toLocaleDateString()
    copyFileSync(logFile, PathResolve(dirname(logFile), `logs-${backupDate}.log`))
    return `已备份日志到logs-${backupDate}.log`
}

function showLogDetail() {
    const stat = statSync(logFile)
    let size = stat.size
    const sizeInfo = ['B', 'KB', 'GB', 'TB'].map((operator, index) => {
        let result = size / Math.pow(1024, index)
        return `${operator}: ${result.toFixed(index * 2)}${operator}`
    })
    return `detail:\n${sizeInfo.join('\n')}`
}

ctx.command('logs <lines:number>')
    .desc('日志管理')
    .auth('master', "admins")
    .hidden()
    .option('clean', '-c 清理日志')
    .option('backup', '-b 备份日志')
    .option('detail', '-d 查看日志大小')
    .action(async ({options}, lineNum = 10) => {
        if (options.clean) return cleanLogs(options.backup)
        if (options.backup) return backupLogs()
        if (options.detail) return showLogDetail()
        const logLines = await readLogs()
        const lines = logLines.reverse().slice(0, lineNum).reverse()
        return lines.join('\n')
    })
ctx.command('status')
    .desc('查看知音状态')
    .hidden()
    .action(({session}) => {
        function format(bytes) {
            const operators = ['B', 'KB', 'MB', 'GB', 'TB']
            while (bytes > 1024 && operators.length > 1) {
                bytes = bytes / 1024
                operators.shift()
            }
            return (+bytes.toFixed(0) === bytes ? bytes : bytes.toFixed(2)) + operators[0];
        }

        const memoryUsage = process.memoryUsage()
        const totalMem = totalmem()
        const usedMem = totalMem - freemem()
        const cpu = cpus()[0]
        return [
            '当前状态:',
            `zhin版本：${version}`,
            `系统架构:${type()}  ${arch()}`,
            `CPU架构:${cpus().length}核 ${cpu.model}`,
            `内存:${format(usedMem)}/${format(totalMem)}(${(usedMem / totalMem * 100).toFixed(2)}%)`,
            `进程内存占比:${(memoryUsage.rss / usedMem * 100).toFixed(2)}%(${format(memoryUsage.rss)}/${format(usedMem)})`,
            `持续运行时间：${Time.formatTime(new Date().getTime() - session.bot.status.start_time)}`,
            `掉线次数:${session.bot.status.lost_times}次`,
            `发送消息数:${session.bot.status.sent_msg_cnt}条`,
            `接收消息数:${session.bot.status.recv_msg_cnt}条`,
            `消息频率:${session.bot.status.msg_cnt_per_min}条/分`,
        ].join('\n')
    })
