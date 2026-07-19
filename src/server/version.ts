import fs from "node:fs";
import path from "node:path";

export function readAppVersion(cwd = process.cwd()) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof packageJson.version === "string" ? packageJson.version : "unknown";
  } catch {
    return "unknown";
  }
}

export const APP_VERSION = readAppVersion();
