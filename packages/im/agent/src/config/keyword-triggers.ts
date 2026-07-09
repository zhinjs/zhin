/** 上下文感知内置工具的关键词触发正则 */
export const KEYWORD_TRIGGERS = {
  chatHistory: /之前|上次|历史|回忆|聊过|记录|还记得|曾经/i,
  userProfile: /偏好|设置|配置|档案|资料|时区|timezone|profile|喜好|我叫|叫我|记住我/i,
} as const;
