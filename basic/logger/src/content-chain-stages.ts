import { formatCompactLog, type CompactFieldValue } from './compact-log.js';

/** AI 内容链 stage SSOT */
export const CONTENT_CHAIN_STAGE = {
  STT: 'stt',
  RICH_SEGMENT: 'rich_segment',
  MULTIMODAL: 'multimodal',
  OUTBOUND: 'outbound',
  EXTRACT_MEDIA: 'extract_media',
} as const;

export type ContentChainStage =
  (typeof CONTENT_CHAIN_STAGE)[keyof typeof CONTENT_CHAIN_STAGE] | string;

export interface ContentChainLogFields extends Record<string, CompactFieldValue | undefined> {
  stage: ContentChainStage;
  kind?: string;
  mode?: string;
  fallback?: boolean | string;
  peer?: string;
  adapter?: string;
  ok?: boolean;
}

/** 统一 `[Content Chain] stage: …` 日志体 */
export function formatContentChainLog(fields: ContentChainLogFields): string {
  return formatCompactLog('Content Chain', fields);
}
