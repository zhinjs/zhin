import {Client, MessageElem, Sendable, ShareElem} from "icqq";
import {Element} from "@";
import {remove} from "@zhinjs/shared";

export function toElement<S>(msgList: Sendable, ctx?: S) {
    if (!msgList) return []
    msgList = [].concat(msgList)
    let result: Element[] = []
    msgList.forEach((msg) => {
        if (typeof msg === 'string') return result.push(Element('text',{text:msg}))
        if (msg.type === "text") {
            result.push(...Element.parse(msg.text, ctx))
        } else {
            let {type, ...attrs} = msg;
            result.push(Element(type === 'at' ? attrs['qq'] ? 'mention' : "mention_all" : type, {
                user_id: attrs['qq'],
                file: attrs['file_id'] || attrs['src'],
                content: attrs['text'],
                ...attrs
            }))
        }
    })
    return result
}

const allowElement = ['text', 'at','record','video', 'image', 'face', 'xml', 'json', 'rps', 'dice']

export function fromElement(elementList: Element[]) {
    return elementList.map((element) => {
        if (typeof element === 'string') {
            return {type: 'text', text: element}
        }
        const {type, attrs, children} = element;
        const result = {
            type: type.replace('mention', 'at').replace('at_all', 'at'),
            ...attrs,
            text: attrs.text || children.join('')
        }
        if (allowElement.includes(result.type)) {
            if (attrs['user_id']) result['qq'] = attrs['user_id']
            if (attrs['file_id']) result['file'] = attrs['file_id']
            if (attrs['src']) result['file'] = attrs['src']
            return result
        }
        return element.toString()
    }) as MessageElem[]
}

export async function processMessage(this: Client, message: Element.Fragment, source?: Element) {
    let segments: Element[] = [].concat(message).map(m => {
        if (typeof m === 'string') return {type: 'text', attrs: {text: m}}
        return m
    })

    const music = segments.find(e => e.type === 'music')
    if(music) remove(segments,music)
    if(segments.find(e => e.type === 'music')) throw new Error('一次只能发送一个音乐元素')
    if(segments.length && music) throw new Error('音乐元素只能单独发送')
    const share = segments.find(e => e.type === 'share')
    if(share) remove(segments,share)
    if(segments.find(e => e.type === 'share')) throw new Error('一次只能发送一个分享元素')
    if(segments.length && share) throw new Error('分享元素只能单独发送')
    const forwardNodes = segments.filter(e => e.type === 'node') as Element[]
    segments=segments.filter(s=>!forwardNodes.includes(s))
    if(forwardNodes.length && segments.length) throw new Error('只能单独发送转发节点')
    let quote = segments.find(e => e.type === 'reply') as Element
    if (quote) remove(segments, quote)
    segments = segments.filter(n => [
        'face', 'text', 'image',// 基础类
        'rpx', 'dice', 'poke', 'mention', 'mention_all', // 功能类
        'voice', 'file', 'record',// 音视频类
        'forward','node',// 转发类
        'music', 'share', 'xml', 'json', 'location', // 分享类
    ].includes(n.type))
    const element = fromElement(segments)
    if (forwardNodes.length) element.unshift(
        // 构造转发消息
        await this.makeForwardMsg(
            await Promise.all(
                // 处理转发消息段
                forwardNodes.map(
                    async (forwardNode) => {
                        return {
                            // 转发套转发处理
                            message: (await processMessage.apply(this, [forwardNode.children||forwardNode.attrs.message||[]])).element,
                            user_id: Number(forwardNode.attrs.user_id),
                            nickname: forwardNode.attrs.user_name,
                            time: forwardNode.attrs.time
                        }
                    }
                )
            )
        )
    )
    return {element, quote: quote || source,music,share} as { element: MessageElem[], quote: Element,share:Element<'share'>,music:Element<'music'> }
}