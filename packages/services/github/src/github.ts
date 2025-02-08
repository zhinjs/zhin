import { Dict, Plugin, axios, Message, parseFromTemplate } from 'zhin';
declare module 'zhin' {
  namespace Message {
    interface Sender {
      github_accessToken?: string;
      github_refreshToken?: string;
    }
  }
}
export type ReplyPayloads = {
  [K in keyof ReplyHandler]?: ReplyHandler[K] extends (...args: infer P) => any ? P : never;
};
type Method =
  | 'get'
  | 'GET'
  | 'delete'
  | 'DELETE'
  | 'head'
  | 'HEAD'
  | 'options'
  | 'OPTIONS'
  | 'post'
  | 'POST'
  | 'put'
  | 'PUT'
  | 'patch'
  | 'PATCH'
  | 'purge'
  | 'PURGE'
  | 'link'
  | 'LINK'
  | 'unlink'
  | 'UNLINK';

export class GitHub {
  public history: Dict<ReplyPayloads> = Object.create(null);
  private http: ReturnType<typeof axios.create>;

  constructor(
    public plugin: Plugin,
    public config: Config,
  ) {
    this.http = axios.create();
    this.init();
  }

  async init() {}

  async getTokens(params: any) {
    return this.http.post(
      'https://github.com/login/oauth/access_token',
      {},
      {
        params: {
          client_id: this.config.appId,
          client_secret: this.config.appSecret,
          ...params,
        },
        headers: { Accept: 'application/json' },
        timeout: this.config.requestTimeout,
      },
    );
  }

  private async _request(method: Method, url: string, replyMsg: Message, data?: any, headers?: Dict) {
    this.plugin.logger.debug(method, url, data);
    return this.http(url, {
      data,
      methods: method,
      headers: {
        accept: 'application/vnd.github.v3+json',
        authorization: `token ${replyMsg.sender.github_accessToken}`,
        ...headers,
      },
      timeout: this.config.requestTimeout,
    });
  }

  async authorize(message: Message, raw_message: string) {
    const name = await message.prompt.text(raw_message);
    if (name) {
      message.raw_message = `github authorize ${name}`;
      await this.plugin.executeCommand(message);
    } else {
      await message.reply('输入超时');
    }
  }

  async request(method: Method, url: string, message: Message, body?: any, headers?: Dict) {
    if (message.message_type !== 'group') return '只能在群聊中使用';
    if (!message.sender.github_accessToken) {
      return this.authorize(message, '要使用此功能，请对机器人进行授权。输入你的 GitHub 用户名。');
    }

    try {
      return await this._request(method, url, message, body, headers);
    } catch (error: any) {
      if (error.response?.status !== 401) throw error;
    }

    try {
      const data = await this.getTokens({
        refresh_token: message.sender.github_refreshToken,
        grant_type: 'refresh_token',
      });
      message.sender.github_accessToken = data.access_token;
      message.sender.github_refreshToken = data.refresh_token;
    } catch {
      return this.authorize(message, '令牌已失效，需要重新授权。输入你的 GitHub 用户名。');
    }

    return await this._request(method, url, message, body, headers);
  }
}

export interface Config {
  path?: string;
  appId?: string;
  appSecret?: string;
  messagePrefix?: string;
  redirect?: string;
  promptTimeout?: number;
  replyTimeout?: number;
  requestTimeout?: number;
}

export class ReplyHandler {
  constructor(
    public github: GitHub,
    public ctxMessage: Message,
    public content?: string,
  ) {}

  async request(method: Method, url: string, message: string, body?: any, headers?: Dict) {
    try {
      await this.github.request(method, url, this.ctxMessage, body, headers);
    } catch (err) {
      return message;
    }
  }

  link(url: string) {
    return url;
  }

  react(url: string) {
    return this.request(
      'POST',
      url,
      '发送失败',
      {
        content: this.content,
      },
      {
        accept: 'application/vnd.github.squirrel-girl-preview',
      },
    );
  }

  async transform(source: string) {
    const [
      {
        type,
        data: { url, text },
      },
    ] = parseFromTemplate(source);
    return type !== 'image' ? text : `![${text}](${url})`;
  }

  async reply(url: string, params?: Dict) {
    return this.request('POST', url, '发送失败', {
      body: await this.transform(this.content!),
      ...params,
    });
  }

  base(url: string) {
    return this.request('PATCH', url, '修改失败', {
      base: this.content,
    });
  }

  merge(url: string, method?: 'merge' | 'squash' | 'rebase') {
    const [title] = this.content!.split('\n', 1);
    const message = this.content!.slice(title.length);
    return this.request('PUT', url, '操作失败。', {
      merge_method: method,
      commit_title: title.trim(),
      commit_message: message.trim(),
    });
  }

  rebase(url: string) {
    return this.merge(url, 'rebase');
  }

  squash(url: string) {
    return this.merge(url, 'squash');
  }

  async close(url: string, commentUrl: string) {
    if (this.content) await this.reply(commentUrl);
    await this.request('PATCH', url, '操作失败', {
      state: 'closed',
    });
  }
}
