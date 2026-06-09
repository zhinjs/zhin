/**
 * KOOK /v3/asset/create 上传（formdata-node 要求 Blob，不能直传 Node Buffer）。
 */
import { readFile } from "node:fs/promises";

export interface KookAssetRequest {
  post(
    url: string,
    data: FormData,
    config?: { headers?: Record<string, string> },
  ): Promise<{ data?: { url?: string }; message?: string }>;
}

function guessFilename(data: string | Buffer): string {
  if (Buffer.isBuffer(data)) return "upload.png";
  if (/^data:image\/png/i.test(data)) return "upload.png";
  if (/^data:image\/jpe?g/i.test(data)) return "upload.jpg";
  if (/^data:image\/gif/i.test(data)) return "upload.gif";
  if (/^data:image\/webp/i.test(data)) return "upload.webp";
  const base = data.replace(/^file:\/\//, "").split("/").pop();
  return base?.includes(".") ? base : "upload.png";
}

async function toBuffer(data: string | Buffer): Promise<Buffer> {
  if (Buffer.isBuffer(data)) return data;
  if (data.startsWith("base64://")) {
    return Buffer.from(data.slice(9), "base64");
  }
  if (/^data:[^/]+\/[^;]+;base64,/i.test(data)) {
    return Buffer.from(data.replace(/^data:[^/]+\/[^;]+;base64,/, ""), "base64");
  }
  return readFile(data.replace(/^file:\/\//, ""));
}

export async function uploadKookAsset(
  request: KookAssetRequest,
  data: string | Buffer,
): Promise<string> {
  if (typeof data === "string" && /^https?:\/\//i.test(data)) {
    return data;
  }
  const buffer = await toBuffer(data);
  const form = new globalThis.FormData();
  form.append("file", new globalThis.Blob([new Uint8Array(buffer)]), guessFilename(data));

  const response = await request.post("/v3/asset/create", form, {
    headers: { Accept: "application/json" },
  });

  const url = response.data?.url;
  if (!url) {
    throw new Error(`KOOK asset upload failed: ${response.message ?? "missing url"}`);
  }
  return url;
}
