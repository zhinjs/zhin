export type IlinkLogger = {
  debug: (msg: string) => void;
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  withAccount: (accountId: string) => IlinkLogger;
};

let sink: IlinkLogger = {
  debug: () => {},
  info: () => {},
  warn: (msg) => console.warn(`[weixin-ilink] ${msg}`),
  error: (msg) => console.error(`[weixin-ilink] ${msg}`),
  withAccount(accountId) {
    const prefix = `[weixin-ilink:${accountId}]`;
    return {
      debug: (msg) => sink.debug(`${prefix} ${msg}`),
      info: (msg) => sink.info(`${prefix} ${msg}`),
      warn: (msg) => sink.warn(`${prefix} ${msg}`),
      error: (msg) => sink.error(`${prefix} ${msg}`),
      withAccount: () => this,
    };
  },
};

export function setIlinkLogger(next: IlinkLogger): void {
  sink = next;
}

export const logger: IlinkLogger = {
  debug: (msg) => sink.debug(msg),
  info: (msg) => sink.info(msg),
  warn: (msg) => sink.warn(msg),
  error: (msg) => sink.error(msg),
  withAccount: (accountId) => sink.withAccount(accountId),
};
