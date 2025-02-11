import { Plugin } from 'zhin';
const transferPlugin = new Plugin('问答管理');
type Transport = {
  adapter: string;
  bot_id: string;
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
  .action(async ({ prompt }) => {
    const from_adapter = await prompt.pick('请选择来源适配器', {
      type: 'text',
      options: [...(transferPlugin.app?.adapters.keys() || [])].map(key => {
        return {
          label: key,
          value: key,
        };
      }),
    });
    const from_bot = await prompt.pick('请选择来源机器人', {
      type: 'text',
      options:
        transferPlugin.app?.adapters.get(from_adapter)?.bots.map(bot => {
          return {
            label: bot.unique_id,
            value: bot.unique_id,
          };
        }) || [],
    });
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
    if (from_adapter === to_adapter && from_bot === to_bot) return '不能传送到自己';
    transferPlugin.database.push<TransportConfig>('transfer', {
      from: {
        adapter: from_adapter,
        bot_id: from_bot,
      },
      to: {
        adapter: to_adapter,
        bot_id: to_bot,
      },
    });
  });
transferPlugin.middleware(async (adapter, bot, message, next) => {
  const transferList = await transferPlugin.database.get<TransportConfig[]>('transfer', []);
  const transfer = transferList.find(
    transfer => transfer.from.adapter === adapter.name && transfer.from.bot_id === bot.unique_id,
  );
  if (!transfer) return next();
  const toAdapter = transferPlugin.app?.adapters.get(transfer.to.adapter);
  if (!toAdapter) return next();
  const toBot = toAdapter.bots.find(b => b.unique_id === transfer.to.bot_id);
  if (!toBot) return next();
  adapter.app?.emit('message', toAdapter, toBot, message);
  return next();
});
export default transferPlugin;
