// plugins/utils/music/src/types.ts

/** 音乐源类型 */
export type MusicSource = "qq" | "netease";

/** 音乐分享内容 */
export interface MusicInfo {
  id: string;
  source: MusicSource;
  /** 跳转链接 */
  url: string;
  /** 音乐标题 */
  title: string;
}
export interface MusicDetail extends MusicInfo {
  image: string;
  audio:string;
  duration?: number;
}

/** 音乐源配置 */
export interface MusicSourceConfig {
  appid: number;
  package: string;
  icon: string;
  sign: string;
  version: string;
}

/** QQ 音乐 API 响应 */
export interface MusicQQ {
  id: string;
  mid: string;
  name: string;
  docid: string;
  singer: string;
  album?: {
    mid: string;
    name: string;
  };
  interval?: number;
}

/** 网易云音乐 API 响应 */
export interface Music163 {
  id: string;
  name: string;
  duration?: number;
  artists?: Array<{
    id: string;
    name: string;
  }>;
  album: {
    id: string;
    name: string;
    picUrl: string | null;
    img1v1Url: string;
  };
}

/** 音乐搜索服务接口 */
export interface MusicSearchService {
  /** 搜索音乐 */
  search(keyword: string, limit?: number): Promise<MusicInfo[]>;
  /** 获取音乐详情 */
  getDetail(id: string): Promise<MusicDetail>;
}
