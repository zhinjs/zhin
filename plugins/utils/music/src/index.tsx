import { MessageCommand, usePlugin, defineComponent, Prompt } from "zhin.js";
import type {} from '@zhin.js/adapter-icqq'
import { musicServices } from "./sources/index.js";
import { sourceConfigMap } from "./config.js";
import type { MusicSource } from "./types.js";

const plugin = usePlugin();
const { logger, addCommand, addComponent} = plugin;

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
addCommand(
  new MessageCommand<"icqq">("点歌 <keyword:text>")
    .permit("adapter(icqq)")
    .action(async (message, result) => {
      const keyword = result.params.keyword;
      const sourcesParam = result.params.sources || [];

      // 解析音乐源
      const sources: MusicSource[] = [];
      for (const source of sourcesParam) {
        const normalized = source.toLowerCase();
        if (["qq", "netease"].includes(normalized)) {
          sources.push(normalized as MusicSource);
        }
      }

      // 如果没有指定音乐源，默认搜索 QQ 和网易云
      const searchSources: MusicSource[] =
        sources.length > 0 ? sources : ["qq", "netease"];

      logger.info(`搜索音乐: ${keyword}, 来源: ${searchSources.join(", ")}`);

      // 并行搜索多个音乐源
      const searchPromises = searchSources.map((source) =>
        musicServices[source].search(keyword, 5)
      );

      const searchResults = await Promise.all(searchPromises);
      const allMusic = searchResults.flat().filter(Boolean);

      if (allMusic.length === 0) {
        await message.$reply("没有找到结果");
        return;
      }

      // 使用 Prompt 让用户选择
      const prompt = new Prompt(plugin, message);
      const musicUrl = await prompt.pick("请选择搜索结果", {
        type: "text",
        options: allMusic.map((music) => ({
          label: `${music.title} [${music.source.toUpperCase()}]`,
          value: music.url,
        })),
      });

      if (!musicUrl) return;

      const music = allMusic.find((m) => m.url === musicUrl)!;
      
      // 现在支持直接使用 JSX 语法，异步组件会自动 await
      return <ShareMusic platform={music.source} musicId={music.id} />
    })
);

