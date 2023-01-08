import {FSWatcher, watch} from 'chokidar'
import {App} from "@/app";
import {Plugin} from "@/plugin";
import * as fs from 'fs';
import * as Yaml from 'js-yaml'

import * as path from "path";
import {Dict} from "@/types";
import {deepEqual} from "@";
export const name='pluginWatcher'
export function install(this:Plugin, app:App, root:string){
    function checkChange(oldConfig:Dict,newConfig:Dict){
        for (const name in {...oldConfig, ...newConfig}) {
            if (name.startsWith('~')) continue
            if (deepEqual(oldConfig[name], newConfig[name])) continue
            if (name in newConfig) {
                const p=app.plugins.get(name)
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
        try{
            const plugin=app.load<Plugin>(name,'plugin')
            app.plugin(plugin,options)
        }catch (e){
            app.logger.warn(e.message)
        }
    }
    function unloadDependency(name:string){
        app.dispose(name)
    }
    function reloadDependency(plugin:Plugin,config:Dict)
    function reloadDependency(plugin: Plugin,changeFile:string)
    function reloadDependency(plugin:Plugin,...args:[Dict|string]|[]){
        let changeFile=typeof args[0]==='string'?args[0]:plugin.fullPath
        let options=typeof args[0]!=='string'?args[0]:app.options.plugins[plugin.name]
        try {
            app.dispose(plugin.name)
            if(plugin.functional) return
            delete require.cache[changeFile]
            if(changeFile!==plugin.fullPath){
                delete require.cache[plugin.fullPath]
                delete require.cache[plugin.fullPath+'/index.js']
                delete require.cache[plugin.fullPath+'/index.ts']
                delete require.cache[plugin.fullPath+'/index.cjs']
                delete require.cache[plugin.fullPath+'/index.mjs']
            }
            const newPlugin=app.load<Plugin>(plugin.fullPath,'plugin')
            app.plugin(newPlugin,options)
            const dependentPlugins=[...app.plugins.values()].filter(p=>p.using && p.using.includes(plugin.name as never))
            for(const dependentPlugin of dependentPlugins){
                app.logger.info('正在重载依赖该插件的插件:'+dependentPlugin.name)
                try{
                    reloadDependency(dependentPlugin,dependentPlugin.fullPath)
                }catch (e){
                    app.logger.warn(e.message)
                }
            }
            if(dependentPlugins.length){
                app.emit('ready')
            }
            app.logger.info(`已重载:${newPlugin.name}`)
        } catch (e) {
            app.logger.warn(e)
        }
    }

    const watchPath=path.resolve(process.cwd(),root||'.')
    const watcher: FSWatcher = watch(watchPath, {
        ignored: ['**/node_modules/**', '**/.git/**', '**/.idea/**']
    })
    watcher.on('change', (filename) => {
        const changeFileName=path.resolve(process.cwd(),filename)
        if(path.resolve(process.env.configPath)===changeFileName){
            const newOptions:App.Options=Yaml.load(fs.readFileSync(process.env.configPath,"utf8")) as any
            app.changeOptions(newOptions)
        }else{
            const plugins=[...app.plugins.values()].filter(p=>filename.includes(p.fullPath))
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