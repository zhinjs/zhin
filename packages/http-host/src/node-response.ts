import type { ServerResponse } from "node:http";

/** Write a Fetch Response to a Node HTTP response (handles backpressure). */
export async function writeWebResponse(
  res: ServerResponse,
  webRes: Response,
): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (!webRes.body) {
    res.end();
    return;
  }
  const reader = webRes.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = Buffer.from(value);
      if (!res.write(buf)) {
        await new Promise<void>((resolve) => res.once("drain", resolve));
      }
    }
    res.end();
  } catch (err) {
    res.destroy(err as Error);
    throw err;
  }
}
