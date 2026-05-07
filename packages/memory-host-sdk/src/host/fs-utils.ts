import { configureFsSafePython } from "@alien/fs-safe/config";
export { root } from "@alien/fs-safe/root";
export { isPathInside } from "@alien/fs-safe/path";
export {
  readRegularFile,
  statRegularFile,
  type RegularFileStatResult,
} from "@alien/fs-safe/advanced";
export { walkDirectory, type WalkDirectoryEntry } from "@alien/fs-safe/walk";

const hasPythonModeOverride =
  process.env.FS_SAFE_PYTHON_MODE != null || process.env.ALIEN_FS_SAFE_PYTHON_MODE != null;

if (!hasPythonModeOverride) {
  configureFsSafePython({ mode: "off" });
}

export function isFileMissingError(
  err: unknown,
): err is NodeJS.ErrnoException & { code: "ENOENT" } {
  return Boolean(
    err &&
    typeof err === "object" &&
    "code" in err &&
    ((err as Partial<NodeJS.ErrnoException>).code === "ENOENT" ||
      (err as { code?: unknown }).code === "not-found"),
  );
}
