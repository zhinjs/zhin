/**
 * MessageBus — 独立于 Plugin 的 IM 生命周期事件总线。
 *
 * 覆盖 Plugin.Lifecycle 中关键 IM 事件，供 Scope+Token 路径消费。
 * 遗留 Plugin.emit 通过短暂双写桥接（迁移窗口）。
 */

import { EventEmitter } from 'node:events';
import { createToken } from '@zhin.js/plugin-runtime';
import type { DeliveryReceipt } from '@zhin.js/im-contract';
import type { IncomingMessage, Message, OutboundEnvelope, SendContent } from './contracts.js';

export interface EndpointEvent {
  readonly adapter: string;
  readonly endpointId: string;
  readonly error?: Error;
}

export interface MessageBusEventMap {
  'message.receive': [message: Message];
  'before.sendMessage': [envelope: OutboundEnvelope];
  'message.send': [payload: { adapter: string; endpointId: string; content: SendContent; receipt: DeliveryReceipt }];
  'endpoint.connect': [event: EndpointEvent];
  'endpoint.disconnect': [event: EndpointEvent];
  'endpoint.error': [event: EndpointEvent];
}

export type MessageBusEventName = keyof MessageBusEventMap;

export class MessageBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  on<E extends MessageBusEventName>(
    event: E,
    listener: (...args: MessageBusEventMap[E]) => void,
  ): () => void {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
    return () => this.emitter.off(event, listener as (...args: unknown[]) => void);
  }

  once<E extends MessageBusEventName>(
    event: E,
    listener: (...args: MessageBusEventMap[E]) => void,
  ): () => void {
    this.emitter.once(event, listener as (...args: unknown[]) => void);
    return () => this.emitter.off(event, listener as (...args: unknown[]) => void);
  }

  emit<E extends MessageBusEventName>(
    event: E,
    ...args: MessageBusEventMap[E]
  ): void {
    this.emitter.emit(event, ...args);
  }

  off<E extends MessageBusEventName>(
    event: E,
    listener: (...args: MessageBusEventMap[E]) => void,
  ): void {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
  }

  listenerCount(event: MessageBusEventName): number {
    return this.emitter.listenerCount(event);
  }

  removeAllListeners(event?: MessageBusEventName): void {
    if (event) {
      this.emitter.removeAllListeners(event);
    } else {
      this.emitter.removeAllListeners();
    }
  }
}

export const messageBusToken = createToken<MessageBus>('zhin.im.message-bus');
