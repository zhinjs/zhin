export { Logger } from 'log4js';
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'mark' | 'off';
export type NumString<S extends string> = `${number}` | `${number}${S}${string}`;
