import {Client, MessageElem, Sendable, ShareElem} from "icqq";
import {Element} from "@";
import {remove} from "@zhinjs/shared";

export function toString<S>(msgList: Sendable) {
    if (!msgList) return ''
    msgList = [].concat(msgList)
    return msgList.map((msg) => {
        if (typeof msg === 'string') return msg
        if (msg.type === "text") return msg.text
        const {type,...data} = msg;
        return `<${type} ${Object.keys(data).map(key=>`${key}="${data[key]}"`).join(' ')}/>`
    }).join('')
}

const allowElement = [
    'face', 'text', 'image',// 基础类
    'rps', 'dice', 'poke', 'mention', 'mention_all', 'at', // 功能类
    'video', 'voice', 'file', 'record',// 音视频类
    'xml', 'json', 'location', // 分享类
]

export function fromElement(elementList: Element[]) {
    return elementList.map((element) => {
        if (typeof element === 'string') {
            return {type: 'text', text: element}
        }
        const {type, attrs, children} = element;
        const result = {
            type: type.replace('mention', 'at').replace('at_all', 'at'),
            ...attrs,
            text: attrs.text
        }
        if (allowElement.includes(result.type)) {
            if (attrs['user_id']) result['qq'] = attrs['user_id']
            if (attrs['file_id']) result['file'] = attrs['file_id']
            if (attrs['src']) result['file'] = attrs['src']
            if (attrs['text']) result['content'] = attrs['text']
            return result
        }
        return element.toString()
    }) as MessageElem[]
}

export async function processMessage(this: Client, content: string, source?: Element) {
    let segments = Element.parse(content)

    const music = segments.find(e => e.type === 'music')
    if (music) remove(segments, music)
    if (segments.find(e => e.type === 'music')) throw new Error('一次只能发送一个音乐元素')
    if (segments.length && music) {
        this.logger.warn('音乐元素只能单独发送')
        segments = []
    }
    const share = segments.find(e => e.type === 'share')
    if (share) remove(segments, share)
    if (segments.find(e => e.type === 'share')) throw new Error('一次只能发送一个分享元素')
    if (segments.length && share) {
        this.logger.warn('分享元素只能单独发送')
        segments = []
    }
    const forwardNodes = segments.filter(e => e.type === 'node') as Element[]
    segments = segments.filter(s => !forwardNodes.includes(s))
    if (forwardNodes.length && segments.length) {
        this.logger.warn('只能单独发送转发节点')
        segments = []
    }
    let quote = segments.find(e => e.type === 'reply') as Element
    if (quote) remove(segments, quote)
    segments = segments.filter(n => allowElement.includes(n.type))
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
                            message: (await processMessage.apply(this, [Element.stringify(forwardNode.attrs.message || forwardNode.children)])).element,
                            user_id: Number(forwardNode.attrs.user_id),
                            nickname: forwardNode.attrs.user_name,
                            time: forwardNode.attrs.time
                        }
                    }
                )
            )
        )
    )
    return {element, quote: quote || source, music, share} as {
        element: MessageElem[],
        quote: Element,
        share: Element<'share'>,
        music: Element<'music'>
    }
}
