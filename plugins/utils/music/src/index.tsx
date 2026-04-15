import { usePlugin, defineComponent, ZhinTool } from "zhin.js";
import { musicServices } from "./sources/index.js";
import { sourceConfigMap } from "./config.js";
import type { MusicSource } from "./types.js";

const plugin = usePlugin();
const { logger, useContext, addComponent } = plugin;

// 异步组件：分享音乐
const ShareMusic = defineComponent(async function ShareMusic({ platform, musicId }: { platform: MusicSource, musicId: string }) {
  const service = musicServices[platform];
  if (!service) return 'unsupported music source';
  const { id, source, ...detail } = await service.getDetail(musicId);
  return <share {...detail} config={sourceConfigMap[platform]} />
}, 'ShareMusic')
addComponent(ShareMusic)

// Suspense 组件 - 用于包装异步组件
const Suspense = defineComponent(async function Suspense(
  props: { fallback?: string; children?: any },
  context
) {
  try {
    // 如果 children 是一个 Promise（异步组件），等待它
    if (props.children && typeof props.children === 'object' && 'then' in props.children) {
      return await props.children;
    }
    // 否则直接返回
    return props.children || '';
  } catch (error) {
    logger.error('Suspense error:', error);
    return props.fallback || '加载失败';
  }
}, 'Suspense');

addComponent(Suspense);

// ============================================================================
// 点歌工具 (使用 ZhinTool)
// ============================================================================

const searchMusicTool = new ZhinTool('music_search')
  .desc('搜索音乐并返回结果列表')
  .tag('music', 'entertainment')
  .param('keyword', { type: 'string', description: '搜索关键词' }, true)
  .param('source', { 
    type: 'string', 
    description: '音乐源: qq, netease（默认两者都搜索）',
    enum: ['qq', 'netease']
  })
  .param('limit', { type: 'number', description: '返回结果数量（默认 5）' })
  .execute(async ({ keyword, source, limit = 5 }) => {
    const keywordStr = keyword as string;
    const limitNum = limit as number;
    
    // 确定搜索源
    const searchSources: MusicSource[] = source 
      ? [source as MusicSource] 
      : ['qq', 'netease'];

    logger.info(`AI 搜索音乐: ${keywordStr}, 来源: ${searchSources.join(', ')}`);

    // 并行搜索
    const searchPromises = searchSources.map(s => 
      musicServices[s].search(keywordStr, limitNum)
    );

    const searchResults = await Promise.all(searchPromises);
    const allMusic = searchResults.flat().filter(Boolean);

    return {
      success: true,
      keyword: keywordStr,
      results: allMusic.map(m => ({
        id: m.id,
        title: m.title,
        source: m.source,
        url: m.url,
      })),
      total: allMusic.length,
    };
  })
  .platform('icqq');  // 限制为 icqq 平台

// 分享音乐工具（直接分享指定音乐）
const shareMusicTool = new ZhinTool('music_share')
  .desc('分享指定的音乐')
  .tag('music', 'entertainment')
  .param('id', { type: 'string', description: '音乐 ID' }, true)
  .param('source', { 
    type: 'string', 
    description: '音乐源: qq 或 netease',
    enum: ['qq', 'netease']
  }, true)
  .platform('icqq')
  .execute(async ({ id, source }) => {
    const service = musicServices[source as MusicSource];
    if (!service) {
      return { success: false, error: `不支持的音乐源: ${source}` };
    }
    
    try {
      const detail = await service.getDetail(id as string);
      return {
        success: true,
        music: {
          id: detail.id,
          title: detail.title,
          source: detail.source,
          url: detail.url,
        }
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

// 注册工具
useContext('tool', (toolService) => {
  if (!toolService) return;
  
  const disposers = [
    toolService.addTool(searchMusicTool, 'music'),
    toolService.addTool(shareMusicTool, 'music'),
  ];
  
  logger.debug('音乐工具已注册');
  
  return () => disposers.forEach(d => d());
});
