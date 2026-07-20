import { Feature, getPlugin, type FeatureJSON, type Plugin, type PluginLike, type DatabaseFeature } from '@zhin.js/core';
import { mountGameHubUi, markGameHubUiMounted } from './game-hub-mount.js';
import { registerGameRecordModels, initGameRecordDatabase } from './game-records.js';

export interface GameHubContext {
  plugin: Plugin;
  message: import('zhin.js').Message<any>;
}

export interface GameMenuAction {
  id: string;
  label: string;
  style?: 'primary' | 'danger' | 'secondary';
  groupOnly?: boolean;
  privateOnly?: boolean;
}

export interface RegisteredGame {
  id: string;
  title: string;
  icon: string;
  description: string;
  commandPrefix: string;
  quickStart?: string;
  aliases?: string[];
  menus: GameMenuAction[];
  runAction: (actionId: string, ctx: GameHubContext) => Promise<string | undefined | void>;
}

export interface GameHubContextExtensions {
  registerGame(game: RegisteredGame): () => void;
}

declare module '@zhin.js/core' {
  namespace Plugin {
    interface Extensions extends GameHubContextExtensions {}
    interface Contexts {
      game: GameHubFeature;
    }
  }
}

let activeFeature: GameHubFeature | null = null;

export class GameHubFeature extends Feature<RegisteredGame> {
  readonly name = 'game' as const;
  readonly icon = 'Gamepad2';
  readonly desc = '游戏';

  private readonly byId = new Map<string, RegisteredGame>();
  private hubDisposers: (() => void)[] = [];

  register(game: RegisteredGame, pluginName: string): () => void {
    const prev = this.byId.get(game.id);
    if (prev) {
      this.remove(prev);
    }
    this.byId.set(game.id, game);
    return this.add(game, pluginName);
  }

  getGame(id: string): RegisteredGame | undefined {
    return this.byId.get(id);
  }

  override remove(item: RegisteredGame, pluginName?: string): boolean {
    this.byId.delete(item.id);
    return super.remove(item, pluginName);
  }

  toJSON(pluginName?: string): FeatureJSON {
    const list = pluginName ? this.getByPlugin(pluginName) : [...this.items];
    return {
      name: this.name,
      icon: this.icon,
      desc: this.desc,
      count: list.length,
      items: list.map((g) => ({
        name: g.id,
        desc: g.title,
        usage: `${g.commandPrefix} ${g.quickStart ?? '开始'}`,
      })),
    };
  }

  get extensions() {
    const feature = this;
    return {
      registerGame(game: RegisteredGame) {
        const plugin = getPlugin();
        ensureGameHubService(plugin);
        const dispose = feature.register(game, plugin.name);
        plugin.recordFeatureContribution(feature.name, game.id);
        plugin.onDispose(dispose);
        return dispose;
      },
    };
  }

  mounted(plugin: PluginLike): void {
    activeFeature = this;
    const root = plugin as Plugin;
    const host = root.root ?? root;
    registerGameRecordModels(host);
    if (host.contextIsReady('database')) {
      initGameRecordDatabase(host.inject('database') as DatabaseFeature);
    } else {
      host.useContext('database', (dbFeature: DatabaseFeature) => {
        initGameRecordDatabase(dbFeature);
      });
    }
    this.hubDisposers = mountGameHubUi(host);
    markGameHubUiMounted();
  }

  dispose(): void {
    for (const d of this.hubDisposers) d();
    this.hubDisposers = [];
    if (activeFeature === this) {
      activeFeature = null;
    }
  }
}

/**
 * 在 root 上注册 `game` 服务（幂等）。游戏插件初始化时调用一次即可。
 */
export function ensureGameHubService(plugin: Plugin): GameHubFeature {
  const root = plugin.root;
  if (root.contextIsReady('game')) {
    return root.inject('game') as GameHubFeature;
  }

  const feature = new GameHubFeature();
  root.provide(feature);
  activeFeature = feature;

  if (root.started && feature.mounted) {
    feature.mounted(root);
  }

  return root.inject('game') as GameHubFeature;
}

export function getRegisteredGames(): readonly RegisteredGame[] {
  return activeFeature?.items ?? [];
}

export function getRegisteredGame(id: string): RegisteredGame | undefined {
  return activeFeature?.getGame(id);
}
