import { EventEmitter } from 'events';
import * as grpc from '@grpc/grpc-js';
import { loadSync, Long } from '@grpc/proto-loader';
import { kritor, proto } from 'kritor-proto';
import * as path from 'path';
import { Adapter } from 'zhin';
type ServiceConstruct<T> = new (host: string, credentials: grpc.ChannelCredentials) => T;
export class Client extends EventEmitter {
  services: Client.Services;
  account?: kritor.core.GetCurrentAccountResponse;
  #credential: grpc.ChannelCredentials;
  constructor(
    public adapter: Adapter,
    public options: Client.Options,
  ) {
    super();
    this.#credential = grpc.credentials.createInsecure();
    this.services = this.#init();
  }
  get logger() {
    return this.adapter.getLogger(this.account?.account_name);
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
    return new kritor.common.Contact({
      scene: Client.sceneMap[target_type],
      peer,
      sub_peer: sub_peer || undefined,
    });
  }
  #emitEvent(error: null | Error, event?: kritor.event.EventStructure) {
    if (error) return this.emit('error', error);
    switch (event?.event) {
      case 'message':
        return this.emit('message', event.message);
      case 'notice':
        return this.emit('notice', event.notice);
      case 'request':
        return this.emit('request', event.request);
      default:
        throw new Error('Unknown event ' + event?.toJSON());
    }
  }
  #addListener(service: kritor.event.EventService) {
    service.registerActiveListener({ type: kritor.event.EventType.EVENT_TYPE_CORE_EVENT }, this.#emitEvent.bind(this));
    service.registerActiveListener({ type: kritor.event.EventType.EVENT_TYPE_MESSAGE }, this.#emitEvent.bind(this));
    service.registerActiveListener({ type: kritor.event.EventType.EVENT_TYPE_NOTICE }, this.#emitEvent.bind(this));
    service.registerActiveListener({ type: kritor.event.EventType.EVENT_TYPE_REQUEST }, this.#emitEvent.bind(this));
  }
  async start() {
    const ticket = Math.random().toString(36);
    await this.addTicket(undefined, 'superTicket', ticket);

    const result = await this.authenticate(undefined, ticket);
    console.log(result);
    await this.deleteTicket(undefined, 'superTicket', ticket);
  }
  async stop() {
    for (const service of Object.values(this.services)) {
      service.end();
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
        enums: String,
        defaults: true,
        oneofs: true,
      }),
    );
    const Service = Reflect.get(Reflect.get(grpcObject, serviceKey), serviceName) as grpc.ServiceClientConstructor;
    return new Service(this.options.url, this.#credential) as T;
  }

  async authenticate(account?: string, ticket?: string) {
    return new Promise<kritor.authentication.AuthenticateResponse>((resolve, reject) => {
      this.services.authentication.authenticate({ account, ticket }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }
  async getAuthenticationState(account: string) {
    return new Promise<kritor.authentication.GetAuthenticationStateResponse>((resolve, reject) => {
      this.services.authentication.getAuthenticationState({ account }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }
  async getTicket(account: string, super_ticket: string) {
    return new Promise<kritor.authentication.GetTicketResponse>((resolve, reject) => {
      this.services.authentication.getTicket({ account, super_ticket }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }
  async addTicket(account?: string, super_ticket?: string, ticket?: string) {
    return new Promise<kritor.authentication.AddTicketResponse>((resolve, reject) => {
      this.services.authentication.addTicket({ account, super_ticket, ticket }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }
  async deleteTicket(account?: string, super_ticket?: string, ticket?: string) {
    return new Promise<kritor.authentication.DeleteTicketResponse>((resolve, reject) => {
      this.services.authentication.deleteTicket({ account, super_ticket, ticket }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }
  async downloadFile(options: Parameters<typeof this.services.core.downloadFile>[0]) {
    return new Promise<kritor.core.DownloadFileResponse>((resolve, reject) => {
      this.services.core.downloadFile(options, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }
  async getCurrentAccount() {
    return new Promise<kritor.core.GetCurrentAccountResponse>((resolve, reject) => {
      this.services.core.getCurrentAccount({}, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }
  async switchAccount(account_uid: string, account_uin: number, super_ticket: string) {
    return new Promise<kritor.core.SwitchAccountResponse>((resolve, reject) => {
      this.services.core.switchAccount({ account_uid, account_uin, super_ticket }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }
  async callFunction(options: Parameters<typeof this.services.customization.callFunction>[0]) {
    return new Promise<kritor.common.Response | undefined>((resolve, reject) => {
      this.services.customization.callFunction(options, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }
  async shell(command: string[], directory: string) {
    return new Promise<kritor.developer.ShellResponse>((resolve, reject) => {
      this.services.developer.shell({ command, directory }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }
  async getLog(start: number, recent?: boolean) {
    return new Promise<kritor.developer.GetLogResponse>((resolve, reject) => {
      this.services.developer.getLog({ start, recent }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }
  async cleanCache() {
    return new Promise<kritor.developer.ClearCacheResponse>((resolve, reject) => {
      this.services.developer.clearCache({}, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }
  async getDeviceBattery() {
    return new Promise<kritor.developer.GetDeviceBatteryResponse>((resolve, reject) => {
      this.services.developer.getDeviceBattery({}, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }
  async uploadImage(options: Parameters<typeof this.services.developer.uploadImage>[0]) {
    return new Promise<kritor.developer.UploadImageResponse>((resolve, reject) => {
      this.services.developer.uploadImage(options, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }
  sendPacket(command: string, request_buffer: Buffer, is_protobuf?: boolean, attrs?: Record<string, string>) {
    return new Promise<kritor.developer.SendPacketResponse>((resolve, reject) => {
      this.services.developer.sendPacket({ command, request_buffer, is_protobuf, attrs }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }
  sign(uin: string, command: string, seq: number, buffer: Buffer, qua: string) {
    return new Promise<kritor.developer.SignResponse>((resolve, reject) => {
      this.services.qsign.sign({ uin, command, seq, buffer, qua }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }
  async energy(data: string, salt: Buffer) {
    return new Promise<kritor.developer.EnergyResponse>((resolve, reject) => {
      this.services.qsign.energy({ data, salt }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }
  async getCmdWhitelist() {
    return new Promise<kritor.developer.GetCmdWhitelistResponse>((resolve, reject) => {
      this.services.qsign.getCmdWhitelist({}, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }
  async createFolder(group_id: number, name: string) {
    return new Promise<kritor.file.CreateFolderResponse>((resolve, reject) => {
      this.services.groupFile.createFolder({ group_id, name }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }
  async renameFolder(group_id: number, folder_id: string, name: string) {
    return new Promise<kritor.file.RenameFolderResponse>((resolve, reject) => {
      this.services.groupFile.renameFolder({ group_id, folder_id, name }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }
  async deleteFolder(group_id: number, folder_id: string) {
    return new Promise<kritor.file.DeleteFolderResponse>((resolve, reject) => {
      this.services.groupFile.deleteFolder({ group_id, folder_id }, (err, res) => {
        if (err) reject(err);
        resolve(res!);
      });
    });
  }
  async deleteFile(group_id: number, file_id: string, bus_id: number) {
    return new Promise<kritor.file.DeleteFileResponse>((resolve, reject) => {
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
    return new Promise<kritor.file.GetFileSystemInfoResponse>((resolve, reject) => {
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
    return new Promise<kritor.file.GetFileListResponse>((resolve, reject) => {
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
    return new Promise<kritor.friend.VoteUserResponse | undefined>((resolve, reject) => {
      this.services.friend.voteUser({ target_uid, vote_count }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }
  async getUidByUin(...target_uins: number[]) {
    return new Promise<Record<string, string>>((resolve, reject) => {
      this.services.friend.getUidByUin({ target_uins }, (err, res) => {
        if (err) reject(err);
        resolve(res!.uid_map);
      });
    });
  }
  async getUinByUid(...target_uids: string[]) {
    return new Promise<Record<string, number | Long>>((resolve, reject) => {
      this.services.friend.getUinByUid({ target_uids }, (err, res) => {
        if (err) reject(err);
        resolve(res!.uin_map);
      });
    });
  }
  async getGroupList() {
    return new Promise<kritor.group.IGroupInfo[]>((resolve, reject) => {
      this.services.group.getGroupList({}, (err, res) => {
        if (err) reject(err);
        resolve(res!.groups_info);
      });
    });
  }
  async sendMessage(contact: kritor.common.Contact, elements: kritor.common.Element[], retry_count = 1) {
    return new Promise<kritor.message.SendMessageResponse | undefined>((resolve, reject) => {
      for (let i = 0; i < retry_count; i++) {
        this.services.message.sendMessage({ contact, elements }, (err, res) => {
          if (!err) {
            resolve(res);
            return;
          }
          console.error(`sendMessage failed, retrying ${retry_count - i} times...`, err);
        });
      }
    });
  }
  async sendMessageByResId(contact: kritor.common.Contact, res_id: string, retry_count = 1) {
    return new Promise<kritor.message.SendMessageResponse | undefined>((resolve, reject) => {
      for (let i = 0; i < retry_count; i++) {
        this.services.message.sendMessageByResId({ contact, res_id }, (err, res) => {
          if (!err) {
            resolve(res);
            return;
          }
          console.error(`sendMessageByResId failed, retrying ${retry_count - i} times...`, err);
        });
      }
    });
  }
  async setMessageReaded(contact: kritor.common.Contact) {
    return new Promise<kritor.message.SetMessageReadResponse | undefined>((resolve, reject) => {
      this.services.message.setMessageReaded({ contact }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }
  recallMessage(contact: kritor.common.Contact, message_id: string) {
    return new Promise<kritor.message.RecallMessageResponse | undefined>((resolve, reject) => {
      this.services.message.recallMessage({ contact, message_id }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }
  async reactMessageWithEmoji(contact: kritor.common.Contact, message_id: string, face_id: number, is_set?: boolean) {
    return new Promise<kritor.message.ReactMessageWithEmojiResponse | undefined>((resolve, reject) => {
      this.services.message.reactMessageWithEmoji({ contact, message_id, face_id, is_set }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }
  async getMessage(contact: kritor.common.Contact, message_id: string) {
    return new Promise<kritor.message.GetMessageResponse | undefined>((resolve, reject) => {
      this.services.message.getMessage({ contact, message_id }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }
  async getMessageBySeq(contact: kritor.common.Contact, message_seq: number) {
    return new Promise<kritor.message.GetMessageResponse | undefined>((resolve, reject) => {
      this.services.message.getMessageBySeq({ contact, message_seq }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }
  async getHistoryMessage(contact: kritor.common.Contact, start_message_id: string, count: number = 10) {
    return new Promise<kritor.message.GetHistoryMessageResponse | undefined>((resolve, reject) => {
      this.services.message.getHistoryMessage({ contact, start_message_id, count }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }
  async getHistoryMessageBySeq(contact: kritor.common.Contact, start_message_seq: number, count = 10) {
    return new Promise<kritor.message.GetHistoryMessageResponse | undefined>((resolve, reject) => {
      this.services.message.getHistoryMessageBySeq({ contact, start_message_seq, count }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }
  async uploadForwardMessage(
    contact: kritor.common.Contact,
    messages: kritor.common.ForwardMessageBody[],
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
  async downloadForwardMessage(res_id: string) {
    return new Promise<kritor.message.DownloadForwardMessageResponse | undefined>((resolve, reject) => {
      this.services.message.downloadForwardMessage({ res_id }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }
  async getEssenceMessageList(group_id: number, page = 1, page_size = 10) {
    return new Promise<kritor.message.GetEssenceMessageListResponse | undefined>((resolve, reject) => {
      this.services.message.getEssenceMessageList({ group_id, page, page_size }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }
  async setEssenceMessage(group_id: number, message_id: string) {
    return new Promise<kritor.message.SetEssenceMessageResponse | undefined>((resolve, reject) => {
      this.services.message.setEssenceMessage({ group_id, message_id }, (err, res) => {
        if (err) reject(err);
        resolve(res);
      });
    });
  }
  async deleteEssenceMessage(group_id: number, message_id: string) {
    return new Promise<kritor.message.DeleteEssenceMessageResponse | undefined>((resolve, reject) => {
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
    return new Promise<kritor.web.GetCredentialsResponse | undefined>((resolve, reject) => {
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
    super_ticket?: string;
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
  export function createElementsFromTemplate(template: string): kritor.common.Element[] {
    return [];
  }
  export function eventMessageToString(event: kritor.common.IPushMessageBody) {
    return (event.elements || [])
      .map(element => {
        const { type, ...attrs } = element;
        return `<${element.type} ${Object.entries(attrs).map((key, valut) => {
          return `${key}='${encodeURIComponent(JSON.stringify(valut))}'`;
        })}>`;
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
}
