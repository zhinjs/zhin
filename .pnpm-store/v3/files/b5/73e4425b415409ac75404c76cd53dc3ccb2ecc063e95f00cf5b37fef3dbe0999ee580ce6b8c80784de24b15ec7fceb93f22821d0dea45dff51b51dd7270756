"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Message = void 0;
const qqBot_1 = require("./qqBot");
const utils_1 = require("./utils");
class Message {
    get self_id() {
        return this.bot.self_id;
    }
    constructor(bot, attrs) {
        this.bot = bot;
        this.sub_type = 'normal';
        const { message_reference, ...other_attrs } = attrs;
        Object.assign(this, other_attrs);
        if (message_reference)
            this.source = {
                id: message_reference.message_id,
                message_id: message_reference.message_id,
            };
    }
    get [Symbol.unscopables]() {
        return {
            bot: true
        };
    }
    toJSON() {
        return Object.fromEntries(Object.keys(this)
            .filter(key => {
            return typeof this[key] !== "function" && !(this[key] instanceof qqBot_1.QQBot);
        })
            .map(key => [key, this[key]]));
    }
}
exports.Message = Message;
(function (Message) {
    function parse(payload) {
        let template = payload.content || '';
        let result = [];
        let brief = '';
        // 1. 处理文字表情混排
        const regex = /("[^"]*?"|'[^']*?'|`[^`]*?`|“[^”]*?”|‘[^’]*?’|<[^>]+?>)/;
        if (payload.message_reference) {
            result.push({
                type: 'reply',
                id: payload.message_reference.message_id
            });
            brief += `<reply,id=${payload.message_reference.message_id}>`;
        }
        while (template.length) {
            const [match] = template.match(regex) || [];
            if (!match)
                break;
            const index = template.indexOf(match);
            const prevText = template.slice(0, index);
            if (prevText) {
                result.push({
                    type: 'text',
                    text: prevText
                });
                brief += prevText;
            }
            template = template.slice(index + match.length);
            if (match.startsWith('<')) {
                let [type, ...attrs] = match.slice(1, -1).split(',');
                if (type.startsWith('faceType')) {
                    type = 'face';
                    attrs = attrs.map((attr) => attr.replace('faceId', 'id'));
                }
                else if (type.startsWith('@')) {
                    if (type.startsWith('@!')) {
                        const id = type.slice(2);
                        type = 'at';
                        attrs = Object.entries(payload.mentions.find((u) => u.id === id) || {})
                            .map(([key, value]) => `${key === 'id' ? 'user_id' : key}=${value}`);
                    }
                    else if (type === '@everyone') {
                        type = 'at';
                        attrs = ['user_id=all'];
                    }
                }
                else if (/^[a-z]+:[0-9]+$/.test(type)) {
                    attrs = ['id=' + type.split(':')[1]];
                    type = 'face';
                }
                if ([
                    'text',
                    'face',
                    'at',
                    'image',
                    'video',
                    'audio',
                    'markdown',
                    'button',
                    'link',
                    'reply',
                    'ark',
                    'embed'
                ].includes(type)) {
                    result.push({
                        type,
                        ...Object.fromEntries(attrs.map((attr) => {
                            const [key, ...values] = attr.split('=');
                            return [key.toLowerCase(), (0, utils_1.trimQuote)(values.join('='))];
                        }))
                    });
                    brief += `<${type},${attrs.join(',')}>`;
                }
                else {
                    result.push({
                        type: 'text',
                        text: match
                    });
                }
            }
            else {
                result.push({
                    type: "text",
                    text: match
                });
                brief += match;
            }
        }
        if (template) {
            result.push({
                type: 'text',
                text: template
            });
            brief += template;
        }
        // 2. 将附件添加到消息中
        if (payload.attachments) {
            for (const attachment of payload.attachments) {
                let { content_type, ...data } = attachment;
                const [type] = content_type.split('/');
                if (!data.url.startsWith('http'))
                    data.url = `https://${data.url}`;
                if (data.filename) {
                    data.name = data.filename;
                    delete data.filename;
                }
                result.push({
                    type,
                    ...data,
                });
                brief += `<${type},${Object.entries(data).map(([key, value]) => `${key}=${value}`).join(',')}>`;
            }
        }
        delete payload.attachments;
        delete payload.mentions;
        return [result, brief];
    }
    Message.parse = parse;
})(Message || (exports.Message = Message = {}));
