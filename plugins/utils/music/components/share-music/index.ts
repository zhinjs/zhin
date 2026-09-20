import { defineComponent } from 'zhin.js/component';
import { sourceConfigMap } from '../../src/config.js';
import type { MusicSource } from '../../src/types.js';
import { musicRuntimeToken } from '../../src/runtime.js';

interface ShareMusicProps {
  readonly platform: MusicSource;
  readonly musicId: string;
}

export default defineComponent<ShareMusicProps>({
  async render({ platform, musicId }, context) {
    const service = context.use(musicRuntimeToken).services[platform];
    if (!service) return 'unsupported music source';
    const detail = await service.getDetail(musicId);
    return {
      type: 'share',
      data: {
        title: detail.title,
        url: detail.url,
        image: detail.image,
        audio: detail.audio,
        duration: detail.duration,
        artist: detail.artist,
        config: sourceConfigMap[platform],
      },
    };
  },
});
