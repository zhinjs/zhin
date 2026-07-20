export interface LotteryPushTarget {
  readonly adapter: string;
  readonly endpointId: string;
  readonly channelType?: string;
  readonly channelId: string;
}

export type LotteryOutboundPush = (text: string) => Promise<void>;

let _outboundPush: LotteryOutboundPush | null = null;

export function setLotteryOutboundPush(push: LotteryOutboundPush | null): void {
  _outboundPush = push;
}

export function getLotteryOutboundPush(): LotteryOutboundPush | null {
  return _outboundPush;
}

/** Push through the generation-owned OutboundHost configured by plugin setup. */
export async function pushLotteryReport(text: string): Promise<void> {
  await _outboundPush?.(text);
}
