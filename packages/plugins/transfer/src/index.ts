import { Plugin } from 'zhin';
const transportPlugin = new Plugin('问答管理');
type Transport = {
  adapter: string;
  bot_id: string;
};
type TransportConfig = {
  from: Transport;
  to: Transport;
};
transportPlugin.required('database');
transportPlugin
  .command('transport.add')
  .permission('master')
  .action(async ({ prompt }) => {
    const from_adapter = await prompt.pick('请选择来源适配器', {
      type: 'text',
      options: [...(transportPlugin.app?.adapters.keys() || [])].map(key => {
        return {
          label: key,
          value: key,
        };
      }),
    });
    const from_bot = await prompt.pick('请选择来源机器人', {
      type: 'text',
      options:
        transportPlugin.app?.adapters.get(from_adapter)?.bots.map(bot => {
          return {
            label: bot.unique_id,
            value: bot.unique_id,
          };
        }) || [],
    });
    const to_adapter = await prompt.pick('请选择目标适配器', {
      type: 'text',
      options: [...(transportPlugin.app?.adapters.keys() || [])].map(key => {
        return {
          label: key,
          value: key,
        };
      }),
    });
    const to_bot = await prompt.pick('请选择目标机器人', {
      type: 'text',
      options:
        transportPlugin.app?.adapters.get(to_adapter)?.bots.map(bot => {
          return {
            label: bot.unique_id,
            value: bot.unique_id,
          };
        }) || [],
    });
    if (from_adapter === to_adapter && from_bot === to_bot) return '不能传送到自己';
    transportPlugin.database.push<TransportConfig>('transport', {
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
transportPlugin.on('plugin-mounted', async () => {
  await transportPlugin.database.get('transport', []);
});

transportPlugin.middleware(async (adapter, bot, message, next) => {
  const transportList = await transportPlugin.database.get<TransportConfig[]>('transport', []);
  const transport = transportList.find(
    transport => transport.from.adapter === adapter.name && transport.from.bot_id === bot.unique_id,
  );
  if (!transport) return next();
  const toAdapter = transportPlugin.app?.adapters.get(transport.to.adapter);
  if (!toAdapter) return next();
  const toBot = toAdapter.bots.find(b => b.unique_id === transport.to.bot_id);
  if (!toBot) return next();
  adapter.app?.emit('message', toAdapter, toBot, message);
  return next();
});
export default transportPlugin;
