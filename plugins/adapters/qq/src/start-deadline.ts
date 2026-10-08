/** SDK startup must settle; serial endpoint readiness must never wait forever. */
export async function awaitQqStartup(starting: Promise<void>, signal: AbortSignal): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let aborted!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    aborted = () => reject(new Error('QQ startup stopped'));
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
  try {
    await Promise.race([starting, cancelled, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('QQ startup timed out after 30000ms')), 30_000);
    })]);
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener('abort', aborted);
  }
}
