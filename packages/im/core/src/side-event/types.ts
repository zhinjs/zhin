/** Semantic names for independent Notice, Request and SystemEvent contracts. */
export type SideEventKind = 'notice' | 'request';
export type EndpointEventKind = SideEventKind | 'system';

export type NoticeKind = 'notice';
export type RequestKind = 'request';
export type SystemKind = 'system';

/** 完整组合名（测试 / 文档 / 消费者匹配用） */
export type ComposedNoticeName =
  | 'notice.group.member_increase'
  | 'notice.group.member_decrease'
  | 'notice.group.admin_change'
  | 'notice.group.ban'
  | 'notice.group.recall'
  | 'notice.group.poke'
  | 'notice.group.transfer'
  | 'notice.group.upload'
  | 'notice.group.emoji_reaction'
  | 'notice.group.card_change'
  | 'notice.group.title_change'
  | 'notice.group.remark_change'
  | 'notice.group.notice_updated'
  | 'notice.group.essence_add'
  | 'notice.group.essence_delete'
  | 'notice.friend.recall'
  | 'notice.friend.increase'
  | 'notice.friend.poke'
  | 'notice.endpoint.lifecycle'
  | (string & {});

export type ComposedRequestName =
  | 'request.friend.add'
  | 'request.group.add'
  | 'request.group.invite'
  | (string & {});

export type ComposedSystemName =
  | 'system.login.qrcode'
  | 'system.login.slider'
  | 'system.login.device'
  | 'system.login.error'
  | 'system.login.auth'
  | 'system.offline'
  | 'system.offline.network'
  | 'system.offline.kickoff'
  | 'system.online'
  | (string & {});

export interface SideEventParts {
  scene_type: string;
  sub_type: string;
}
