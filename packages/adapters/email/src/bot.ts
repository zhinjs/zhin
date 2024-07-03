import Imap from 'node-imap';
import { createTransport, Transporter } from 'nodemailer';
import { Stream } from 'stream';
import { Attachment, HeaderValue, ParsedMail, simpleParser } from 'mailparser';
import { parse, INode, SyntaxKind } from 'html5parser';
import { Adapter, axios, Message } from 'zhin';
import { EventEmitter } from 'events';
export class Bot extends EventEmitter {
  #transport: Transporter;
  private hasStop = false;
  #imap: Imap;
  get logger() {
    return this.adapter.getLogger(this.options.username);
  }
  constructor(
    public adapter: Adapter,
    public options: Bot.Options,
  ) {
    super();
    this.#transport = createTransport({
      host: this.options.smtp.host,
      port: this.options.smtp.port,
      secure: this.options.smtp.tls,
      auth: {
        user: this.options.username,
        pass: this.options.password,
      },
    });
    this.#imap = new Imap({
      user: this.options.username,
      password: this.options.password,
      host: this.options.imap.host,
      port: this.options.imap.port,
      tls: this.options.imap.tls,
    });
    this.inBox = this.inBox.bind(this);
    this.receiveEmail = this.receiveEmail.bind(this);
  }
  private inBox(err: Error) {
    if (err) return this.logger.error(err);
    this.receiveEmail();
    this.#imap.on('mail', this.receiveEmail);
  }
  private receiveEmail() {
    // 接收并处理邮件
    this.#imap.search(['UNSEEN'], (err, uids) => {
      if (err) return this.logger.error(err);
      if (!uids?.length) return;
      this.logger.debug(`新邮件 uids：${uids.length}`);
      uids.forEach(uid => {
        this.#imap.addFlags(uid, '\\Seen', err => {
          if (err) return this.logger.error(err);
        });
      });
      // fetch email
      const mails = this.#imap.fetch(uids, { bodies: '' });
      mails.on('error', err => {
        this.logger.error(err);
      });
      mails.on('message', async msg => {
        const event = await this.#formatMessage(msg);
        this.logger.info(`recv [${event.message_type} ${event.from_id}]: ${event.raw_message}`);
        this.emit('message', event);
      });
    });
  }
  async #formatMessage(msg: Imap.ImapMessage) {
    const parsedMail = await new Promise<ParsedMail>((resolve, reject) => {
      msg.once('body', async (stream: Stream, info: Imap.ImapMessageBodyInfo) => {
        simpleParser(stream, (err, parsed) => {
          if (err) return reject(err);
          resolve(parsed);
        });
      });
    });
    return Object.assign(
      Message.fromEvent(this.adapter, this as unknown as Adapter.Bot<Bot>, parsedMail),
      Bot.formatMessageFromParsedMail.apply(this as unknown as Adapter.Bot<Bot>, [parsedMail]),
    );
  }
  async sendMessage(to: string, message: string) {
    if (this.hasStop) return;
    const attachments: SendAttachment[] = [];
    const rawMessage = decodeURIComponent(message);
    message = Bot.createEmailContent(await Bot.getAttachment(attachments, message));
    await this.#transport.sendMail({
      from: this.options.username,
      to,
      attachments,
      html: message,
    });

    this.logger.info(`send [private ${to}]: ${rawMessage}`);
  }
  start() {
    return new Promise<void>((resolve, reject) => {
      this.hasStop = false;
      this.logger.debug(`Starting ${this.options.username}`);
      const timerId = setTimeout(() => reject('启动超时'), 3000);
      const resolved = () => {
        clearTimeout(timerId);
        resolve();
      };
      this.#imap.on('ready', () => {
        this.logger.debug('IMAP 已连接');
        this.#imap.openBox('INBOX', false, this.inBox);
        resolved();
      });
      this.#imap.on('close', () => {
        if (this.hasStop) return;
        this.logger.debug('IMAP 已关闭，正在重连...');
        this.#imap.connect();
      });
      this.#imap.connect();
    });
  }
  stop() {
    this.hasStop = true;
    this.#imap.end();
  }
}
export type SendAttachment = {
  filename?: string;
  content: Buffer;
  contentType: string;
  cid?: string;
};
export namespace Bot {
  export interface Options {
    username: string;
    password: string;
    imap: ImapOptions;
    smtp: SmtpOptions;
  }
  interface ImapOptions {
    host: string;
    port: number;
    tls?: boolean;
  }
  interface SmtpOptions {
    host: string;
    port: number;
    tls?: boolean;
  }
  export type Sender = {
    user_id: string;
    user_name: string;
  };
  export interface Message {
    message_id: string;
    from_id: string;
    attachments: Attachment[];
    raw_message: string;
    headers: Map<string, HeaderValue>;
    message_type: 'private';
    subject: string;
    time: number;
    sender: Sender & { permissions: string[] };
  }
  export function formatMessageFromParsedMail(this: Adapter.Bot<Bot>, email: ParsedMail): Message {
    const [nickname, from_id] = email.from!.text.split('" <');
    return {
      message_id: email.messageId!,
      from_id: from_id.slice(0, -1),
      attachments: email.attachments,
      headers: email.headers,
      raw_message:
        HTMLToString(parse(email.html || '', { setAttributeMap: true })) || decodeURIComponent(email.text || ''),
      message_type: 'private',
      subject: email.subject!,
      time: email.date!.getTime(),
      sender: {
        user_id: from_id.slice(0, -1),
        user_name: nickname.slice(1),
        permissions: [
          this.adapter.botConfig(this)?.master === from_id.slice(0, -1) && 'master',
          this.adapter.botConfig(this)?.admins?.includes(from_id.slice(1)) && 'admins',
        ].filter(Boolean) as string[],
      },
    };
  }
  function HTMLToString(htmlNodes: INode[]) {
    if (!htmlNodes?.length) return '';
    let result = '';
    for (const htmlNode of htmlNodes) {
      if (htmlNode.type === SyntaxKind.Text) {
        result += decodeURIComponent(htmlNode.value).trim();
        continue;
      }
      switch (htmlNode.name) {
        case 'a':
          result += `<link href="${htmlNode.attributeMap?.href?.value?.value || '#'}" text="${HTMLToString(
            htmlNode.body || [],
          )}">`;
          break;
        case 'strong':
        case 'b':
        case 's':
        case 'del':
        case 'i':
        case 'em':
        case 'p':
        case 'sub':
        case 'u':
          result += HTMLToString(htmlNode.body || []);
          break;
        case 'br':
          result += '\n';
          break;
        case 'ul':
        case 'img':
          const src = htmlNode.attributeMap?.src?.value?.value || '';
          const alt = htmlNode.attributeMap?.alt?.value?.value || '';
          if (!src) {
            result += alt || '';
            break;
          }
          result += `<image url="${src}">`;
          break;
        case 'head':
        case 'script':
        case 'style':
        case 'meta':
          break;
        default:
          result += HTMLToString(htmlNode.body || []);
      }
    }
    return result;
  }
  async function getBase64ByUrl(url: string) {
    const response: Buffer = await axios.get<Buffer>(url, {
      responseType: 'arraybuffer',
    });
    return Buffer.from(response).toString('base64');
  }
  export async function getAttachment(attachment: SendAttachment[], source: string): Promise<string> {
    let type = '',
      url = '',
      originContent = '';
    do {
      [originContent, type, url] = /<file type="([^"]+)" url="([^"]+)">/g.exec(source) || ['', '', ''];
      if (!type || !url) break;
      source = source.replace(originContent, '');
      if (/^https?:\/\//.test(url)) url = await getBase64ByUrl(url);
      attachment.push({
        filename: decodeURIComponent(url.split('/').pop() || ''),
        content: Buffer.from(url, 'base64'),
        contentType: type,
        cid: `cid:${url.split('/').pop() || ''}`,
      });
    } while (type && url);

    return source;
  }
  export function createEmailContent(message: string): string {
    return decodeURIComponent(
      message.replace(/<image url="([^"]+)">/g, (match, url) => {
        return `<img src="cid:${url}">`;
      }),
    )
      .split('\n')
      .join('<br />');
  }
}
