/**
 * QQ 官方机器人适配器类型定义
 */
import type { Bot } from "qq-official-bot";
import type { ReceiverMode, ApplicationPlatform } from "qq-official-bot";

export { ReceiverMode } from "qq-official-bot";
export type { ApplicationPlatform, Intent } from "qq-official-bot";

export type QQBotConfig<
  T extends ReceiverMode,
  M extends ApplicationPlatform = ApplicationPlatform,
> = Bot.Config<T, M> & {
  context: "qq";
  name: string;
  data_dir?: string;
};

export interface QQBot<
  T extends ReceiverMode,
  M extends ApplicationPlatform = ApplicationPlatform,
> {
  $config: QQBotConfig<T, M>;
}
