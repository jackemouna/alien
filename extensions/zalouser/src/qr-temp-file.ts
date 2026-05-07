import fsp from "node:fs/promises";
import path from "node:path";
import { resolvePreferredAlienTmpDir } from "alien/plugin-sdk/temp-path";

export async function writeQrDataUrlToTempFile(
  qrDataUrl: string,
  profile: string,
): Promise<string | null> {
  const trimmed = qrDataUrl.trim();
  const match = trimmed.match(/^data:image\/png;base64,(.+)$/i);
  const base64 = (match?.[1] ?? "").trim();
  if (!base64) {
    return null;
  }
  const safeProfile = profile.replace(/[^a-zA-Z0-9_-]+/g, "-") || "default";
  const filePath = path.join(
    resolvePreferredAlienTmpDir(),
    `alien-zalouser-qr-${safeProfile}.png`,
  );
  await fsp.writeFile(filePath, Buffer.from(base64, "base64"));
  return filePath;
}
