import {Client, MessageElem, Sendable} from "icqq";
import {Element} from "@";
import {remove} from "@zhinjs/shared";
export async function processMusic(this: Client, target_type:string, target_id: number, element: any[]):Promise<MessageElem[]> {
    const musicList = element.filter(e => e.type === 'music')
    element = element.filter(e => !musicList.includes(e))
    const target = target_type === 'group' ? this.pickGroup(target_id) : this.pickFriend(target_id)
    if (musicList.length) await Promise.all(musicList.map(async (music) => {
        return await target.shareMusic(music.platform, music.id)
    }))
    return element
}

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

const allowElement = ['text', 'at', 'image', 'face', 'xml', 'json', 'rps', 'dice']

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
    const forward = segments.find(e => e.type === 'forward') as Element
    if (forward) remove(segments, forward)
    let quote = segments.find(e => e.type === 'reply') as Element
    if (quote) remove(segments, quote)
    segments = segments.filter(n => [
        'face', 'text', 'image',// 基础类
        'rpx', 'dice', 'poke', 'mention', 'mention_all', // 功能类
        'voice', 'file', 'audio',// 音视频类
        'forward','node',// 转发类
        'music', 'share', 'xml', 'json', 'location', // 分享类
    ].includes(n.type))
    const element = fromElement(segments)
    if (forward) element.unshift(
        // 构造抓发消息
        await this.makeForwardMsg(
            await Promise.all(
                // 处理转发消息段
                forward.children.filter(n => n.type === 'node').map(
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
    return {element, quote: quote || source} as { element: MessageElem[], quote: Element }
}