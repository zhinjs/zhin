import {FSWatcher, watch} from 'chokidar'
import {Bot} from "@/bot";
import * as fs from 'fs';
import * as Yaml from 'js-yaml'
import * as path from "path";
import {Dict} from "@/types";
export function install(this:Bot.Plugin,bot:Bot,root:string){
    function deepEqual(a: any, b: any) {
        if (a === b) return true
        if (typeof a !== typeof b) return false
        if (typeof a !== 'object') return false
        if (!a || !b) return false
        if (Array.isArray(a)) {
            if (!Array.isArray(b) || a.length !== b.length) return false
            return a.every((item, index) => deepEqual(item, b[index]))
        } else if (Array.isArray(b)) {
            return false
        }
        return Object.keys({...a, ...b}).every(key => deepEqual(a[key], b[key]))
    }
    function checkChange(oldConfig:Dict,newConfig:Dict){
        for (const name in {...oldConfig, ...newConfig}) {
            if (name.startsWith('~')) continue
            if (deepEqual(oldConfig[name], newConfig[name])) continue
            if (name in newConfig) {
                const p=[...bot.plugins.values()].find(p=>p.name===name)
                if (name in oldConfig && p) {
                    reloadDependency(p,p['fullPath'])
                } else {
                    loadDependency(name)
                }
            } else {
                unloadDependency(name)
            }
        }
    }
    function loadDependency(name:string){
        const plugin=bot.load(name)
        bot.use(plugin)
        bot.logger.info(`已载入:${name}`)
    }
    function unloadDependency(name:string){
        const plugin=[...bot.plugins.values()].find(p=>p.name===name)
        if(plugin && plugin['fullPath'])
        bot.logger.info(`已移除:${name}`)
    }
    function reloadDependency(item: Bot.Plugin, fullPath) {
        try {
            item.dispose()
            delete require.cache[fullPath]
            if(fullPath!==item['fullPath']){
                delete require.cache[item['fullPath']]
                delete require.cache[item['fullPath']+'/index.js']
                delete require.cache[item['fullPath']+'/index.ts']
                delete require.cache[item['fullPath']+'/index.cjs']
                delete require.cache[item['fullPath']+'/index.mjs']
            }
            require(fullPath)
            const plugin=bot.load(item.name)
            bot.use(plugin)
            bot.logger.info(`已重载:${plugin.name}`)
        } catch (e) {
            bot.logger.warn(e)
        }
    }

    const watchPath=path.resolve(process.cwd(),root||'.')
    const watcher: FSWatcher = watch(watchPath, {
        ignored: ['**/node_modules/**', '**/.git/**', '**/.idea/**']
    })
    watcher.on('change', (filename) => {
        const changeFileName=path.resolve(process.cwd(),filename)
        if(path.resolve(process.env.configPath)===changeFileName){
            const newOptions:Bot.Options=Yaml.load(fs.readFileSync(process.env.configPath,"utf8")) as any
            checkChange(bot.options.plugins,newOptions.plugins)
            bot.options=newOptions
        }else{
            const plugin=[...bot.plugins.values()].find(p=>filename.includes(p['fullPath']))
            if(plugin){
                reloadDependency(plugin,changeFileName)
            }
        }
    })
    this.disposes.push(()=>{
        watcher.close()
        return true
    })
}