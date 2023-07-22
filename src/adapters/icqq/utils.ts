import {
    AtElem,
    Client,
    FaceElem,
    FlashElem,
    ForwardNode,
    ImageElem,
    JsonElem,
    LocationElem,
    MessageElem,
    MusicElem,
    PokeElem,
    QuoteElem,
    ReplyElem,
    Sendable,
    ShareElem,
    TextElem,
    VideoElem,
    XmlElem,
} from "icqq";
import { Element } from "@";
import { remove } from "@zhinjs/shared";
import { MfaceElem, PttElem } from "icqq/lib/message/elements";

export function toString<S>(msgList: Sendable) {
    if (!msgList) return "";
    msgList = [].concat(msgList);
    return msgList
        .map(msg => {
            if (typeof msg === "string") return msg;
            if (msg.type === "text") return msg.text;
            let { type, ...data } = msg;
            return `<${type === "at" ? "mention" : type} ${Object.keys(data)
                .map(key => `${key === "qq" ? "user_id" : key}="${data[key]}"`)
                .join(" ")}/>`;
        })
        .join("");
}

export async function fromElement(elementList: Element[]) {
    return Element.transform<MessageElem>(elementList, {
        text({ text }, children): TextElem {
            if (text)
                return {
                    type: "text",
                    text,
                };
            return {
                type: "text",
                text: text || children?.join("") || children,
            };
        },
        image({ src, file_id, url }, children): ImageElem {
            return {
                type: "image",
                file: file_id || src || url || children?.join("") || children,
                url: src || url || children?.join("") || children,
            };
        },
        flash({ src, file_id, url }, children): FlashElem {
            return {
                type: "flash",
                file: file_id || src || url || children?.join("") || children,
                url: src || url || children?.join("") || children,
            };
        },
        record({ src, file_id, url }, children): PttElem {
            return {
                type: "record",
                file: file_id || src || url || children?.join("") || children,
                url: src || url || children?.join("") || children,
            };
        },
        video({ src, file_id, url }, children): VideoElem {
            return {
                type: "video",
                file: file_id || src || url || children?.join("") || children,
            };
        },
        music({ id, platform }): MusicElem {
            return {
                type: "music",
                id,
                platform,
            };
        },
        share({ url, title, content, image }, children): ShareElem {
            return {
                type: "share",
                url: url,
                title,
                content: content || children?.join("") || children,
                image,
            };
        },
        mention({ user_id }): AtElem {
            return {
                type: "at",
                qq: user_id,
            };
        },
        mention_all(): AtElem {
            return {
                type: "at",
                qq: "all",
            };
        },
        xml({ id, data }, children): XmlElem {
            return {
                type: "xml",
                id,
                data: data || ((children?.join("") || children) as string),
            };
        },
        json({ data }, children): JsonElem {
            return {
                type: "json",
                data: data || ((children?.join("") || children) as string),
            };
        },
        location(attrs): LocationElem {
            return {
                type: "location",
                ...attrs,
            } as LocationElem;
        },
        dice({ id, value }): MfaceElem {
            return {
                type: "dice",
                id: id || value,
            };
        },
        rps({ id, value }): MfaceElem {
            return {
                type: "rps",
                id: id || value,
            };
        },
        face({ id, text, file }): FaceElem | MessageElem {
            if (file)
                return {
                    type: "image",
                    file,
                };
            return {
                type: "face",
                id,
                text,
            };
        },
        poke({ id, value }): PokeElem {
            return {
                type: "poke",
                id: id || value,
            };
        },
        quote({ user_id, time, seq, rand, message }, children): QuoteElem {
            return {
                type: "quote",
                user_id,
                time,
                seq,
                rand,
                message: message || children?.join("") || children,
            };
        },
        reply({ id, message_id, text }, children): ReplyElem {
            return {
                type: "reply",
                id: id || message_id,
                text: text || children?.join("") || children,
            };
        },
        node({ user_id, message, user_name, time, nickname }, children): ForwardNode {
            return {
                type: "node",
                user_id,
                message: message || children,
                time,
                nickname: nickname || user_name,
            };
        },
    });
}

export async function processMessage(this: Client, fragment: Element.Fragment, source?: Element) {
    let elements = Element.toElementArray(fragment);
    const music = elements.find(e => e.type === "music");
    if (elements.filter(e => e.type === "music").length > 1)
        throw new Error("一次只能发送一个音乐元素");
    if (elements.length && music) {
        this.logger.warn("音乐元素只能单独发送");
        remove(elements, music);
    }
    const share = elements.find(e => e.type === "share");
    if (elements.filter(e => e.type === "share").length > 1)
        throw new Error("一次只能发送一个分享元素");
    if (elements.length && share) {
        this.logger.warn("分享元素只能单独发送");
        remove(elements, share);
    }
    const forwardNodes = elements.filter(e => e.type === "node") as Element[];
    if (forwardNodes.length && elements.length) {
        this.logger.warn("只能单独发送转发节点");
        elements = forwardNodes;
    }
    let quote = elements.find(e => e.type === "reply") as Element;
    const element = await fromElement(elements);
    return { element, quote: quote || source, music, share } as {
        element: MessageElem[];
        quote: Element;
        share: Element<"share">;
        music: Element<"music">;
    };
}
