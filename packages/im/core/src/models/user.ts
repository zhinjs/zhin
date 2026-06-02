import { Definition } from '@zhin.js/database'
export interface User{
    id:string
    name?:string
    password?:string
    third_part:string[];
    permissions?:string[]
}
export const UserDefinition:Definition<User>={
    id:{type:"text",nullable:false},
    name:{type:'text',nullable:true},
    password:{type:'text',nullable:true},
    third_part:{type:'json',default:[]},
    permissions:{type:'json',default:[]}
}