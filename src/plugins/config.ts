import * as Yaml from 'js-yaml'
import * as fs from 'fs'
import {get,unset,set,mapValues} from "lodash";
import {Context} from "@/context";
import {Element} from "@/element";
function protectkeys(obj:Record<string, any>,keys:string[]){
    if(!obj || typeof obj!=='object') return obj
    return mapValues(obj,(value,key)=>{
        if(typeof value==='object') return protectkeys(value,keys)
        if(!keys.includes(key)) return value
        return new Array(value.length).fill('*').join('')
    })
}

function outputConfig(config,key){
    if(!key)return JSON.stringify(protectkeys(config,['password','access_token']),null,2)
    const result=JSON.stringify(protectkeys(get(config,key),['password','access_token']),null,2)
    return key.endsWith('password')?new Array(result.length).fill('*').join(''):result
}
export const name='configManage'
export function install(ctx:Context){
    ctx.command('config [key:string] [value]')
        .desc('编辑配置文件')
        .auth("master","admins")
        .hidden()
        .option('delete','-d 删除指定配置')
        .action(({options}, key,value) => {
            const config=Yaml.load(fs.readFileSync(process.env.configPath||'','utf8')) as object
            if(value===undefined && !options.delete) return outputConfig(config,key)
            if(options.delete){
                unset(config,key)
                fs.writeFileSync(process.env.configPath,Yaml.dump(config))
                return `已删除:config.${key}`
            }
            try{
                value=JSON.parse(Element.stringify(value))
            }catch {}
            set(config,key,value)
            fs.writeFileSync(process.env.configPath,Yaml.dump(config))
            return `修改成功`
        })
}