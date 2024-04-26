import { Plugin, segment } from 'zhin';
import { OneBotV12Adapter } from '@zhinjs/onebot-12';
type RepeatInfo = {
  unique_id: string;
  group_id: string;
  last_text: string;
  repeat_count: number;
};
type BanInfo = {
  unique_id: string;
  group_id: string;
  user_id: string;
  ban_count: number;
};
export default (plugin: Plugin) => {
  plugin.command('禁止复读').action(async ({ bot, message }) => {
    if (message.message_type !== 'group') return '请在群聊中使用';
    const curChannel = `${bot.unique_id}:${message.from_id}`;
    const isOpen = plugin.jsondb.get<string[]>('functions.banRepeat', [])?.find(channel => {
      return channel === curChannel;
    });
    if (isOpen) return segment.text('重复操作');
    plugin.jsondb.push<string>('functions.banRepeat', curChannel);
    return `当前群聊已禁止复读，请勿复读消息`;
  });
  plugin.command('允许复读').action(async ({ bot, message }) => {
    if (message.message_type !== 'group') return '请在群聊中使用';
    const curChannel = `${bot.unique_id}:${message.from_id}`;
    const isOpen = plugin.jsondb.get<string[]>('functions.banRepeat', [])?.find(channel => {
      return channel === curChannel;
    });
    if (!isOpen) return segment.text('当前群聊尚未禁止复读，无需操作');
    plugin.jsondb.remove<string>('functions.banRepeat', curChannel);
    return `当前群聊已允许复读，别刷屏哦`;
  });

  plugin.middleware<OneBotV12Adapter>(async (adapter, bot, event, next) => {
    await next();
    if (event.message_type !== 'group') return;
    const {
      from_id,
      raw_message,
      sender: { user_id },
    } = event;
    const curChannel = `${bot.unique_id}:${event.from_id}`;
    const isOpen = plugin.jsondb.get<string[]>('functions.banRepeat', [])?.find(channel => {
      return channel === curChannel;
    });
    if (!isOpen) return;
    const repeatInfo = plugin.jsondb.get<RepeatInfo[]>('group_repeat_infos', [])?.find(info => {
      return info.unique_id === bot.unique_id && info.group_id === from_id;
    });
    if (!repeatInfo)
      return plugin.jsondb.push<RepeatInfo>('group_repeat_infos', {
        unique_id: bot.unique_id,
        group_id: from_id,
        last_text: raw_message,
        repeat_count: 0,
      });
    if (repeatInfo.last_text !== raw_message)
      return plugin.jsondb.replace('group_repeat_infos', repeatInfo, {
        ...repeatInfo,
        last_text: raw_message,
        repeat_count: 0,
      });
    plugin.jsondb.replace<RepeatInfo>('group_repeat_infos', repeatInfo, {
      ...repeatInfo,
      repeat_count: repeatInfo.repeat_count + 1,
    });
    if (repeatInfo.repeat_count <= 2) return;
    let banInfo = plugin.jsondb.get<BanInfo[]>('group_ban_infos', [])?.find(info => {
      return info.unique_id === bot.unique_id && info.group_id === from_id && info.user_id === user_id;
    });
    if (!banInfo)
      plugin.jsondb.push<BanInfo>(
        'group_ban_infos',
        (banInfo = {
          unique_id: bot.unique_id,
          group_id: from_id,
          user_id: user_id + '',
          ban_count: 0,
        }),
      );
    bot.setGroupBan(from_id, user_id + '', 30 + banInfo.ban_count * 10);
    plugin.jsondb.replace('group_ban_infos', banInfo, {
      ...banInfo,
      ban_count: banInfo.ban_count + 1,
    });
  });
};
