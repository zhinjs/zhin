import { Plugin } from 'zhin';
import { ICQQAdapter } from '@zhinjs/icqq';

const groupManage = new Plugin({
  name: '群管理',
  adapters: ['icqq'],
});
groupManage
  .command('thumbMe')
  .desc('给指定用户点赞')
  .alias('赞我')
  .sugar(/^赞我(\d+)次$/, {
    options: {
      times: '$1',
    },
  })
  .option('-t <times:number>', 10)
  .scope('group')
  .action<ICQQAdapter>(async ({ bot, options, message }) => {
    const thumbSuccess = await bot.sendLike(parseInt('' + message.sender.user_id), options.times);
    return thumbSuccess ? '给你赞好啦' : '不能赞了';
  });
groupManage
  .command('pin [message_id:string]')
  .desc('置顶群消息')
  .alias('置顶')
  .permission('admin')
  .scope('group')
  .action<ICQQAdapter>(async ({ bot, message }, message_id) => {
    if (!message_id) message_id = message.quote?.message_id!;
    if (!message_id) return '请输入消息id或引用需要置顶的消息';
    const result = await bot.setEssenceMessage(message_id);
    return result ? '已置顶' : '置顶失败';
  });
groupManage
  .command('unPin [message_id:string]')
  .desc('取消置顶群消息')
  .alias('取消置顶')
  .permission('admin')
  .scope('group')
  .action<ICQQAdapter>(async ({ bot, message }, message_id) => {
    if (!message_id) message_id = message.quote?.message_id!;
    if (!message_id) return '请输入消息id或引用需要取消置顶的消息';
    const result = await bot.removeEssenceMessage(message_id);
    return result ? '已取消置顶' : '取消置顶失败';
  });
groupManage
  .command('mute [user_id:user_id]')
  .desc('禁言群成员')
  .permission('admin')
  .scope('group')
  .option('-t [time:number] 禁言时长,单位秒', 10)
  .action<ICQQAdapter>(async ({ bot, message, options }, user_id) => {
    const result = await bot.setGroupBan(+message.group_id!, +user_id, options.time as number);
    return `已尝试将(${user_id})禁言时长设为${options.time}秒`;
  });
groupManage
  .command('kick [user_id:user_id]')
  .desc('踢出群成员')
  .permission('admin')
  .scope('group')
  .action<ICQQAdapter>(async ({ bot, message }, user_id) => {
    const isSuccess = await bot.setGroupKick(+message.group_id!, +user_id);
    return isSuccess ? `已踢出用户 ${user_id}` : '踢出失败';
  });
groupManage
  .command('setAdmin [user_id:user_id]')
  .desc('设置/取消设置群管理')
  .option('-c <cancel:boolean>', false)
  .permission('master')
  .scope('group')
  .action<ICQQAdapter>(async ({ bot, message, options }, user_id) => {
    const isSuccess = await bot.setGroupAdmin(+message.group_id!, +user_id, !options.cancel);
    return isSuccess ? `已${options.cancel ? '取消' : ''}设置管理员 ${user_id}` : '设置管理员失败';
  });
groupManage
  .command('setTitle <user_id:user_id> <title:string>')
  .desc('设置/取消设置群头衔')
  .permission('admin')
  .option('-t <time:number>', -1)
  .option('-c <cancel:boolean>', false)
  .scope('group')
  .action<ICQQAdapter>(async ({ bot, message, options }, user_id, title) => {
    if (options.cancel) options.time = 0;
    const isSuccess = await bot.setGroupSpecialTitle(+message.group_id!, +user_id, title, options.time);
    return isSuccess ? `已${options.cancel ? '取消' : ''}设置头衔 ${user_id}` : '设置头衔失败';
  });
groupManage
  .command('setNotice <notice:string>')
  .desc('设置设置群公告')
  .permission('admin')
  .scope('group')
  .action<ICQQAdapter>(async ({ bot, message }, notice) => {
    const isSuccess = await bot.sendGroupNotice(+message.group_id!, notice);
    return isSuccess ? '设置公告成功' : '设置公告失败';
  });
groupManage
  .command('setAnonymous')
  .desc('开启/关闭群匿名')
  .permission('admin')
  .scope('group')
  .option('-c <cancel:boolean>', false)
  .action<ICQQAdapter>(async ({ bot, message, options }) => {
    const isSuccess = await bot.setGroupAnonymous(+message.group_id!, !options.cancel);
    return isSuccess ? `已${options.cancel ? '开启' : '关闭'}群匿名` : '管理群匿名失败';
  });
groupManage
  .command('setCard [user_id:user_id] [card:string]')
  .desc('设置/取消设置群名片')
  .permission('admin')
  .scope('group')
  .action<ICQQAdapter>(async ({ bot, message }, user_id, card) => {
    const isSuccess = await bot.setGroupCard(+message.group_id!, +user_id, card);
    return isSuccess ? `已${!card ? '取消' : ''}设置名片 ${user_id}` : '设置名片失败';
  });
groupManage
  .command('addMe [comment:string]')
  .desc('机器人主动加你为好友')
  .scope('group')
  .action<ICQQAdapter>(async ({ bot, message }, comment) => {
    const isSuccess = await bot.addFriend(+message.group_id!, +message.sender?.user_id!, comment);
    return isSuccess ? `已发向${message.sender.user_id}发起好友请求` : '发起好友请求失败';
  });
groupManage
  .command('setName [name:string]')
  .desc('修改群名称')
  .permission('admin')
  .scope('group')
  .action<ICQQAdapter>(async ({ bot, message }, name) => {
    const isSuccess = await bot.setGroupName(+message.group_id!, name);
    return isSuccess ? '修改成功' : '修改失败';
  });
groupManage
  .command('sendPoke [user_id:user_id]')
  .desc('发送戳一戳')
  .alias('戳')
  .scope('group')
  .action<ICQQAdapter>(async ({ bot, message }, user_id) => {
    const isSuccess = await bot.sendGroupPoke(+message.group_id!, +user_id);
    return isSuccess ? '发送成功' : '发送失败';
  });
export default groupManage;
