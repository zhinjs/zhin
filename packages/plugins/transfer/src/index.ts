import { Plugin, Adapters, Message } from 'zhin';
const transferPlugin = new Plugin('问答管理');
type Transport = {
  adapter: Adapters;
  bot_id: string;
  channel: Message.Channel;
};
type TransportConfig = {
  from: Transport;
  to: Transport;
};
transferPlugin.waitServices('database', async app => {
  await app.database.get('transfer', []);
});
transferPlugin
  .command('transfer.add')
  .permission('master')
  .action(async ({ prompt, message }) => {
    const from_adapter = message.adapter.name;
    const from_bot = message.bot.unique_id;
    const from_channel = message.channel;
    const to_adapter = await prompt.pick('请选择目标适配器', {
      type: 'text',
      options: [...(transferPlugin.app?.adapters.keys() || [])].map(key => {
        return {
          label: key,
          value: key,
        };
      }),
    });
    const to_bot = await prompt.pick('请选择目标机器人', {
      type: 'text',
      options:
        transferPlugin.app?.adapters.get(to_adapter)?.bots.map(bot => {
          return {
            label: bot.unique_id,
            value: bot.unique_id,
          };
        }) || [],
    });
    const to_channel = await prompt.text('请输入目标通道');
    if (from_adapter === to_adapter && from_bot === to_bot && from_channel === to_channel) return '不能传送到自己';
    transferPlugin.database.push<TransportConfig>('transfer', {
      from: {
        adapter: from_adapter,
        bot_id: from_bot,
        channel: from_channel,
      },
      to: {
        adapter: to_adapter as Adapters,
        bot_id: to_bot,
        channel: to_channel as Message.Channel,
      },
    });
    return '添加成功';
  });
transferPlugin
  .command('transfer.list')
  .permission('master')
  .action(async () => {
    const transferList = await transferPlugin.database.get<TransportConfig[]>('transfer', []);
    return transferList
      .map((transfer, idx) => {
        return `${idx + 1}  ${transfer.from.adapter}:${transfer.from.bot_id}:${transfer.from.channel} => ${
          transfer.to.adapter
        }:${transfer.to.bot_id}:${transfer.to.channel}`;
      })
      .join('\n');
  });
transferPlugin
  .command('transfer.remove')
  .permission('master')
  .action(async ({ prompt }) => {
    const transferList = await transferPlugin.database.get<TransportConfig[]>('transfer', []);
    const transfer = await prompt.pick('请选择要删除的传送', {
      type: 'number',
      options: transferList.map((transfer, idx) => {
        return {
          label: `${transfer.from.adapter}:${transfer.from.bot_id}:${transfer.from.channel} => ${transfer.to.adapter}:${transfer.to.bot_id}:${transfer.to.channel}`,
          value: idx,
        };
      }),
    });
    transferList.splice(transfer, 1);
    await transferPlugin.database.set('transfer', transferList);
    return '删除成功';
  });
transferPlugin.middleware(async (message, next) => {
  await next();
  const transferList = await transferPlugin.database.get<TransportConfig[]>('transfer', []);
  const transfer = transferList.find(
    transfer => transfer.from.adapter === message.adapter.name && transfer.from.bot_id === message.bot.unique_id,
  );
  if (!transfer) return;
  transferPlugin
    .adapter(transfer.to.adapter)
    ?.pick(transfer.to.bot_id)
    ?.sendMsg(transfer.to.channel, message.raw_message, message);
});
export default transferPlugin;
