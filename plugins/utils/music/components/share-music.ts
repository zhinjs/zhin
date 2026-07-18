import { defineComponent } from '@zhin.js/component';
import { musicServices } from '../src/sources/index.js';
import { sourceConfigMap } from '../src/config.js';
import type { MusicSource } from '../src/types.js';

interface ShareMusicProps {
  readonly platform: MusicSource;
  readonly musicId: string;
}

/**
 * Async music share card. Adapters that understand `share` segments render the
 * rich card; others may fall back to text.
 */
export default defineComponent<ShareMusicProps>({
  async render({ platform, musicId }) {
    const service = musicServices[platform];
    if (!service) return 'unsupported music source';
    const detail = await service.getDetail(musicId);
    const { id: _id, source: _source, ...rest } = detail;
    return {
      type: 'share',
      data: {
        ...rest,
        config: sourceConfigMap[platform],
      },
    };
  },
});
