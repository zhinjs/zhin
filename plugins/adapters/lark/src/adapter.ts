/**
 * 飞书/Lark 适配器
 */
import {
  Adapter,
  Plugin,
  createGroupManagementTools,
  type IGroupManagement,
} from "zhin.js";
import { LarkBot } from "./bot.js";
import type { LarkBotConfig } from "./types.js";

export class LarkAdapter extends Adapter<LarkBot> {
    #router: any;

    constructor(plugin: Plugin, router: any) {
        super(plugin, 'lark', []);
        this.#router = router;
    }

    createBot(config: LarkBotConfig): LarkBot {
        return new LarkBot(this, this.#router, config);
    }

    // ── IGroupManagement 标准群管方法 ──────────────────────────────────

    async kickMember(botId: string, sceneId: string, userId: string) {
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        return bot.removeChatMembers(sceneId, [userId]);
    }

    async listMembers(botId: string, sceneId: string) {
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        return bot.getChatMembers(sceneId);
    }

    async getGroupInfo(botId: string, sceneId: string) {
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        return bot.getChatInfo(sceneId);
    }

    async setGroupName(botId: string, sceneId: string, name: string) {
        const bot = this.bots.get(botId);
        if (!bot) throw new Error(`Bot ${botId} 不存在`);
        return bot.updateChatInfo(sceneId, { name });
    }

    // ── 生命周期 ───────────────────────────────────────────────────────

    async start(): Promise<void> {
        this.registerLarkPlatformTools();
        const groupTools = createGroupManagementTools(this as unknown as IGroupManagement, this.name);
        groupTools.forEach((t) => this.addTool(t));
        await super.start();
    }

    /**
     * 注册飞书平台特有工具（获取用户、设管等）
     */
    private registerLarkPlatformTools(): void {
        // 获取用户信息工具
        this.addTool({
            name: 'lark_get_user',
            description: '获取飞书用户信息',
            parameters: {
                type: 'object',
                properties: {
                    bot: { type: 'string', description: 'Bot 名称' },
                    user_id: { type: 'string', description: '用户 ID (open_id)' },
                },
                required: ['bot', 'user_id'],
            },
            platforms: ['lark'],
            scopes: ['group', 'private'],
            permissionLevel: 'user',
            execute: async (args) => {
                const { bot: botId, user_id } = args;
                const bot = this.bots.get(botId);
                if (!bot) throw new Error(`Bot ${botId} 不存在`);
                return await bot.getUserInfo(user_id);
            },
        });

        // 创建群聊工具
        this.addTool({
            name: 'lark_create_chat',
            description: '创建飞书群聊',
            parameters: {
                type: 'object',
                properties: {
                    bot: { type: 'string', description: 'Bot 名称' },
                    name: { type: 'string', description: '群名' },
                    members: { type: 'array', items: { type: 'string' }, description: '成员 open_id 列表' },
                    owner: { type: 'string', description: '群主 open_id（可选）' },
                },
                required: ['bot', 'name', 'members'],
            },
            platforms: ['lark'],
            scopes: ['group', 'private'],
            permissionLevel: 'group_admin',
            execute: async (args) => {
                const { bot: botId, name, members, owner } = args;
                const bot = this.bots.get(botId);
                if (!bot) throw new Error(`Bot ${botId} 不存在`);
                const chatId = await bot.createChat(name, members, owner);
                return { success: !!chatId, chat_id: chatId, message: chatId ? `群聊创建成功: ${chatId}` : '创建失败' };
            },
        });

        // 更新群信息工具
        this.addTool({
            name: 'lark_update_chat',
            description: '更新飞书群聊信息（群名、描述）',
            parameters: {
                type: 'object',
                properties: {
                    bot: { type: 'string', description: 'Bot 名称' },
                    chat_id: { type: 'string', description: '群聊 ID' },
                    name: { type: 'string', description: '新群名（可选）' },
                    description: { type: 'string', description: '新描述（可选）' },
                },
                required: ['bot', 'chat_id'],
            },
            platforms: ['lark'],
            scopes: ['group'],
            permissionLevel: 'group_admin',
            execute: async (args) => {
                const { bot: botId, chat_id, name, description } = args;
                const bot = this.bots.get(botId);
                if (!bot) throw new Error(`Bot ${botId} 不存在`);
                const success = await bot.updateChatInfo(chat_id, { name, description });
                return { success, message: success ? '群信息更新成功' : '更新失败' };
            },
        });

        // 添加群成员工具
        this.addTool({
            name: 'lark_add_members',
            description: '添加飞书群成员',
            parameters: {
                type: 'object',
                properties: {
                    bot: { type: 'string', description: 'Bot 名称' },
                    chat_id: { type: 'string', description: '群聊 ID' },
                    user_ids: { type: 'array', items: { type: 'string' }, description: '用户 open_id 列表' },
                },
                required: ['bot', 'chat_id', 'user_ids'],
            },
            platforms: ['lark'],
            scopes: ['group'],
            permissionLevel: 'group_admin',
            execute: async (args) => {
                const { bot: botId, chat_id, user_ids } = args;
                const bot = this.bots.get(botId);
                if (!bot) throw new Error(`Bot ${botId} 不存在`);
                const success = await bot.addChatMembers(chat_id, user_ids);
                return { success, message: success ? '成员添加成功' : '添加失败' };
            },
        });

        // 设置群管理员工具
        this.addTool({
            name: 'lark_set_managers',
            description: '设置飞书群管理员',
            parameters: {
                type: 'object',
                properties: {
                    bot: { type: 'string', description: 'Bot 名称' },
                    chat_id: { type: 'string', description: '群聊 ID' },
                    user_ids: { type: 'array', items: { type: 'string' }, description: '用户 open_id 列表' },
                },
                required: ['bot', 'chat_id', 'user_ids'],
            },
            platforms: ['lark'],
            scopes: ['group'],
            permissionLevel: 'group_owner',
            execute: async (args) => {
                const { bot: botId, chat_id, user_ids } = args;
                const bot = this.bots.get(botId);
                if (!bot) throw new Error(`Bot ${botId} 不存在`);
                const success = await bot.setChatManagers(chat_id, user_ids);
                return { success, message: success ? '管理员设置成功' : '设置失败' };
            },
        });

        // 移除群管理员工具
        this.addTool({
            name: 'lark_remove_managers',
            description: '移除飞书群管理员',
            parameters: {
                type: 'object',
                properties: {
                    bot: { type: 'string', description: 'Bot 名称' },
                    chat_id: { type: 'string', description: '群聊 ID' },
                    user_ids: { type: 'array', items: { type: 'string' }, description: '用户 open_id 列表' },
                },
                required: ['bot', 'chat_id', 'user_ids'],
            },
            platforms: ['lark'],
            scopes: ['group'],
            permissionLevel: 'group_owner',
            execute: async (args) => {
                const { bot: botId, chat_id, user_ids } = args;
                const bot = this.bots.get(botId);
                if (!bot) throw new Error(`Bot ${botId} 不存在`);
                const success = await bot.removeChatManagers(chat_id, user_ids);
                return { success, message: success ? '管理员移除成功' : '移除失败' };
            },
        });

        // 解散群聊工具
        this.addTool({
            name: 'lark_dissolve_chat',
            description: '解散飞书群聊（需要群主权限）',
            parameters: {
                type: 'object',
                properties: {
                    bot: { type: 'string', description: 'Bot 名称' },
                    chat_id: { type: 'string', description: '群聊 ID' },
                },
                required: ['bot', 'chat_id'],
            },
            platforms: ['lark'],
            scopes: ['group'],
            permissionLevel: 'group_owner',
            execute: async (args) => {
                const { bot: botId, chat_id } = args;
                const bot = this.bots.get(botId);
                if (!bot) throw new Error(`Bot ${botId} 不存在`);
                const success = await bot.dissolveChat(chat_id);
                return { success, message: success ? '群聊已解散' : '解散失败' };
            },
        });

        // 文件上传
        this.addTool({
            name: 'lark_upload_file',
            description: '上传文件到飞书（图片/文件/视频/音频）',
            parameters: {
                type: 'object',
                properties: {
                    bot: { type: 'string', description: 'Bot 名称' },
                    file_path: { type: 'string', description: '本地文件路径' },
                    file_type: { type: 'string', description: '文件类型：image/file/video/audio', enum: ['image', 'file', 'video', 'audio'] },
                },
                required: ['bot', 'file_path', 'file_type'],
            },
            platforms: ['lark'],
            scopes: ['group', 'private'],
            permissionLevel: 'user',
            execute: async (args) => {
                const { bot: botId, file_path, file_type } = args;
                const bot = this.bots.get(botId);
                if (!bot) throw new Error(`Bot ${botId} 不存在`);
                const result = await bot.uploadFile(file_path, file_type);
                return { success: true, file_key: result, message: `文件已上传，file_key: ${result}` };
            },
        });

        this.plugin.logger.debug('已注册飞书平台群组管理工具');
    }
}
