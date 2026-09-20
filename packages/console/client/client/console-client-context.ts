import * as React from 'react';
import type { ConsoleClient } from './console-client.js';

const ConsoleClientContext = React.createContext<ConsoleClient | null>(null);

export interface ConsoleClientProviderProps {
  readonly client: ConsoleClient;
  readonly children?: React.ReactNode;
}

export function ConsoleClientProvider({
  client,
  children,
}: ConsoleClientProviderProps): React.ReactElement {
  return React.createElement(ConsoleClientContext.Provider, { value: client }, children);
}

export function useConsoleClient(): ConsoleClient {
  const client = React.useContext(ConsoleClientContext);
  if (!client) {
    throw new Error('Console hooks require a ConsoleClientProvider');
  }
  return client;
}
