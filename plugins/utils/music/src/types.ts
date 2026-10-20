export type MusicSource = 'qq' | 'netease' | 'kuwo' | 'kugou';

export interface MusicInfo {
  id: string;
  source: MusicSource;
  url: string;
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
}

export interface MusicDetail extends MusicInfo {
  image: string;
  audio: string;
}

export interface MusicSourceConfig {
  appid: number;
  package: string;
  icon: string;
  sign: string;
  version: string;
}

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

export interface MusicSearchService {
  search(keyword: string, limit?: number): Promise<MusicInfo[]>;
  getDetail(id: string): Promise<MusicDetail>;
}
