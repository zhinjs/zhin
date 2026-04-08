/** 链接解析结果 */
export interface LinkMeta {
  platform: 'bilibili' | 'github' | 'douyin' | 'xiaohongshu'
  title: string
  description?: string
  author?: string
  authorAvatar?: string
  /** 封面图（已转为 data URI） */
  cover?: string
  url: string
  stats?: Record<string, string>
}

/** 平台视觉主题 */
export interface PlatformTheme {
  name: string
  color: string
  bg: string
}
