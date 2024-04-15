import { Plugin } from 'zhin';
import { OneBotV12Adapter } from '@zhinjs/onebot-12';
const forwardForum = new Plugin({
  name: '频道帖子转发插件',
  adapters: ['onebot-12'],
});
type Config = {
  guild_id: string;
  bot_id: string;
  channel_id: string;
  group_id: string;
  template: string;
};
forwardForum.required('jsondb');
forwardForum.middleware(async (adapter, bot, event, next) => {
  await next();
});
let configList: Config[] = [];
forwardForum.mounted(app => {
  const savedConfig = app.jsondb.get<Config[]>('forwardForumConfig', [])!;
  configList.push(...(savedConfig || []));
});
forwardForum.command('查看订阅').action<OneBotV12Adapter>(({ bot }) => {
  if (!configList.length) return `暂无任何转发配置，请发送“新增转发配置”按照提示新增配置`;
  return configList
    .filter(config => config.bot_id === bot.self_id)
    .map(config => {
      return (
        `订阅频道：${config.guild_id}\n` +
        `订阅话题：${config.channel_id}\n` +
        `转发到群：${config.group_id}\n` +
        `消息模板：${config.template}\n`
      );
    })
    .join('\n');
});
forwardForum.command('新增订阅').action<OneBotV12Adapter>(async ({ bot, prompt }) => {
  const guild_id = await prompt.text('请输入频道id');
  const channel_id = await prompt.text('请输入话题id');
  const group_id = await prompt.text('请输入接收的群号');
  const template = await prompt.text('请输入消息模板');
  configList.push({ guild_id, bot_id: bot.self_id, channel_id, group_id, template });
  forwardForum.app!.jsondb.set<Config[]>('forwardForumConfig', configList);
  return '新增成功，请确保邀请我到对应的频道和群，不然订阅和转发将会失败';
});
forwardForum.command('修改订阅').action<OneBotV12Adapter>(async ({ bot, prompt }) => {
  const guild_id = await prompt.text('请输入频道id');
  const channel_id = await prompt.text('请输入话题id');
  const group_id = await prompt.text('请输入接收的群号');
  const config = configList.find(
    config =>
      config.bot_id === bot.self_id &&
      config.guild_id === guild_id &&
      config.channel_id === channel_id &&
      config.group_id === group_id,
  );
  if (!config) return '未找到对应的订阅配置';
  config.template = await prompt.text('请输入消息模板');
  forwardForum.app!.jsondb.set<Config[]>('forwardForumConfig', configList);
  return '修改模板成功';
});
forwardForum.command('删除订阅').action<OneBotV12Adapter>(async ({ bot, prompt }) => {
  const guild_id = await prompt.text('请输入频道id');
  const channel_id = await prompt.text('请输入话题id');
  const group_id = await prompt.text('请输入接收的群号');
  const index = configList.findIndex(config => {
    return (
      config.bot_id === bot.self_id &&
      config.guild_id === guild_id &&
      config.channel_id === channel_id &&
      config.group_id === group_id
    );
  });
  if (index === -1) return '删除失败';
  configList.splice(index, 1);
  forwardForum.app!.jsondb.set<Config[]>('forwardForumConfig', configList);
  return '删除成功';
});
forwardForum.middleware<OneBotV12Adapter>(async (adapter, bot, event, next) => {
  await next();
  if (adapter.name !== 'onebot-12' || event.message_type !== 'guild') return;
  const message = event.original?.message;
  if (!message || !Array.isArray(message)) return;
  const [textSeg, forumSeg] = message;
  if (!forumSeg || forumSeg.type !== 'forum') return;
  const { user_id, user_name } = event.sender || {};
  const { guild_id, guild_name, channel_id, channel_name } = event.original;
  const configs = configList.filter(config => {
    return config.guild_id === String(guild_id) && config.channel_id === String(channel_id);
  });
  if (!configs.length) return;
  const forumUrl = await bot.getForumUrl(guild_id, channel_id, forumSeg.data.id);
  for (const config of configs) {
    const { group_id, template } = config;
    const message = template
      .replace('{guild_name}', guild_name)
      .replace('{guild_id}', guild_id)
      .replace('{channel_name}', channel_name)
      .replace('{channel_id}', channel_id)
      .replace('{user_name}', user_name)
      .replace('{user_id}', user_id)
      .replace('{title}', textSeg.data.text)
      .replace('{url}', forumUrl);
    await bot.sendGroupMsg(group_id, message);
  }
});
forwardForum.command('清空订阅').action<OneBotV12Adapter>(async ({ bot, prompt }) => {
  const isConfirm = await prompt.confirm('清空后无法恢复，确认清空吗?');
  if (!isConfirm) return;
  configList = configList.filter(config => config.bot_id === bot.self_id);
  forwardForum.app!.jsondb.set<Config[]>('forwardForumConfig', configList);
  return '清空成功';
});
export default forwardForum;
