export type IlinkLogger = {
  debug: (msg: string) => void;
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  withAccount: (accountId: string) => IlinkLogger;
};

function createIlinkLogger(prefix = '[weixin-ilink]'): IlinkLogger {
  return Object.freeze({
    debug: () => {},
    info: () => {},
    warn: (msg) => console.warn(`${prefix} ${msg}`),
    error: (msg) => console.error(`${prefix} ${msg}`),
    withAccount(accountId) {
      return createIlinkLogger(`[weixin-ilink:${accountId}]`);
    },
  });
}

export const logger: IlinkLogger = createIlinkLogger();
