export interface LotteryPushTarget {
  readonly adapter: string;
  readonly endpointId: string;
  readonly channelType?: string;
  readonly channelId: string;
}

export type LotteryOutboundPush = (text: string) => Promise<void>;

let _outboundPush: LotteryOutboundPush | null = null;
const registrations: Array<{ readonly value: LotteryOutboundPush | null }> = [];

export function setLotteryOutboundPush(push: LotteryOutboundPush | null): void {
  _outboundPush = push;
}

/** Generation-safe registration used by Plugin Runtime setup(). */
export function registerLotteryOutboundPush(push: LotteryOutboundPush | null): () => void {
  const registration = Object.freeze({ value: push });
  registrations.push(registration);
  return () => {
    const index = registrations.lastIndexOf(registration);
    if (index >= 0) registrations.splice(index, 1);
  };
}

export function getLotteryOutboundPush(): LotteryOutboundPush | null {
  const active = registrations[registrations.length - 1];
  return active ? active.value : _outboundPush;
}

/** Push through the generation-owned OutboundHost configured by plugin setup. */
export async function pushLotteryReport(text: string): Promise<void> {
  await getLotteryOutboundPush()?.(text);
}
