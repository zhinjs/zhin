import { Plugin } from 'zhin';
import type {} from '@zhinjs/adapter-onebot-12';
const groupManage = new Plugin({
  name: '群管理',
  adapters: ['onebot-12'],
});
const groupCommand = groupManage.command('群管理').desc('群操作模块');
groupCommand
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
  .action<'onebot-12'>(async ({ bot, options, message }) => {
    const thumbSuccess = await bot.sendLike(message.sender.user_id + '', options.times);
    return thumbSuccess ? '给你赞好啦' : '不能赞了';
  });
groupCommand
  .command('pin [message_id:string]')
  .desc('置顶群消息')
  .alias('置顶')
  .permission('admin', 'master')
  .scope('group')
  .action<'onebot-12'>(async ({ bot, message }, message_id) => {
    if (!message_id) message_id = message.quote?.message_id!;
    if (!message_id) return '请输入消息id或引用需要置顶的消息';
    const result = await bot.setEssenceMessage(message_id);
    return result === message_id ? '已置顶' : '置顶失败';
  });
groupCommand
  .command('unPin [message_id:string]')
  .desc('取消置顶群消息')
  .alias('取消置顶')
  .permission('admin', 'master')
  .scope('group')
  .action<'onebot-12'>(async ({ bot, message }, message_id) => {
    if (!message_id) message_id = message.quote?.message_id!;
    if (!message_id) return '请输入消息id或引用需要取消置顶的消息';
    const result = await bot.removeEssenceMessage(message_id);
    return result === message_id ? '取消置顶失败' : '已取消置顶';
  });
groupCommand
  .command('mute [user_id:user_id]')
  .desc('禁言群成员')
  .permission('admin', 'master')
  .scope('group')
  .option('-t [time:number] 禁言时长,单位秒', 10)
  .action<'onebot-12'>(async ({ bot, message, options }, user_id) => {
    await bot.setGroupBan(message.group_id + '', user_id + '', options.time as number);
    return `已尝试将(${user_id})禁言时长设为${options.time}秒`;
  });
groupCommand
  .command('kick [user_id:user_id]')
  .desc('踢出群成员')
  .permission('admin', 'master')
  .scope('group')
  .action<'onebot-12'>(async ({ bot, message }, user_id) => {
    const isSuccess = await bot.setGroupKick(message.group_id + '', user_id + '');
    return isSuccess ? `已踢出用户 ${user_id}` : '踢出失败';
  });
groupCommand
  .command('setAdmin [user_id:user_id]')
  .desc('设置/取消设置群管理')
  .option('-c <cancel:boolean>', false)
  .permission('master')
  .scope('group')
  .action<'onebot-12'>(async ({ bot, message, options }, user_id) => {
    const isSuccess = await bot.setGroupAdmin(message.group_id + '', user_id + '', !options.cancel);
    return isSuccess ? `已${options.cancel ? '取消' : ''}设置管理员 ${user_id}` : '设置管理员失败';
  });
groupCommand
  .command('setTitle <user_id:user_id> <title:string>')
  .desc('设置/取消设置群头衔')
  .permission('admin', 'master')
  .option('-t <time:number>', -1)
  .option('-c <cancel:boolean>', false)
  .scope('group')
  .action<'onebot-12'>(async ({ bot, message, options }, user_id, title) => {
    if (options.cancel) options.time = 0;
    const isSuccess = await bot.setGroupSpecialTitle(message.group_id + '', user_id, title, options.time);
    return isSuccess ? `已${options.cancel ? '取消' : ''}设置头衔 ${user_id}` : '设置头衔失败';
  });
groupCommand
  .command('setNotice <notice:string>')
  .desc('设置设置群公告')
  .permission('admin', 'master')
  .scope('group')
  .action<'onebot-12'>(async ({ bot, message }, notice) => {
    const isSuccess = await bot.sendGroupNotice(message.group_id + '', notice);
    return isSuccess ? '设置公告成功' : '设置公告失败';
  });
groupCommand
  .command('setAnonymous')
  .desc('开启/关闭群匿名')
  .permission('admin', 'master')
  .scope('group')
  .option('-c <cancel:boolean>', false)
  .action<'onebot-12'>(async ({ bot, message, options }) => {
    const isSuccess = await bot.setGroupAnonymous(message.group_id + '', !options.cancel);
    return isSuccess ? `已${options.cancel ? '开启' : '关闭'}群匿名` : '管理群匿名失败';
  });
groupCommand
  .command('setCard [user_id:user_id] [card:string]')
  .desc('设置/取消设置群名片')
  .permission('admin', 'master')
  .scope('group')
  .action<'onebot-12'>(async ({ bot, message }, user_id, card) => {
    const isSuccess = await bot.setGroupCard(message.group_id + '', user_id + '', card);
    return isSuccess ? `已${!card ? '取消' : ''}设置名片 ${user_id}` : '设置名片失败';
  });
groupCommand
  .command('setName [name:string]')
  .desc('修改群名称')
  .permission('admin', 'master')
  .scope('group')
  .action<'onebot-12'>(async ({ bot, message }, name) => {
    const isSuccess = await bot.setGroupName(message.group_id + '', name);
    return isSuccess ? '修改成功' : '修改失败';
  });
groupCommand
  .command('申请群头衔 [name:string]')
  .scope('group')
  .action<'onebot-12'>(async ({ bot, message, options }, name) => {
    const isSuccess = await bot.setGroupSpecialTitle(message.group_id + '', message.sender.user_id + '', name);
    return isSuccess ? `申请成功！你的头衔是:${name}` : '申请失败';
  });
groupCommand
  .command('sendPoke [user_id:user_id]')
  .desc('发送戳一戳')
  .alias('戳')
  .scope('group')
  .action<'onebot-12'>(async ({ bot, message }, user_id) => {
    const isSuccess = await bot.sendGroupPoke(message.group_id + '', user_id + '');
    return isSuccess ? '发送成功' : '发送失败';
  });
export default groupManage;
