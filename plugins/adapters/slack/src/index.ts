/**
 * Slack 适配器入口：类型扩展、导出、注册
 */
import { usePlugin, type Plugin, type IGroupManagement, createGroupManagementTools, type ToolFeature } from "zhin.js";
import { SlackAdapter } from "./adapter.js";

declare module "zhin.js" {
  interface Adapters {
    slack: SlackAdapter;
  }
}

export * from "./types.js";
export { SlackBot } from "./bot.js";
export { SlackAdapter } from "./adapter.js";

const plugin = usePlugin();
const { provide, useContext } = plugin;

provide({
  name: "slack",
  description: "Slack Bot Adapter",
  mounted: async (p: Plugin) => {
    const adapter = new SlackAdapter(p);
    await adapter.start();
    return adapter;
  },
  dispose: async (adapter: SlackAdapter) => {
    await adapter.stop();
  },
});

useContext('tool', 'slack', (toolService: ToolFeature, slack: SlackAdapter) => {
  const groupTools = createGroupManagementTools(
    slack as unknown as IGroupManagement,
    'slack',
  );
  const disposers: (() => void)[] = groupTools.map(t => toolService.addTool(t, plugin.name));

  function getBot(botId: string) {
    const bot = slack.bots.get(botId);
    if (!bot) throw new Error(`Bot ${botId} 不存在`);
    return bot;
  }

  disposers.push(toolService.addTool({
    name: 'slack_invite_to_channel',
    description: '邀请用户加入 Slack 频道',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        channel: { type: 'string', description: '频道 ID' },
        users: { type: 'string', description: '用户 ID 列表（逗号分隔）' },
      },
      required: ['bot', 'channel', 'users'],
    },
    platforms: ['slack'],
    tags: ['slack'],
    execute: async (args: Record<string, any>) => {
      const bot = getBot(args.bot);
      const success = await bot.inviteToChannel(args.channel, args.users.split(','));
      return { success, message: success ? '已邀请用户加入频道' : '操作失败' };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'slack_set_topic',
    description: '设置 Slack 频道话题',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        channel: { type: 'string', description: '频道 ID' },
        topic: { type: 'string', description: '新话题' },
      },
      required: ['bot', 'channel', 'topic'],
    },
    platforms: ['slack'],
    tags: ['slack'],
    execute: async (args: Record<string, any>) => {
      const bot = getBot(args.bot);
      const success = await bot.setChannelTopic(args.channel, args.topic);
      return { success, message: success ? '已设置频道话题' : '操作失败' };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'slack_archive_channel',
    description: '归档 Slack 频道',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        channel: { type: 'string', description: '频道 ID' },
      },
      required: ['bot', 'channel'],
    },
    platforms: ['slack'],
    tags: ['slack'],
    execute: async (args: Record<string, any>) => {
      const bot = getBot(args.bot);
      const success = await bot.archiveChannel(args.channel);
      return { success, message: success ? '已归档频道' : '操作失败' };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'slack_pin_message',
    description: '置顶 Slack 消息',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        channel: { type: 'string', description: '频道 ID' },
        timestamp: { type: 'string', description: '消息时间戳' },
      },
      required: ['bot', 'channel', 'timestamp'],
    },
    platforms: ['slack'],
    tags: ['slack'],
    execute: async (args: Record<string, any>) => {
      const bot = getBot(args.bot);
      const success = await bot.pinMessage(args.channel, args.timestamp);
      return { success, message: success ? '已置顶消息' : '操作失败' };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'slack_add_reaction',
    description: '给 Slack 消息添加表情反应',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        channel: { type: 'string', description: '频道 ID' },
        timestamp: { type: 'string', description: '消息时间戳' },
        emoji: { type: 'string', description: '表情名称（不含冒号）' },
      },
      required: ['bot', 'channel', 'timestamp', 'emoji'],
    },
    platforms: ['slack'],
    tags: ['slack'],
    execute: async (args: Record<string, any>) => {
      const bot = getBot(args.bot);
      const success = await bot.addReaction(args.channel, args.timestamp, args.emoji);
      return { success, message: success ? `已添加反应 :${args.emoji}:` : '操作失败' };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'slack_remove_reaction',
    description: '移除 Slack 消息上的表情反应',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        channel_id: { type: 'string', description: '频道 ID' },
        timestamp: { type: 'string', description: '消息时间戳' },
        name: { type: 'string', description: '表情名称（如 thumbsup、heart）' },
      },
      required: ['bot', 'channel_id', 'timestamp', 'name'],
    },
    platforms: ['slack'],
    tags: ['slack'],
    execute: async (args: Record<string, any>) => {
      const bot = getBot(args.bot);
      const success = await bot.removeReaction(args.channel_id, args.timestamp, args.name);
      return { success, message: success ? `已移除反应 :${args.name}:` : '操作失败' };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'slack_unpin_message',
    description: '取消 Slack 频道中消息的置顶',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        channel_id: { type: 'string', description: '频道 ID' },
        timestamp: { type: 'string', description: '消息时间戳' },
      },
      required: ['bot', 'channel_id', 'timestamp'],
    },
    platforms: ['slack'],
    tags: ['slack'],
    execute: async (args: Record<string, any>) => {
      const bot = getBot(args.bot);
      const success = await bot.unpinMessage(args.channel_id, args.timestamp);
      return { success, message: success ? '已取消置顶' : '操作失败' };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'slack_user_info',
    description: '查询 Slack 用户详细信息',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        user_id: { type: 'string', description: '用户 ID' },
      },
      required: ['bot', 'user_id'],
    },
    platforms: ['slack'],
    tags: ['slack'],
    execute: async (args: Record<string, any>) => {
      const bot = getBot(args.bot);
      const user = await bot.getUserInfo(args.user_id);
      return {
        id: user.id,
        name: user.name,
        real_name: user.real_name,
        display_name: user.profile?.display_name,
        email: user.profile?.email,
        is_admin: user.is_admin,
        is_bot: user.is_bot,
        status_text: user.profile?.status_text,
      };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'slack_set_purpose',
    description: '设置 Slack 频道的用途/目的',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        channel_id: { type: 'string', description: '频道 ID' },
        purpose: { type: 'string', description: '频道用途描述' },
      },
      required: ['bot', 'channel_id', 'purpose'],
    },
    platforms: ['slack'],
    tags: ['slack'],
    execute: async (args: Record<string, any>) => {
      const bot = getBot(args.bot);
      const success = await bot.setChannelPurpose(args.channel_id, args.purpose);
      return { success, message: success ? '频道用途已更新' : '操作失败' };
    },
  }, plugin.name));

  disposers.push(toolService.addTool({
    name: 'slack_unarchive',
    description: '恢复已归档的 Slack 频道',
    parameters: {
      type: 'object',
      properties: {
        bot: { type: 'string', description: 'Bot 名称' },
        channel_id: { type: 'string', description: '频道 ID' },
      },
      required: ['bot', 'channel_id'],
    },
    platforms: ['slack'],
    tags: ['slack'],
    execute: async (args: Record<string, any>) => {
      const bot = getBot(args.bot);
      const success = await bot.unarchiveChannel(args.channel_id);
      return { success, message: success ? '频道已恢复' : '操作失败' };
    },
  }, plugin.name));

  return () => disposers.forEach(d => d());
});
