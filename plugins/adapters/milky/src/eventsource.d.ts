declare module 'eventsource' {
  interface EventSourceConstructor {
    new (url: string, init?: { headers?: Record<string, string> }): EventSource;
  }
  interface EventSource {
    addEventListener(type: string, listener: (e: MessageEvent) => void): void;
    onerror: ((err: unknown) => void) | null;
    close(): void;
  }
  const EventSource: EventSourceConstructor;
  export = EventSource;
}
