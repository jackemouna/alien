import { configureFsSafePython } from "@alien/fs-safe/config";

const hasPythonModeOverride =
  process.env.FS_SAFE_PYTHON_MODE != null || process.env.ALIEN_FS_SAFE_PYTHON_MODE != null;

if (!hasPythonModeOverride) {
  configureFsSafePython({ mode: "off" });
}
