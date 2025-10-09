import {Dict, MessageSegment, SendContent} from "./types";

export function getValueWithRuntime(template: string, ctx: Dict) {
    const result = evaluate(template, ctx);
    if (result === `return(${template})`) return template;
    return result;
}
export const evaluate = <S, T = any>(exp: string, context: S) => execute<S, T>(`return(${exp})`, context);
const evalCache: Record<string, Function> = Object.create(null);
export const execute = <S, T = any>(exp: string, context: S):T => {
    const fn = evalCache[exp] || (evalCache[exp] = toFunction(exp));
    context={
        ...context,
        process:undefined,
        global:undefined,
        Buffer:undefined,
        crypto:undefined
    }
    try {
        return fn.apply(context, [context]);
    } catch {
        return exp as T;
    }
};

const toFunction = (exp: string): Function => {
    try {
        return new Function(`$data`, `with($data){${exp}}`);
    } catch {
        return () => {};
    }
};
export function compiler(template: string, ctx: Dict) {
    const matched = [...template.matchAll(/\${([^}]*?)}/g)];
    for (const item of matched) {
        const tpl = item[1];
        let value = getValueWithRuntime(tpl, ctx);
        if (value === tpl) continue;
        if (typeof value !== 'string') value = JSON.stringify(value, null, 2);
        template = template.replace(`\${${item[1]}}`, value);
    }
    return template;
}
export function segment<T extends object>(type:string,data:T){
    return {
        type,
        data
    }
}
export namespace segment{
    export function escape<T>(text: T): T {
        if (typeof text !== 'string') return text;
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;') as T;
    }
    export function unescape<T>(text: T): T {
        if (typeof text !== 'string') return text;
        return text
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&') as T;
    }
    export function text(text:string){
        return segment('text',{text});
    }
    export function face(id:string,text?:string){
        return segment('face',{id,text});
    }
    export function from(content: SendContent): SendContent {
        if (!Array.isArray(content)) content=[content];
        const toString=(template:string|MessageSegment)=>{
            if(typeof template!=='string') return [template]
            template=unescape(template);
            const result: MessageSegment[] = [];
            const closingReg = /<(\S+)(\s[^>]+)?\/>/;
            const twinningReg = /<(\S+)(\s[^>]+)?>([\s\S]*?)<\/\1>/;
            while (template.length) {
                const [_, type, attrStr = '', child = ''] = template.match(twinningReg) || template.match(closingReg) || [];
                if (!type) break;
                const isClosing = closingReg.test(template);
                const matched = isClosing ? `<${type}${attrStr}/>` : `<${type}${attrStr}>${child}</${type}>`;
                const index = template.indexOf(matched);
                const prevText = template.slice(0, index);
                if (prevText)
                    result.push({
                        type: 'text',
                        data: {
                            text: unescape(prevText),
                        },
                    });
                template = template.slice(index + matched.length);
                const attrArr = [...attrStr.matchAll(/\s([^=]+)(?=(?=="([^"]+)")|(?=='([^']+)'))/g)];
                const data = Object.fromEntries(
                    attrArr.map(([source, key, v1, v2]) => {
                        const value = v1 || v2;
                        try {
                            return [key, JSON.parse(unescape(value))];
                        } catch {
                            return [key, unescape(value)];
                        }
                    }),
                );
                if (child) {
                    data.message = toString(child).map(({ type, data }) => ({ type, ...data }));
                }
                result.push({
                    type: type,
                    data,
                });
            }
            if (template.length) {
                result.push({
                    type: 'text',
                    data: {
                        text: unescape(template),
                    },
                });
            }
            return result;
        }
        return content.reduce((result,item)=>{
            result.push(...toString(item))
            return result;
        },[] as MessageSegment[])
    }
    export function raw(content:SendContent){
        if(!Array.isArray(content)) content=[content]
        return content.map(item=>{
            if(typeof item==='string') return item
            const {type,data}=item
            if(type==='text') return data.text
            return data.text?`{${type}}(${data.text})`:`{${type}}`;
        }).join('')
    }
    export function toString(content:SendContent){
        if(!Array.isArray(content)) content=[content]
        return content.map(item=>{
            if(typeof item==='string') return item
            const {type,data}=item
            if(type==='text') return data.text
            return `<${type} ${Object.keys(data).map(key=>`${key}='${escape(JSON.stringify(data[key]))}'`).join(' ')}/>`
        }).join('')
    }
}

export function remove<T>(list: T[], fn: (item: T) => boolean): void;
export function remove<T>(list: T[], item: T): void;
export function remove<T>(list: T[], arg: T | ((item: T) => boolean)) {
    const index =
        typeof arg === 'function' && !list.every(item => typeof item === 'function')
            ? list.findIndex(arg as (item: T) => boolean)
            : list.indexOf(arg as T);
    if (index !== -1) list.splice(index, 1);
}
export function isEmpty<T>(item:T){
    if(Array.isArray(item)) return item.length===0
    if(typeof item==='object'){
        if(!item) return true
        return Reflect.ownKeys(item).length===0
    }
    return false
}

export namespace Time {
    export const millisecond = 1;
    export const second = 1000;
    export const minute = second * 60;
    export const hour = minute * 60;
    export const day = hour * 24;
    export const week = day * 7;

    let timezoneOffset = new Date().getTimezoneOffset();

    export function setTimezoneOffset(offset: number) {
        timezoneOffset = offset;
    }

    export function getTimezoneOffset() {
        return timezoneOffset;
    }

    export function getDateNumber(date: number | Date = new Date(), offset?: number) {
        if (typeof date === 'number') date = new Date(date);
        if (offset === undefined) offset = timezoneOffset;
        return Math.floor((date.valueOf() / minute - offset) / 1440);
    }

    export function fromDateNumber(value: number, offset?: number) {
        const date = new Date(value * day);
        if (offset === undefined) offset = timezoneOffset;
        return new Date(+date + offset * minute);
    }

    const numeric = /\d+(?:\.\d+)?/.source;
    const timeRegExp = new RegExp(
        `^${['w(?:eek(?:s)?)?', 'd(?:ay(?:s)?)?', 'h(?:our(?:s)?)?', 'm(?:in(?:ute)?(?:s)?)?', 's(?:ec(?:ond)?(?:s)?)?']
            .map(unit => `(${numeric}${unit})?`)
            .join('')}$`,
    );

    export function parseTime(source: string) {
        const capture = timeRegExp.exec(source);
        if (!capture) return 0;
        return (
            (parseFloat(capture[1]) * week || 0) +
            (parseFloat(capture[2]) * day || 0) +
            (parseFloat(capture[3]) * hour || 0) +
            (parseFloat(capture[4]) * minute || 0) +
            (parseFloat(capture[5]) * second || 0)
        );
    }

    export function parseDate(date: string) {
        const parsed = parseTime(date);
        if (parsed) {
            date = (Date.now() + parsed) as any;
        } else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) {
            date = `${new Date().toLocaleDateString()}-${date}`;
        } else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) {
            date = `${new Date().getFullYear()}-${date}`;
        }
        return date ? new Date(date) : new Date();
    }

    export function formatTimeShort(ms: number) {
        const abs = Math.abs(ms);
        if (abs >= day - hour / 2) {
            return Math.round(ms / day) + 'd';
        } else if (abs >= hour - minute / 2) {
            return Math.round(ms / hour) + 'h';
        } else if (abs >= minute - second / 2) {
            return Math.round(ms / minute) + 'm';
        } else if (abs >= second) {
            return Math.round(ms / second) + 's';
        }
        return ms + 'ms';
    }

    export function formatTime(ms: number) {
        let result: string;
        if (ms >= day - hour / 2) {
            ms += hour / 2;
            result = Math.floor(ms / day) + ' 天';
            if (ms % day > hour) {
                result += ` ${Math.floor((ms % day) / hour)} 小时`;
            }
        } else if (ms >= hour - minute / 2) {
            ms += minute / 2;
            result = Math.floor(ms / hour) + ' 小时';
            if (ms % hour > minute) {
                result += ` ${Math.floor((ms % hour) / minute)} 分钟`;
            }
        } else if (ms >= minute - second / 2) {
            ms += second / 2;
            result = Math.floor(ms / minute) + ' 分钟';
            if (ms % minute > second) {
                result += ` ${Math.floor((ms % minute) / second)} 秒`;
            }
        } else {
            result = Math.round(ms / second) + ' 秒';
        }
        return result;
    }

    const dayMap = ['日', '一', '二', '三', '四', '五', '六'];

    function toDigits(source: number, length = 2) {
        return source.toString().padStart(length, '0');
    }

    export function template(template: string, time = new Date()) {
        return template
            .replace('yyyy', time.getFullYear().toString())
            .replace('yy', time.getFullYear().toString().slice(2))
            .replace('MM', toDigits(time.getMonth() + 1))
            .replace('dd', toDigits(time.getDate()))
            .replace('hh', toDigits(time.getHours()))
            .replace('mm', toDigits(time.getMinutes()))
            .replace('ss', toDigits(time.getSeconds()))
            .replace('SSS', toDigits(time.getMilliseconds(), 3));
    }

    function toHourMinute(time: Date) {
        return `${toDigits(time.getHours())}:${toDigits(time.getMinutes())}`;
    }

    export function formatTimeInterval(time: Date, interval?: number) {
        if (!interval) {
            return template('yyyy-MM-dd hh:mm:ss', time);
        } else if (interval === day) {
            return `每天 ${toHourMinute(time)}`;
        } else if (interval === week) {
            return `每周${dayMap[time.getDay()]} ${toHourMinute(time)}`;
        } else {
            return `${template('yyyy-MM-dd hh:mm:ss', time)} 起每隔 ${formatTime(interval)}`;
        }
    }
}
export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}