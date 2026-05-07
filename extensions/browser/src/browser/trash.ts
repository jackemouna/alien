import os from "node:os";
import { movePathToTrash as movePathToTrashWithAllowedRoots } from "alien/plugin-sdk/browser-config";
import { resolvePreferredAlienTmpDir } from "alien/plugin-sdk/temp-path";

export async function movePathToTrash(targetPath: string): Promise<string> {
  return await movePathToTrashWithAllowedRoots(targetPath, {
    allowedRoots: [os.homedir(), resolvePreferredAlienTmpDir()],
  });
}
