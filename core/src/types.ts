import { Adapter, AdapterBot } from '@/adapter';

export type Dict<T = any,K extends string|symbol=string> = Record<K, T>
export type Bot<AD extends Adapter>=Adapter.Bot<AdapterBot<AD>>
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "mark" | "off";
export type NumString<S extends string>=`${number}`|`${number}${S}${string}`
export type Merge<First, Second> = {
  [Key in keyof (First & Second)]:
  Key extends keyof Second ? Second[Key] :
    Key extends keyof First ? First[Key] :
    never
}
