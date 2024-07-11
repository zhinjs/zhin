import { EventEmitter } from 'events';
import * as grpc from '@grpc/grpc-js';
import { loadSync, Long } from '@grpc/proto-loader';
import { kritor, proto } from 'kritor-proto';
import * as path from 'path';
import { Adapter, Dict, parseFromTemplate, valueMap } from 'zhin';

export class Client extends EventEmitter {
  services: Client.Services;
  account?: kritor.core.IGetCurrentAccountResponse;
  #credential: grpc.ChannelCredentials;
  constructor(
    public adapter: Adapter,
    public options: Client.Options,
  ) {
    super();
    this.#credential = grpc.credentials.createInsecure();
    if (this.options.ticket) {
      Reflect.set(
        this.#credential,
        'callCredentials',
        grpc.credentials.createFromMetadataGenerator((callOptions, callback) => {
          callOptions.service_url;
          const metadata = new grpc.Metadata();
          metadata.set('ticket', this.options.ticket || '');
          callback(null, metadata);
        }),
      );
    }
    this.services = this.#init();
  }
  get logger() {
    return this.adapter.getLogger(this.account?.account_name!);
  }
  #init() {
    return {
      authentication: this.#generateServiceFromProto<kritor.authentication.AuthenticationService>(
        'auth/authentication.proto',
        'authentication',
      ),
      core: this.#generateServiceFromProto<kritor.core.CoreService>('core/core.proto', 'core'),
      customization: this.#generateServiceFromProto<kritor.customization.CustomizationService>(
        'developer/customization.proto',
        'customization',
      ),
      developer: this.#generateServiceFromProto<kritor.developer.DeveloperService>(
        'developer/developer.proto',
        'developer',
      ),
      event: this.#generateServiceFromProto<kritor.event.EventService>('event/event.proto', 'event'),
      friend: this.#generateServiceFromProto<kritor.friend.FriendService>('friend/friend.proto', 'friend'),
      group: this.#generateServiceFromProto<kritor.group.GroupService>('group/group.proto', 'group'),
      groupFile: this.#generateServiceFromProto<kritor.file.GroupFileService>(
        'file/group_file.proto',
        'file',
        'GroupFileService',
      ),
      guild: this.#generateServiceFromProto<kritor.guild.GuildService>('guild/guild.proto', 'guild'),
      message: this.#generateServiceFromProto<kritor.message.MessageService>('message/message.proto', 'message'),
      reverse: this.#generateServiceFromProto<kritor.reverse.ReverseService>('reverse/reverse.proto', 'reverse'),
      web: this.#generateServiceFromProto<kritor.web.WebService>('web/web.proto', 'web'),
      qsign: this.#generateServiceFromProto<kritor.developer.QsignService>(
        'developer/qsign.proto',
        'developer',
        'QsignService',
      ),
    };
  }
  public createContact(target_id: string, target_type: 'guild' | 'group' | 'private' | 'temp_from_group' | 'temp') {
    const [peer, sub_peer] = target_id.split(':');
    return {
      scene: Client.sceneMap[target_type],
      peer,
      sub_peer: sub_peer || undefined,
    };
  }
  #emitEvent(eventStream: NodeJS.ReadableStream) {
    eventStream.on('error', e => {
      this.adapter.logger.error('Event stream error:', e);
    });
    eventStream.on('data', (event: kritor.event.EventStructure) => {
      this.emit(event.event!, event.message || event.notice || event.request);
    });
    eventStream.on('end', () => {
      this.adapter.logger.debug('Event stream end');
    });
    eventStream.on('status', status => {
      this.adapter.logger.debug('Event stream status:', status);
    });
  }
  #addListener(service: kritor.event.EventService) {
    this.#emitEvent(service.registerActiveListener({ type: kritor.event.EventType.EVENT_TYPE_CORE_EVENT }) as any);
    this.#emitEvent(service.registerActiveListener({ type: kritor.event.EventType.EVENT_TYPE_MESSAGE }) as any);
    this.#emitEvent(service.registerActiveListener({ type: kritor.event.EventType.EVENT_TYPE_NOTICE }) as any);
    this.#emitEvent(service.registerActiveListener({ type: kritor.event.EventType.EVENT_TYPE_REQUEST }) as any);
  }
  async start() {
    this.#addListener(this.services.event);
    this.account = await this.getCurrentAccount();
    this.adapter.logger.info(`${this.account?.account_name}(${this.account.account_uin}) connected`);
  }
  async stop() {
    for (const service of Object.values(this.services)) {
      service.end(true);
    }
  }
  /**
   * 通过proto文件生成服务
   * @param filename proto基于 node-kritor的根目录的相对路径
   * @param serviceKey
   * @param serviceName
   * @private
   */
  #generateServiceFromProto<T>(
    filename: string,
    serviceKey: string,
    serviceName = serviceKey.charAt(0).toUpperCase() + serviceKey.slice(1) + 'Service',
  ): T {
    const grpcObject = grpc.loadPackageDefinition(
      loadSync(path.join(proto, filename), {
        includeDirs: [proto],
        longs: String,
        keepCase: true,
        defaults: true,
        oneofs: true,
      }),
    )['kritor'] as grpc.GrpcObject;
    const Service = Reflect.get(Reflect.get(grpcObject, serviceKey), serviceName) as grpc.ServiceClientConstructor;
    return new Service(this.options.url, this.#credential) as T;
  }

  /**
   * 开始鉴权
   * @param account
   * @param ticket
   */
  async authenticate(account?: string, ticket?: string) {
    return new Promise<kritor.authentication.IAuthenticateResponse>((resolve, reject) => {
      this.services.authentication.authenticate({ account, ticket }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }

  /**
   * 获取鉴权状态
   * @param account
   */
  async getAuthenticationState(account: string) {
    return new Promise<kritor.authentication.IGetAuthenticationStateResponse>((resolve, reject) => {
      this.services.authentication.getAuthenticationState({ account }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }

  /**
   * 通过账户和super_ticket获取ticket
   * @param account
   * @param super_ticket
   */
  async getTicket(account: string, super_ticket: string) {
    return new Promise<kritor.authentication.IGetTicketResponse>((resolve, reject) => {
      this.services.authentication.getTicket({ account, super_ticket }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }

  /**
   * 添加指定账户ticket
   * @param account
   * @param super_ticket
   * @param ticket
   */
  async addTicket(account?: string, super_ticket?: string, ticket?: string) {
    return new Promise<kritor.authentication.IAddTicketResponse>((resolve, reject) => {
      this.services.authentication.addTicket({ account, super_ticket, ticket }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }

  /**
   * 删除指定账户ticket
   * @param account
   * @param super_ticket
   * @param ticket
   */
  async deleteTicket(account?: string, super_ticket?: string, ticket?: string) {
    return new Promise<kritor.authentication.IDeleteTicketResponse>((resolve, reject) => {
      this.services.authentication.deleteTicket({ account, super_ticket, ticket }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }

  /**
   * 下载文件
   * @param options
   */
  async downloadFile(options: Parameters<typeof this.services.core.downloadFile>[0]) {
    return new Promise<kritor.core.IDownloadFileResponse>((resolve, reject) => {
      this.services.core.downloadFile(options, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }

  /**
   * 获取当前账户
   */
  async getCurrentAccount() {
    return new Promise<kritor.core.IGetCurrentAccountResponse>((resolve, reject) => {
      this.services.core.getCurrentAccount({}, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }

  /**
   * 切换账户
   * @param account_uid
   * @param account_uin
   * @param super_ticket
   */
  async switchAccount(account_uid: string, account_uin: number, super_ticket: string) {
    return new Promise<kritor.core.ISwitchAccountResponse>((resolve, reject) => {
      this.services.core.switchAccount({ account_uid, account_uin, super_ticket }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }

  /**
   * 调用原生方法
   * @param options
   */
  async callFunction(options: Parameters<typeof this.services.customization.callFunction>[0]) {
    return new Promise<kritor.common.IResponse | undefined>((resolve, reject) => {
      this.services.customization.callFunction(options, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }

  /**
   * 执行shell命令
   * @param command
   * @param directory
   */
  async shell(command: string[], directory: string) {
    return new Promise<kritor.developer.IShellResponse>((resolve, reject) => {
      this.services.developer.shell({ command, directory }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }

  /**
   * 获取日志
   * @param start
   * @param recent
   */
  async getLog(start: number, recent?: boolean) {
    return new Promise<kritor.developer.IGetLogResponse>((resolve, reject) => {
      this.services.developer.getLog({ start, recent }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }

  /**
   * 清理缓存
   */
  async cleanCache() {
    return new Promise<kritor.developer.IClearCacheResponse>((resolve, reject) => {
      this.services.developer.clearCache({}, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }

  /**
   * 获取设备电量
   */
  async getDeviceBattery() {
    return new Promise<kritor.developer.IGetDeviceBatteryResponse>((resolve, reject) => {
      this.services.developer.getDeviceBattery({}, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }

  /**
   * 上传图片
   * @param options
   */
  async uploadImage(options: Parameters<typeof this.services.developer.uploadImage>[0]) {
    return new Promise<kritor.developer.IUploadImageResponse>((resolve, reject) => {
      this.services.developer.uploadImage(options, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }

  /**
   * 发包
   * @param command
   * @param request_buffer
   * @param is_protobuf
   * @param attrs
   */
  sendPacket(command: string, request_buffer: Buffer, is_protobuf?: boolean, attrs?: Record<string, string>) {
    return new Promise<kritor.developer.ISendPacketResponse>((resolve, reject) => {
      this.services.developer.sendPacket({ command, request_buffer, is_protobuf, attrs }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }
  sign(uin: string, command: string, seq: number, buffer: Buffer, qua: string) {
    return new Promise<kritor.developer.ISignResponse>((resolve, reject) => {
      this.services.qsign.sign({ uin, command, seq, buffer, qua }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }
  async energy(data: string, salt: Buffer) {
    return new Promise<kritor.developer.IEnergyResponse>((resolve, reject) => {
      this.services.qsign.energy({ data, salt }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }

  /**
   * 获取cmd白名单
   */
  async getCmdWhitelist() {
    return new Promise<kritor.developer.IGetCmdWhitelistResponse>((resolve, reject) => {
      this.services.qsign.getCmdWhitelist({}, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }

  /**
   * 创建群文件夹
   * @param group_id
   * @param name
   */
  async createFolder(group_id: number, name: string) {
    return new Promise<kritor.file.ICreateFolderResponse>((resolve, reject) => {
      this.services.groupFile.createFolder({ group_id, name }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }

  /**
   * 重命名群文件夹
   * @param group_id
   * @param folder_id
   * @param name
   */
  async renameFolder(group_id: number, folder_id: string, name: string) {
    return new Promise<kritor.file.IRenameFolderResponse>((resolve, reject) => {
      this.services.groupFile.renameFolder({ group_id, folder_id, name }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }

  /**
   * 删除群文件夹
   * @param group_id
   * @param folder_id
   */
  async deleteFolder(group_id: number, folder_id: string) {
    return new Promise<kritor.file.IDeleteFolderResponse>((resolve, reject) => {
      this.services.groupFile.deleteFolder({ group_id, folder_id }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }
  async deleteFile(group_id: number, file_id: string, bus_id: number) {
    return new Promise<kritor.file.IDeleteFileResponse>((resolve, reject) => {
      this.services.groupFile.deleteFile({ group_id, file_id, bus_id }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }

  /**
   * 获取群文件系统
   * @param group_id
   */
  async getFileSystemInfo(group_id: number) {
    return new Promise<kritor.file.IGetFileSystemInfoResponse>((resolve, reject) => {
      this.services.groupFile.getFileSystemInfo({ group_id }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }

  /**
   * 获取群指定目录文件列表
   * @param group_id
   * @param folder_id
   */
  async getFileList(group_id: number, folder_id: string) {
    return new Promise<kritor.file.IGetFileListResponse>((resolve, reject) => {
      this.services.groupFile.getFileList({ group_id, folder_id }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }

  /**
   * 获取好友列表
   */
  async getFriendList() {
    return new Promise<kritor.friend.IFriendInfo[]>((resolve, reject) => {
      this.services.friend.getFriendList({}, (err, res) => {
        if (err) reject(err);
        resolve(res!.friends_info);
      });
    });
  }

  /**
   * 获取好友资料
   * @param target_uid
   */
  async getFriendProfileCard(target_uid: string) {
    return new Promise<kritor.friend.IFriendInfo>((resolve, reject) => {
      this.services.friend.getFriendProfileCard({ target_uids: [target_uid] }, (err, res) => {
        if (err) reject(err);
        resolve(res!.friends_profile_card[0]);
      });
    });
  }

  /**
   * 获取陌生人资料
   * @param target_uid
   */
  async getStrangerProfileCard(target_uid: string) {
    return new Promise<kritor.friend.IProfileCard>((resolve, reject) => {
      this.services.friend.getStrangerProfileCard({ target_uids: [target_uid] }, (err, res) => {
        if (err) reject(err);
        resolve(res!.strangers_profile_card[0]);
      });
    });
  }

  /**
   * 是否黑名单用户
   * @param target_uid
   */
  async isBlackUser(target_uid: string) {
    return new Promise<boolean>((resolve, reject) => {
      this.services.friend.isBlackListUser({ target_uid }, (err, res) => {
        if (err) reject(err);
        resolve(res!.is_black_list_user);
      });
    });
  }

  /**
   * 点赞
   * @param target_uid
   * @param vote_count
   */
  async voteUser(target_uid: string, vote_count = 10) {
    return new Promise<kritor.friend.IVoteUserResponse | undefined>((resolve, reject) => {
      this.services.friend.voteUser({ target_uid, vote_count }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }

  /**
   * 通过uin获取uid
   * @param target_uins
   */
  async getUidByUin(...target_uins: number[]) {
    return new Promise<Record<string, string>>((resolve, reject) => {
      this.services.friend.getUidByUin({ target_uins }, (err, res) => {
        if (err) reject(err);
        resolve(res!.uid_map);
      });
    });
  }

  /**
   * 通过uid获取uin
   * @param target_uids
   */
  async getUinByUid(...target_uids: string[]) {
    return new Promise<Record<string, number | Long>>((resolve, reject) => {
      this.services.friend.getUinByUid({ target_uids }, (err, res) => {
        if (err) reject(err);
        resolve(res!.uin_map);
      });
    });
  }

  /**
   * 获取群列表
   */
  async getGroupList() {
    return new Promise<kritor.group.IGroupInfo[]>((resolve, reject) => {
      this.services.group.getGroupList({}, (err, res) => {
        if (err) reject(err);
        resolve(res!.groups_info);
      });
    });
  }

  /**
   * 发送消息
   * @param contact
   * @param elements
   * @param retry_count
   */
  async sendMessage(contact: kritor.common.IContact, elements: kritor.common.IElement[], retry_count = 1) {
    return new Promise<kritor.message.ISendMessageResponse | undefined>((resolve, reject) => {
      this.services.message.sendMessage({ contact, elements, retry_count }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }

  /**
   * 通过消息res_id发送消息
   * @param contact
   * @param res_id
   * @param retry_count
   */
  async sendMessageByResId(contact: kritor.common.IContact, res_id: string, retry_count = 1) {
    return new Promise<kritor.message.ISendMessageResponse | undefined>(async (resolve, reject) => {
      this.services.message.sendMessageByResId({ contact, res_id, retry_count }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }

  /**
   * 设置已读某个联系人的消息
   * @param contact
   */
  async setMessageReaded(contact: kritor.common.IContact) {
    return new Promise<kritor.message.ISetMessageReadResponse | undefined>((resolve, reject) => {
      this.services.message.setMessageReaded({ contact }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }

  /**
   * 撤回消息
   * @param contact
   * @param message_id
   */
  recallMessage(contact: kritor.common.IContact, message_id: string) {
    return new Promise<kritor.message.IRecallMessageResponse | undefined>((resolve, reject) => {
      this.services.message.recallMessage({ contact, message_id }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }

  /**
   * 设置消息表态
   * @param contact
   * @param message_id
   * @param face_id
   * @param is_set
   */
  async reactMessageWithEmoji(contact: kritor.common.IContact, message_id: string, face_id: number, is_set?: boolean) {
    return new Promise<kritor.message.IReactMessageWithEmojiResponse | undefined>((resolve, reject) => {
      this.services.message.reactMessageWithEmoji({ contact, message_id, face_id, is_set }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }

  /**
   * 通过消息id获取消息
   * @param contact
   * @param message_id
   */
  async getMessage(contact: kritor.common.IContact, message_id: string) {
    return new Promise<kritor.message.IGetMessageResponse | undefined>((resolve, reject) => {
      this.services.message.getMessage({ contact, message_id }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }

  /**
   * 通过消息seq获取消息
   * @param contact
   * @param message_seq
   */
  async getMessageBySeq(contact: kritor.common.IContact, message_seq: number) {
    return new Promise<kritor.message.IGetMessageResponse | undefined>((resolve, reject) => {
      this.services.message.getMessageBySeq({ contact, message_seq }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }

  /**
   * 通过消息id获取历史消息
   * @param contact
   * @param start_message_id
   * @param count
   */
  async getHistoryMessage(contact: kritor.common.IContact, start_message_id: string, count: number = 10) {
    return new Promise<kritor.message.IGetHistoryMessageResponse | undefined>((resolve, reject) => {
      this.services.message.getHistoryMessage({ contact, start_message_id, count }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }

  /**
   * 通过消息seq获取历史消息
   * @param contact
   * @param start_message_seq
   * @param count
   */
  async getHistoryMessageBySeq(contact: kritor.common.IContact, start_message_seq: number, count = 10) {
    return new Promise<kritor.message.IGetHistoryMessageResponse | undefined>((resolve, reject) => {
      this.services.message.getHistoryMessageBySeq({ contact, start_message_seq, count }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }

  /**
   * 上传转发消息
   * @param contact
   * @param messages
   * @param retry_count
   */
  async uploadForwardMessage(
    contact: kritor.common.IContact,
    messages: kritor.common.IForwardMessageBody[],
    retry_count = 1,
  ) {
    return new Promise<string | undefined>((resolve, reject) => {
      for (let i = 0; i < retry_count; i++) {
        this.services.message.uploadForwardMessage({ contact, messages }, (err, res) => {
          if (err) reject(err);
          resolve(res?.res_id);
        });
      }
    });
  }

  /**
   * 下载转发消息
   * @param res_id
   */
  async downloadForwardMessage(res_id: string) {
    return new Promise<kritor.message.IDownloadForwardMessageResponse | undefined>((resolve, reject) => {
      this.services.message.downloadForwardMessage({ res_id }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }

  /**
   * 获取群精华消息列表
   * @param group_id
   * @param page
   * @param page_size
   */
  async getEssenceMessageList(group_id: number, page = 1, page_size = 10) {
    return new Promise<kritor.message.IGetEssenceMessageListResponse | undefined>((resolve, reject) => {
      this.services.message.getEssenceMessageList({ group_id, page, page_size }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }

  /**
   * 加精群消息
   * @param group_id
   * @param message_id
   */
  async setEssenceMessage(group_id: number, message_id: string) {
    return new Promise<kritor.message.ISetEssenceMessageResponse | undefined>((resolve, reject) => {
      this.services.message.setEssenceMessage({ group_id, message_id }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }

  /**
   * 取消加精群消息
   * @param group_id
   * @param message_id
   */
  async deleteEssenceMessage(group_id: number, message_id: string) {
    return new Promise<kritor.message.IDeleteEssenceMessageResponse | undefined>((resolve, reject) => {
      this.services.message.deleteEssenceMessage({ group_id, message_id }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }
  async getCookies(domain: string) {
    return new Promise<string | undefined>((resolve, reject) => {
      this.services.web.getCookies({ domain }, (err, res) => {
        if (err) reject(err);
        resolve(res?.cookie);
      });
    });
  }
  async getCredentials(domain: string) {
    return new Promise<kritor.web.IGetCredentialsResponse | undefined>((resolve, reject) => {
      this.services.web.getCredentials({ domain }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }
  async getCSRFToken(domain: string) {
    return new Promise<string | undefined>((resolve, reject) => {
      this.services.web.getCSRFToken({ domain }, (err, res) => {
        if (err) reject(err);
        resolve(res?.bkn);
      });
    });
  }
  async getHttpCookies(appid: string, daid?: string, jump_url?: string) {
    return new Promise<string | undefined>((resolve, reject) => {
      this.services.web.getHttpCookies({ appid, daid, jump_url }, (err, res) => {
        if (err) reject(err);
        resolve(res?.cookie);
      });
    });
  }
}
export namespace Client {
  export interface Options {
    url: string;
    ticket?: string;
  }
  export type Services = {
    authentication: kritor.authentication.AuthenticationService;
    core: kritor.core.CoreService;
    customization: kritor.customization.CustomizationService;
    event: kritor.event.EventService;
    friend: kritor.friend.FriendService;
    group: kritor.group.GroupService;
    groupFile: kritor.file.GroupFileService;
    guild: kritor.guild.GuildService;
    message: kritor.message.MessageService;
    reverse: kritor.reverse.ReverseService;
    developer: kritor.developer.DeveloperService;
    qsign: kritor.developer.QsignService;
    web: kritor.web.WebService;
  };
  export function createElementsFromTemplate(template: string): kritor.common.IElement[] {
    return parseFromTemplate(template).map(item => {
      const { type, data } = item;
      return Client.toKritorElement(type, data);
    }) as kritor.common.IElement[];
  }
  export function eventMessageToString(event: kritor.common.IPushMessageBody) {
    return (event.elements || [])
      .map(element => {
        const { type, ...attrs } = element;
        const key = Reflect.get(attrs, 'data');
        const data = Reflect.get(attrs, key);
        if (type === kritor.common.Element.ElementType.TEXT) return data.text || '';
        return `<${key} ${Object.entries(data)
          .filter(([key]) => !key.startsWith('_'))
          .map(([key, value]) => {
            return `${key}='${encodeURIComponent(JSON.stringify(value))}'`;
          })
          .join(' ')}/>`;
      })
      .join('');
  }
  export const sceneMap: Record<string, kritor.common.Scene> = {
    guild: kritor.common.Scene.GUILD,
    group: kritor.common.Scene.GROUP,
    private: kritor.common.Scene.FRIEND,
    temp_from_group: kritor.common.Scene.STRANGER_FROM_GROUP,
    temp: kritor.common.Scene.STRANGER,
  };
  export const messageTypeMap: Record<kritor.common.Scene, string> = Object.fromEntries(
    Object.entries(sceneMap).map(([key, value]) => {
      return [value, key];
    }),
  ) as Record<kritor.common.Scene, string>;
  export function getMessageType(event: kritor.common.IPushMessageBody) {
    return messageTypeMap[event.contact?.scene!];
  }
  export const elementTypeMap = {
    [kritor.common.Element.ElementType.TEXT]: 'text',
    [kritor.common.Element.ElementType.RPS]: 'rps',
    [kritor.common.Element.ElementType.DICE]: 'dice',
    [kritor.common.Element.ElementType.IMAGE]: 'image',
    [kritor.common.Element.ElementType.AT]: 'at',
    [kritor.common.Element.ElementType.BASKETBALL]: 'basketball',
    [kritor.common.Element.ElementType.BUBBLE_FACE]: 'bubble',
    [kritor.common.Element.ElementType.CONTACT]: 'contact',
    [kritor.common.Element.ElementType.FACE]: 'face',
    [kritor.common.Element.ElementType.FILE]: 'file',
    [kritor.common.Element.ElementType.FORWARD]: 'forward',
    [kritor.common.Element.ElementType.GIFT]: 'gift',
    [kritor.common.Element.ElementType.JSON]: 'json',
    [kritor.common.Element.ElementType.LOCATION]: 'location',
    [kritor.common.Element.ElementType.KEYBOARD]: 'keyboard',
    [kritor.common.Element.ElementType.MARKDOWN]: 'markdown',
    [kritor.common.Element.ElementType.POKE]: 'poke',
    [kritor.common.Element.ElementType.REPLY]: 'reply',
    [kritor.common.Element.ElementType.MUSIC]: 'music',
    [kritor.common.Element.ElementType.SHARE]: 'share',
    [kritor.common.Element.ElementType.WEATHER]: 'weather',
    [kritor.common.Element.ElementType.VOICE]: 'voice',
    [kritor.common.Element.ElementType.VIDEO]: 'video',
    [kritor.common.Element.ElementType.XML]: 'xml',
    [kritor.common.Element.ElementType.MARKET_FACE]: 'market_face',
  };
  type ElementTypeMap = typeof elementTypeMap;
  export type ElementType = ElementTypeMap[keyof ElementTypeMap];
  export function toKritorElement(type: ElementType, data: Dict) {
    switch (type) {
      case 'text':
        return { text: data };
      case 'rps':
        return { rps: data };
      case 'dice':
        return { dice: data };
      case 'image':
        return { image: data };
      case 'at':
        return { at: data };
      case 'basketball':
        return { basketball: data };
      case 'bubble':
        return { bubble: data };
      case 'contact':
        return { contact: data };
      case 'face':
        return { face: data };
      case 'file':
        return { file: data };
      case 'forward':
        return { forward: data };
      case 'gift':
        return { gift: data };
      case 'json':
        return { json: data };
      case 'location':
        return { location: data };
      case 'keyboard':
        return { keyboard: data };
      case 'markdown':
        return { markdown: data };
      case 'poke':
        return { poke: data };
      case 'reply':
        return { reply: data };
      case 'music':
        return { music: data };
      case 'share':
        return { share: data };
      case 'weather':
        return { weather: data };
      case 'voice':
        return { voice: data };
      case 'video':
        return { video: data };
      case 'xml':
        return { xml: data };
      case 'market_face':
        return { market_face: data };
      default:
        throw new Error(`Unsupported element type: ${type}`);
    }
  }
}
