import "./fs-safe-defaults.js";
export {
  JsonFileReadError,
  readJson,
  readJson as readJsonFileStrict,
  readJsonIfExists,
  readJsonIfExists as readDurableJsonFile,
  readJsonSync,
  readRootJsonObjectSync,
  readRootJsonSync,
  readRootStructuredFileSync,
  tryReadJson,
  tryReadJson as readJsonFile,
  tryReadJsonSync,
  tryReadJsonSync as readJsonFileSync,
  writeJson,
  writeJson as writeJsonAtomic,
  writeJsonSync,
} from "@alien/fs-safe/json";
export { writeTextAtomic } from "@alien/fs-safe/atomic";
export { createAsyncLock } from "@alien/fs-safe/advanced";
