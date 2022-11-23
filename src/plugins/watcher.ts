import {FSWatcher, watch} from 'chokidar'
import {Bot} from "@/bot";
import {Plugin} from "@/plugin";
import * as fs from 'fs';
import * as Yaml from 'js-yaml'

import * as path from "path";
import {Dict} from "@/types";
export function install(this:Plugin,bot:Bot,root:string){
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
                const p=bot.plugins.get(name)
                if (name in oldConfig && p) {
                    reloadDependency(p,newConfig[name])
                } else {
                    loadDependency(name,newConfig[name])
                }
            } else {
                unloadDependency(name)
            }
        }
    }
    function loadDependency(name:string,options:Dict){
        const plugin=bot.load(name)
        bot.plugin(plugin,options)
    }
    function unloadDependency(name:string){
        bot.dispose(name)
    }
    function reloadDependency(plugin:Plugin,config:Dict)
    function reloadDependency(plugin: Plugin,changeFile:string)
    function reloadDependency(plugin:Plugin,...args:[Dict|string]|[]){
        let changeFile=typeof args[0]==='string'?args[0]:plugin.fullPath
        let options=typeof args[0]!=='string'?args[0]:bot.options.plugins[plugin.name]
        try {
            bot.dispose(plugin.name)
            if(plugin.functional) return
            delete require.cache[changeFile]
            if(changeFile!==plugin.fullPath){
                delete require.cache[plugin.fullPath]
                delete require.cache[plugin.fullPath+'/index.js']
                delete require.cache[plugin.fullPath+'/index.ts']
                delete require.cache[plugin.fullPath+'/index.cjs']
                delete require.cache[plugin.fullPath+'/index.mjs']
            }
            require(plugin.fullPath)
            const newPlugin=bot.load(plugin.name)
            bot.plugin(newPlugin,options)
            const dependentPlugins=[...bot.plugins.values()].filter(p=>p.using && p.using.includes(plugin.name as never))
            for(const dependentPlugin of dependentPlugins){
                bot.logger.info('正在重载依赖该插件的插件:'+dependentPlugin.name)
                reloadDependency(dependentPlugin,dependentPlugin.fullPath)
            }
            if(dependentPlugins.length){
                bot.emit('ready')
            }
            bot.logger.info(`已重载:${newPlugin.name}`)
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
            const plugins=[...bot.plugins.values()].filter(p=>filename.includes(p.fullPath))
            for(const plugin of plugins){
                reloadDependency(plugin,changeFileName)
            }
        }
    })
    this.disposes.push((()=>{
        watcher.close()
        return true
    }) as any)
}