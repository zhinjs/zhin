import { Plugin, Schema, segment } from 'zhin';
import type {} from '@zhinjs/plugin-http-server';
const plugin = new Plugin('Github');
plugin.waitServices('server', 'database');
const config = plugin.useConfig(
  'github',
  Schema.object({
    appId: Schema.string('Github AppId').required(),
    appSecret: Schema.string('Github AppSecret').required(),
    path: Schema.string('webhook路径').default('/github'),
    messagePrefix: Schema.string('消息前缀'),
    redirect: Schema.string('请求回调地址').default('/redirect'),
    promptTimeout: Schema.number('会话超时时间').default(60000),
    replyTimeout: Schema.number('回复超时时间').default(60000),
    requestTimeout: Schema.number('请求超时时间').default(60000),
  }),
);
plugin.mounted(app => {
  plugin.middleware(async (message, next) => {
    await next();
    const mathReg = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/?$/;
    const match = message.raw_message.match(mathReg);
    if (!match) return;
    const [, owner, repo] = match;
    const src = `https://opengraph.github.com/repo/${owner}/${repo}`;
    await message.reply(segment('image', { src }));
  });
});
export default plugin;
