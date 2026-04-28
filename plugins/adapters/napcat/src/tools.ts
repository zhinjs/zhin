/**
 * NapCat 扩展 Tool 注册
 * 覆盖 go-cqhttp 扩展与 NapCat 独有 API，全部通过 AI Tool 系统暴露。
 */
import type { Tool, ToolScope, ToolPermissionLevel } from 'zhin.js';
import type { NapCatAdapter, NapCatBot } from './adapter.js';

function getBot(adapter: NapCatAdapter, botId: string): NapCatBot {
  const bot = adapter.bots.get(botId);
  if (!bot) throw new Error(`Bot ${botId} not found`);
  return bot;
}

type PropertyType = 'string' | 'number' | 'boolean' | 'object' | 'array';

interface ToolSpec {
  name: string;
  description: string;
  params: Record<string, { type: PropertyType; description: string; default?: any; enum?: string[] }>;
  required: string[];
  execute: (adapter: NapCatAdapter, args: Record<string, any>) => Promise<any>;
  keywords: string[];
  permissionLevel?: ToolPermissionLevel;
  scopes?: ToolScope[];
  preExecutable?: boolean;
}

const NAPCAT_TOOL_SPECS: ToolSpec[] = [
  // ── 消息与社交 ──────────────────────────────────────────────────
  {
    name: 'napcat_send_poke',
    description: '戳一戳（群聊或私聊）。group_id 不传时为私聊戳一戳。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      user_id: { type: 'number', description: '目标用户 QQ 号' },
      group_id: { type: 'number', description: '群号（不传则为私聊戳一戳）' },
    },
    required: ['bot', 'user_id'],
    keywords: ['戳一戳', 'poke', '戳', '拍一拍'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      await bot.sendPoke(args.user_id, args.group_id);
      return { success: true, message: `已戳 ${args.user_id}` };
    },
  },
  {
    name: 'napcat_set_emoji_reaction',
    description: '为消息添加表情回应（贴表情）。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      message_id: { type: 'number', description: '消息 ID' },
      emoji_id: { type: 'string', description: '表情 ID' },
    },
    required: ['bot', 'message_id', 'emoji_id'],
    keywords: ['表情回应', 'reaction', '贴表情', 'emoji'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      await bot.setMsgEmojiLike(args.message_id, args.emoji_id);
      return { success: true };
    },
  },
  {
    name: 'napcat_send_forward_msg',
    description: '发送合并转发消息（群聊或私聊）。messages 为转发节点数组。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      message_type: { type: 'string', description: 'private 或 group', enum: ['private', 'group'] },
      id: { type: 'number', description: '群号或 QQ 号' },
      messages: { type: 'string', description: '转发节点 JSON（node 数组）' },
    },
    required: ['bot', 'message_type', 'id', 'messages'],
    keywords: ['合并转发', 'forward', '转发消息'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      const messages = typeof args.messages === 'string' ? JSON.parse(args.messages) : args.messages;
      const result = await bot.sendForwardMsg(args.message_type, args.id, messages);
      return result;
    },
  },
  {
    name: 'napcat_forward_single_msg',
    description: '转发单条消息到指定好友或群。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      target_type: { type: 'string', description: 'friend 或 group', enum: ['friend', 'group'] },
      target_id: { type: 'number', description: '目标好友 QQ 号或群号' },
      message_id: { type: 'number', description: '要转发的消息 ID' },
    },
    required: ['bot', 'target_type', 'target_id', 'message_id'],
    keywords: ['转发', 'forward', '单条转发'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      if (args.target_type === 'friend') await bot.forwardFriendSingleMsg(args.target_id, args.message_id);
      else await bot.forwardGroupSingleMsg(args.target_id, args.message_id);
      return { success: true };
    },
  },
  {
    name: 'napcat_send_like',
    description: '给好友点赞（每人每天最多 10 次）。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      user_id: { type: 'number', description: '目标 QQ 号' },
      times: { type: 'number', description: '点赞次数（1-10）', default: 1 },
    },
    required: ['bot', 'user_id'],
    keywords: ['点赞', 'like', '赞', '好友赞'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      await bot.sendLike(args.user_id, args.times || 1);
      return { success: true, message: `已给 ${args.user_id} 点赞 ${args.times || 1} 次` };
    },
  },

  // ── 精华消息 ────────────────────────────────────────────────────
  {
    name: 'napcat_set_essence_msg',
    description: '设置群精华消息。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      message_id: { type: 'number', description: '消息 ID' },
    },
    required: ['bot', 'message_id'],
    keywords: ['精华', 'essence', '设精', '加精'],
    permissionLevel: 'group_admin',
    scopes: ['group'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      await bot.setEssenceMsg(args.message_id);
      return { success: true };
    },
  },
  {
    name: 'napcat_delete_essence_msg',
    description: '移除群精华消息。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      message_id: { type: 'number', description: '消息 ID' },
    },
    required: ['bot', 'message_id'],
    keywords: ['取消精华', '移除精华', 'delete essence'],
    permissionLevel: 'group_admin',
    scopes: ['group'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      await bot.deleteEssenceMsg(args.message_id);
      return { success: true };
    },
  },
  {
    name: 'napcat_get_essence_list',
    description: '获取群精华消息列表。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      group_id: { type: 'number', description: '群号' },
    },
    required: ['bot', 'group_id'],
    keywords: ['精华列表', 'essence list'],
    preExecutable: true,
    scopes: ['group'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      return bot.getEssenceMsgList(args.group_id);
    },
  },

  // ── 群公告 ──────────────────────────────────────────────────────
  {
    name: 'napcat_send_group_notice',
    description: '发送群公告。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      group_id: { type: 'number', description: '群号' },
      content: { type: 'string', description: '公告内容' },
      image: { type: 'string', description: '图片（URL 或 base64，可选）' },
    },
    required: ['bot', 'group_id', 'content'],
    keywords: ['群公告', 'notice', '公告', '发公告'],
    permissionLevel: 'group_admin',
    scopes: ['group'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      await bot.sendGroupNotice(args.group_id, args.content, args.image);
      return { success: true };
    },
  },
  {
    name: 'napcat_get_group_notice',
    description: '获取群公告列表。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      group_id: { type: 'number', description: '群号' },
    },
    required: ['bot', 'group_id'],
    keywords: ['群公告', '获取公告', 'get notice'],
    preExecutable: true,
    scopes: ['group'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      return bot.getGroupNotice(args.group_id);
    },
  },
  {
    name: 'napcat_del_group_notice',
    description: '删除群公告。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      group_id: { type: 'number', description: '群号' },
      notice_id: { type: 'string', description: '公告 ID' },
    },
    required: ['bot', 'group_id', 'notice_id'],
    keywords: ['删除公告', 'delete notice'],
    permissionLevel: 'group_admin',
    scopes: ['group'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      await bot.deleteGroupNotice(args.group_id, args.notice_id);
      return { success: true };
    },
  },

  // ── 群文件 ──────────────────────────────────────────────────────
  {
    name: 'napcat_upload_group_file',
    description: '上传文件到群。file 为本地路径或 URL。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      group_id: { type: 'number', description: '群号' },
      file: { type: 'string', description: '文件路径或 URL' },
      name: { type: 'string', description: '文件名' },
      folder: { type: 'string', description: '目标文件夹 ID（可选）' },
    },
    required: ['bot', 'group_id', 'file', 'name'],
    keywords: ['上传文件', 'upload file', '群文件'],
    permissionLevel: 'user',
    scopes: ['group'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      await bot.uploadGroupFile(args.group_id, args.file, args.name, args.folder);
      return { success: true };
    },
  },
  {
    name: 'napcat_get_group_file_url',
    description: '获取群文件下载链接。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      group_id: { type: 'number', description: '群号' },
      file_id: { type: 'string', description: '文件 ID' },
      busid: { type: 'number', description: '文件类型 ID' },
    },
    required: ['bot', 'group_id', 'file_id', 'busid'],
    keywords: ['文件链接', 'file url', '下载文件'],
    preExecutable: true,
    scopes: ['group'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      return bot.getGroupFileUrl(args.group_id, args.file_id, args.busid);
    },
  },
  {
    name: 'napcat_get_group_root_files',
    description: '获取群根目录文件列表。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      group_id: { type: 'number', description: '群号' },
    },
    required: ['bot', 'group_id'],
    keywords: ['群文件列表', 'group files'],
    preExecutable: true,
    scopes: ['group'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      return bot.getGroupRootFiles(args.group_id);
    },
  },

  // ── 群管理增强 ──────────────────────────────────────────────────
  {
    name: 'napcat_get_group_shut_list',
    description: '获取群禁言列表。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      group_id: { type: 'number', description: '群号' },
    },
    required: ['bot', 'group_id'],
    keywords: ['禁言列表', 'shut list', '被禁言'],
    preExecutable: true,
    scopes: ['group'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      return bot.getGroupShutList(args.group_id);
    },
  },
  {
    name: 'napcat_set_group_portrait',
    description: '设置群头像。file 为图片 URL 或 base64。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      group_id: { type: 'number', description: '群号' },
      file: { type: 'string', description: '图片（URL 或 base64）' },
    },
    required: ['bot', 'group_id', 'file'],
    keywords: ['群头像', 'group portrait', '设置群头像'],
    permissionLevel: 'group_admin',
    scopes: ['group'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      await bot.setGroupPortrait(args.group_id, args.file);
      return { success: true };
    },
  },
  {
    name: 'napcat_set_title',
    description: '设置群成员专属头衔。需要群主权限。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      group_id: { type: 'number', description: '群号' },
      user_id: { type: 'number', description: '目标成员 QQ 号' },
      title: { type: 'string', description: '头衔文字' },
    },
    required: ['bot', 'group_id', 'user_id', 'title'],
    keywords: ['头衔', 'title', '专属头衔', '设置头衔'],
    permissionLevel: 'group_owner',
    scopes: ['group'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      await bot.setTitle(args.group_id, args.user_id, args.title);
      return { success: true, message: `已设置 ${args.user_id} 头衔为 "${args.title}"` };
    },
  },
  {
    name: 'napcat_group_sign',
    description: '群签到/群打卡。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      group_id: { type: 'number', description: '群号' },
    },
    required: ['bot', 'group_id'],
    keywords: ['签到', '打卡', 'sign', 'check in'],
    scopes: ['group'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      await bot.sendGroupSign(args.group_id);
      return { success: true };
    },
  },

  // ── AI 与多媒体 ────────────────────────────────────────────────
  {
    name: 'napcat_ai_tts',
    description: 'AI 文字转语音，在群聊中发送 AI 语音消息。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      group_id: { type: 'number', description: '群号' },
      character: { type: 'string', description: 'AI 语音角色 ID（可先用 napcat_get_ai_characters 查询）' },
      text: { type: 'string', description: '要转为语音的文字' },
    },
    required: ['bot', 'group_id', 'character', 'text'],
    keywords: ['AI语音', 'TTS', '文字转语音', 'ai record'],
    scopes: ['group'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      return bot.sendGroupAiRecord(args.group_id, args.character, args.text);
    },
  },
  {
    name: 'napcat_get_ai_characters',
    description: '获取 AI 语音角色列表，用于 napcat_ai_tts 的 character 参数。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      group_id: { type: 'number', description: '群号' },
    },
    required: ['bot', 'group_id'],
    keywords: ['AI角色', 'ai characters', '语音角色'],
    preExecutable: true,
    scopes: ['group'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      return bot.getAiCharacters(args.group_id);
    },
  },
  {
    name: 'napcat_ocr_image',
    description: '图片 OCR 文字识别。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      image: { type: 'string', description: '图片 file 参数（收到消息中的 file 字段或 URL）' },
    },
    required: ['bot', 'image'],
    keywords: ['OCR', '文字识别', '图片识别', 'ocr'],
    preExecutable: true,
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      return bot.ocrImage(args.image);
    },
  },
  {
    name: 'napcat_get_mini_app_ark',
    description: '签名小程序卡片（如 B 站分享卡片等）。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      type: { type: 'string', description: '卡片类型' },
      title: { type: 'string', description: '标题' },
      desc: { type: 'string', description: '描述' },
      pic_url: { type: 'string', description: '图片 URL' },
      jump_url: { type: 'string', description: '跳转 URL' },
    },
    required: ['bot', 'type', 'title', 'desc', 'pic_url', 'jump_url'],
    keywords: ['小程序', 'mini app', '卡片', 'ark'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      return bot.getMiniAppArk(args.type, args.title, args.desc, args.pic_url, args.jump_url);
    },
  },

  // ── 消息历史 ────────────────────────────────────────────────────
  {
    name: 'napcat_get_group_msg_history',
    description: '获取群消息历史记录。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      group_id: { type: 'number', description: '群号' },
      message_seq: { type: 'number', description: '起始消息序号（可选，不传从最新开始）' },
      count: { type: 'number', description: '获取条数（可选）' },
    },
    required: ['bot', 'group_id'],
    keywords: ['群消息历史', '聊天记录', 'message history'],
    preExecutable: true,
    scopes: ['group'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      return bot.getGroupMsgHistory(args.group_id, args.message_seq, args.count);
    },
  },
  {
    name: 'napcat_get_friend_msg_history',
    description: '获取私聊消息历史记录。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      user_id: { type: 'number', description: 'QQ 号' },
      message_seq: { type: 'number', description: '起始消息序号（可选）' },
      count: { type: 'number', description: '获取条数（可选）' },
    },
    required: ['bot', 'user_id'],
    keywords: ['私聊记录', '好友聊天记录', 'friend history'],
    preExecutable: true,
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      return bot.getFriendMsgHistory(args.user_id, args.message_seq, args.count);
    },
  },

  // ── 信息查询 ────────────────────────────────────────────────────
  {
    name: 'napcat_get_user_status',
    description: '获取用户在线状态。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      user_id: { type: 'number', description: '目标 QQ 号' },
    },
    required: ['bot', 'user_id'],
    keywords: ['在线状态', '用户状态', 'online status'],
    preExecutable: true,
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      return bot.ncGetUserStatus(args.user_id);
    },
  },
  {
    name: 'napcat_get_group_info_ex',
    description: '获取群组额外详细信息。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      group_id: { type: 'number', description: '群号' },
    },
    required: ['bot', 'group_id'],
    keywords: ['群详情', '群额外信息', 'group info ex'],
    preExecutable: true,
    scopes: ['group'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      return bot.getGroupInfoEx(args.group_id);
    },
  },

  // ── 个人设置 ────────────────────────────────────────────────────
  {
    name: 'napcat_set_profile',
    description: '修改 QQ 资料（昵称等）。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      nickname: { type: 'string', description: '昵称' },
      company: { type: 'string', description: '公司（可选）' },
      email: { type: 'string', description: '邮箱（可选）' },
      college: { type: 'string', description: '学校（可选）' },
      personal_note: { type: 'string', description: '个人说明（可选）' },
    },
    required: ['bot', 'nickname'],
    keywords: ['修改资料', '设置昵称', 'profile', 'set profile'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      await bot.setQQProfile(args.nickname, args.company, args.email, args.college, args.personal_note);
      return { success: true };
    },
  },
  {
    name: 'napcat_set_avatar',
    description: '修改 QQ 头像。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      file: { type: 'string', description: '图片（URL 或 base64）' },
    },
    required: ['bot', 'file'],
    keywords: ['头像', 'avatar', '设置头像', '换头像'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      await bot.setQQAvatar(args.file);
      return { success: true };
    },
  },
  {
    name: 'napcat_set_online_status',
    description: '设置在线状态（在线、隐身、忙碌等）。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      status: { type: 'number', description: '状态码（11=在线, 21=离开, 31=隐身, 41=忙碌, 50=请勿打扰, 60=Q我吧）' },
      ext_status: { type: 'number', description: '扩展状态码', default: 0 },
    },
    required: ['bot', 'status'],
    keywords: ['在线状态', '隐身', '忙碌', 'online', 'status'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      await bot.setOnlineStatus(args.status, args.ext_status || 0);
      return { success: true };
    },
  },
  {
    name: 'napcat_set_signature',
    description: '设置个人签名（个性签名）。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      signature: { type: 'string', description: '签名内容' },
    },
    required: ['bot', 'signature'],
    keywords: ['签名', '个性签名', 'signature', 'longnick'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      await bot.setSelfLongnick(args.signature);
      return { success: true };
    },
  },
  {
    name: 'napcat_translate',
    description: '英译中翻译。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      text: { type: 'string', description: '要翻译的英文文本' },
    },
    required: ['bot', 'text'],
    keywords: ['翻译', 'translate', '英译中'],
    preExecutable: true,
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      return bot.translateEn2Zh(args.text);
    },
  },
  {
    name: 'napcat_mark_msg_as_read',
    description: '标记消息为已读。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      message_id: { type: 'number', description: '消息 ID' },
    },
    required: ['bot', 'message_id'],
    keywords: ['已读', 'mark read', '标记已读'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      await bot.markMsgAsRead(args.message_id);
      return { success: true };
    },
  },
  {
    name: 'napcat_download_file',
    description: '下载文件到 NapCat 缓存目录，返回本地路径。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      url: { type: 'string', description: '文件 URL' },
      thread_count: { type: 'number', description: '下载线程数（可选，默认 1）', default: 1 },
    },
    required: ['bot', 'url'],
    keywords: ['下载', 'download', '下载文件'],
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      return bot.downloadFile(args.url, args.thread_count || 1);
    },
  },
  {
    name: 'napcat_delete_friend',
    description: '删除好友。',
    params: {
      bot: { type: 'string', description: 'Bot 名称' },
      user_id: { type: 'number', description: '好友 QQ 号' },
    },
    required: ['bot', 'user_id'],
    keywords: ['删除好友', 'delete friend', '删好友'],
    permissionLevel: 'group_admin',
    execute: async (adapter, args) => {
      const bot = getBot(adapter, args.bot);
      await bot.deleteFriend(args.user_id);
      return { success: true };
    },
  },
];

export function createNapCatTools(adapter: NapCatAdapter): Tool[] {
  return NAPCAT_TOOL_SPECS.map((spec) => ({
    name: spec.name,
    description: spec.description,
    parameters: {
      type: 'object' as const,
      properties: spec.params,
      required: spec.required,
    },
    execute: (args: Record<string, any>) => spec.execute(adapter, args),
    tags: ['napcat', 'qq'],
    keywords: spec.keywords,
    platforms: ['napcat'],
    permissionLevel: spec.permissionLevel || ('user' as ToolPermissionLevel),
    scopes: spec.scopes || (['group', 'private'] as ToolScope[]),
    preExecutable: spec.preExecutable,
  }));
}
