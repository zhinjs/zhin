import { Plugin } from 'zhin';
import type {} from '@zhinjs/adapter-qq';

const guildManage = new Plugin({
  name: '频道管理',
  adapters: ['qq'],
});
guildManage
  .command('置顶 [message_id:string]')
  .permission('admin')
  .scope('guild')
  .action<'qq'>(async ({ bot, message }, message_id) => {
    if (!message_id) message_id = message.quote?.message_id as string;
    if (!message_id) return '请输入消息id或引用需要置顶的消息';
    const [_type, channel_id] = message.channel.split(':');
    const result = await bot.internal.pinChannelMessage(channel_id, message_id);
    return result?.message_ids?.includes(message_id) ? '已置顶' : '置顶失败';
  });
guildManage
  .command('取消置顶 [message_id:string]')
  .permission('admin')
  .scope('guild')
  .action<'qq'>(async ({ bot, message }, message_id) => {
    if (!message_id) message_id = message.quote?.message_id as string;
    if (!message_id) return '请输入消息id或引用需要取消置顶的消息';
    const [_type, channel_id] = message.channel.split(':');
    const result = await bot.internal.unPinChannelMessage(channel_id, message_id);
    return result ? '已取消置顶' : '取消置顶失败';
  });
export default guildManage;
