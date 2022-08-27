import {Dict} from "./types";
export namespace Prompt{
    export interface Options<T extends keyof TypeKV>{
        type:T | Falsy | PrevCaller<T,T|Falsy>,
        name?:string
        label?:string
        message?:string
        prefix?:string
        action?:string
        validate?:RegExp|((message:string)=>boolean)
        errorMsg?:string
        separator?:string|PrevCaller<T, string>
        choices?:ChoiceItem[]|PrevCaller<T,ChoiceItem[]>
        initial?:ValueType<T>|PrevCaller<T, ValueType<T>>
        timeout?:number
        format?:(value:ValueType<T>)=>ValueType<T>
    }
    type Falsy = false | null | undefined;
    type PrevCaller<T extends keyof TypeKV,R=T> = (
        prev: any,
        answer: Dict,
        options: Options<T>
    ) => R;
    export interface ChoiceItem{
        title:string
        value:any
    }
    export interface TypeKV{
        text:string
        any:any
        video:`[CQ:video,${string}]`
        image:`[CQ:image,${string}]`
        face:`[CQ:face,${string}]`
        qq:number
        number:number,
        list:any[]
        confirm:boolean
        date:Date
        select:any
        multipleSelect:any[]
    }
    export type Answers<V extends any=any> = { [id in string]: V };
    export type ValueType<T extends keyof TypeKV>= T extends keyof TypeKV?TypeKV[T]:any
    export function formatValue<T extends keyof TypeKV>(prev:any,answer:Dict,option:Options<T>,message:string):ValueType<T>{
        const type=typeof option.type==="function"?option.type(prev,answer,option):option.type
        const separator=typeof option.separator==='function'?option.separator(prev,answer,option):option.separator
        // @ts-ignore
        const initial:ValueType<T>=typeof option.initial==='function'?option.initial(prev,answer,option):option.initial
        let  result
        switch (type){
            case "text":
                result=message
                break;
            case 'face':
                if(message.match(/^\[CQ:face,(.*)]$/)){
                    result=message
                }
                break;
            case 'video':
                if(message.match(/^\[CQ:video,(.*)]$/)){
                    result=message
                }
                break;
            case 'qq':{
                if(message.match(/^\[CQ:at,type=at,qq=(.*)]$/)){
                    message=message.match(/^\[CQ:at,type=at,qq=(.*)]$/)[1]
                }
                if(message.match(/^\d+$/)){
                    result=+message
                }else{
                    result=initial||100000
                }
                break;
            }
            case 'image':
                if(message.match(/^\[CQ:image,(.*)]$/)){
                    result=message
                }
                break;
            case "number":
                if(message.match(/^(\d+)]$/)){
                    result=Number(message)
                }else {
                    result=initial
                }
                break;
            case "list":
                if(message.match(new RegExp(`^.+(${separator}.+)*$`))){
                    result=message.split(separator)
                }else{
                    result=initial||[]
                }
                break;
            case "date":
                if(new Date(message).toString()!=='Invalid Date'){
                    result=new Date(message)
                }else{
                    result=initial||new Date()
                }
                break;
            case "confirm":
                if(['是','yes','y','.','。'].includes(message.toLowerCase())){
                    result=true
                }else{
                    result=initial||false
                }
                break;
            case 'select':
                if(message.match(/^\d+$/)){
                    result=option.choices[Number(message)-1].value
                }else result=initial
                break;
            case 'multipleSelect':
                const reg=new RegExp(`^\\d+(${separator}\\d+)*$`)
                if(message.match(reg)){
                    result=message.split(separator).map(Number).map(index=>option.choices[index-1].value)
                }else{
                    result=initial||[]
                }
                break;
        }
        if(option.format){
            return option.format(result)
        }
        return result
    }
    export function getPrefix(type:keyof TypeKV){
        switch (type){
            case "select":
            case 'multipleSelect':
                return '请选择'
            case 'confirm':
                return '是否确认'
            case 'video':
            case 'image':
                return '上传'
            default :
                return '请输入'
        }
    }
    export function formatOutput<T extends keyof TypeKV>(prev:any,answer:Dict,options:Options<T>){
        let result:string[]=[]
        if(!options.name && !options.prefix) throw new Error('name/prefix is required')
        const titleArr=[
            options.message||`${(getPrefix(options.type as keyof TypeKV)+(options.action||'')+options.label||options.name||'')}`,
            `${options.initial !==undefined && !['select','multipleSelect'].includes(options.type as keyof TypeKV)?`默认：${options.initial}`:''}`,
            `${['list','multipleSelect'].includes(options.type as keyof TypeKV)?`多项使用'${options.separator}'分隔`:''}`
        ].filter(Boolean)
        if(options.prefix){titleArr.shift()}
        result=result.concat(titleArr)
        if(options.prefix)result.unshift(options.prefix)
        if (options.type==='confirm')result.push("\n输入y[es]或句号(.或。)或是以确认，其他内容取消(不区分大小写)")
        const choices=typeof options.choices==='function'?options.choices(prev,result,options):options.choices
        switch (options.type){
            case "text":
            case 'number':
            case "date":
            case "confirm":
            case 'list':
                break;
            case "select":
            case 'multipleSelect':
                if(!choices) throw new Error('choices is required')
                result.push('\n',
                    choices.map((option,index)=>`${index+1}:${option.title}${option.value===options.initial?' (默认)':''}`).join('\n'),
                    '\n输入指定选项前边的索引即可'
                )
        }
        return result.flat().join('')
    }
}
